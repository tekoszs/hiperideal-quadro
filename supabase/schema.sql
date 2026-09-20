-- ============================================================================
-- HIPERIDEAL | Conferência Diária de Quadro
-- SNAPSHOT GERADO AUTOMATICAMENTE — não editar à mão.
--
-- Fonte da verdade: supabase/migrations/*.sql
-- Regerar:          bash scripts/build_schema.sh
--
-- BANCO NOVO ......: rode este arquivo inteiro (ou as migrations em ordem).
-- BANCO EXISTENTE .: rode APENAS as migrations novas, em ordem.
--
-- No PostgreSQL local, rode ANTES: supabase/local/00_auth_shim.sql
-- (no Supabase o schema auth já existe — não rode o shim lá).
--
-- ATENÇÃO: a migration 0011 liga RLS com políticas reais por perfil.
-- Sem um registro em public.profiles, o usuário autenticado não lê nada.
-- Veja docs/SEGURANCA-RLS.md.
-- ============================================================================


-- ===========================================================================
-- 0001_types.sql
-- ===========================================================================
-- 0001 — Tipos ---------------------------------------------------------------
--
-- COEXISTÊNCIA: nenhuma extensão é criada aqui.
-- `gen_random_uuid()` faz parte do núcleo do PostgreSQL desde a versão 13,
-- então pgcrypto não é necessário. Um `create extension` exigiria privilégio
-- elevado e poderia instalar a extensão no schema public do banco
-- compartilhado — efeito colateral que não é deste sistema.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'quadro_conference_status') then
    -- REOPENED existe no modelo; o fluxo de reabertura é de uma fase futura.
    create type public.quadro_conference_status as enum ('DRAFT', 'SUBMITTED', 'REOPENED');
  end if;

  if not exists (select 1 from pg_type where typname = 'quadro_profile_role') then
    create type public.quadro_profile_role as enum ('MANAGER', 'SUPERVISOR', 'ADMIN');
  end if;
end
$$;

create or replace function public.quadro_reference_window_start()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select date_trunc('month', public.quadro_business_date())::date;
$$;

create or replace function public.quadro_reference_window_days()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select public.quadro_business_date() - public.quadro_reference_window_start();
$$;


-- ===========================================================================
-- 0002_catalog.sql
-- ===========================================================================
-- 0002 — Cadastros -----------------------------------------------------------
-- ids de catálogo são TEXT (slugs vindos da planilha: 'store-124').
-- ids transacionais são UUID (gerados pelo banco).

create table if not exists public.quadro_stores (
  id          text primary key,
  code        text not null unique,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Cada linha da planilha vira UMA função. Funções do mesmo grupo em setores
-- diferentes (REPOSITOR - HORTI vs REPOSITOR - FRIOS) são registros distintos.
-- function_group e sector servem ao consolidado analítico, NUNCA para fundir linhas.
create table if not exists public.quadro_positions (
  id             text primary key,
  name           text not null unique,
  function_group text not null,
  sector         text,
  active         boolean not null default true,
  display_order  integer not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists quadro_positions_function_group_idx on public.quadro_positions (function_group);
create index if not exists quadro_positions_sector_idx on public.quadro_positions (sector);

-- authorized_quantity NULL = quadro não informado na planilha (não inventar).
create table if not exists public.quadro_store_staffing (
  id                  text primary key,
  store_id            text not null references public.quadro_stores (id) on delete cascade,
  position_id         text not null references public.quadro_positions (id) on delete cascade,
  authorized_quantity integer check (authorized_quantity is null or authorized_quantity >= 0),
  effective_from      date not null default current_date,
  effective_to        date,
  constraint quadro_store_staffing_period_ck check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists quadro_store_staffing_active_unique_idx
  on public.quadro_store_staffing (store_id, position_id)
  where effective_to is null;

create index if not exists quadro_store_staffing_position_idx on public.quadro_store_staffing (position_id);

-- FOLGA NÃO É MOTIVO DE FALTA: folga vive em quadro_daily_items.day_off_quantity.
create table if not exists public.quadro_absence_reasons (
  id                   text primary key,
  name                 text not null unique,
  active               boolean not null default true,
  display_order        integer not null default 0,
  requires_observation boolean not null default false
);


-- ===========================================================================
-- 0003_profiles.sql
-- ===========================================================================
-- 0003 — Perfis ligados ao Supabase Auth -------------------------------------
--
-- quadro_profiles.id É o auth.users.id. Não existe perfil sem usuário autenticado,
-- e a role NUNCA vem do frontend: é lida daqui.

create table if not exists public.quadro_profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  role       public.quadro_profile_role not null default 'MANAGER',
  store_id   text references public.quadro_stores (id) on delete restrict,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  -- MANAGER obrigatoriamente pertence a uma loja.
  -- SUPERVISOR e ADMIN podem ter store_id nulo (acesso à rede).
  constraint quadro_profiles_manager_needs_store_ck
    check (role <> 'MANAGER' or store_id is not null)
);

create index if not exists quadro_profiles_store_idx on public.quadro_profiles (store_id);
create index if not exists quadro_profiles_role_idx on public.quadro_profiles (role);

-- ---------------------------------------------------------------------------
-- Ninguém promove a si mesmo.
--
-- A RLS de quadro_profiles permite que a pessoa atualize a própria linha (para
-- corrigir o nome), mas WITH CHECK não enxerga a linha antiga — então a
-- imutabilidade de role/store_id/active precisa de gatilho.
-- ---------------------------------------------------------------------------
create or replace function public.quadro_guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.quadro_profile_role;
begin
  select p.role into v_actor_role
    from public.quadro_profiles p
   where p.id = auth.uid() and p.active;

  -- ADMIN pode administrar perfis.
  if v_actor_role = 'ADMIN' then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Alteração de perfil (role) não permitida.' using errcode = '42501';
  end if;

  if new.store_id is distinct from old.store_id then
    raise exception 'Alteração de loja do usuário não permitida.' using errcode = '42501';
  end if;

  if new.active is distinct from old.active then
    raise exception 'Ativação/desativação de usuário não permitida.' using errcode = '42501';
  end if;

  if new.id is distinct from old.id then
    raise exception 'Alteração de id de perfil não permitida.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.quadro_guard_profile_privileges() from public;

drop trigger if exists quadro_profiles_guard_privileges on public.quadro_profiles;
create trigger quadro_profiles_guard_privileges
  before update on public.quadro_profiles
  for each row execute function public.quadro_guard_profile_privileges();


-- ===========================================================================
-- 0004_conferences.sql
-- ===========================================================================
-- 0004 — Conferência diária --------------------------------------------------

create table if not exists public.quadro_daily_conferences (
  id             uuid primary key default gen_random_uuid(),
  store_id       text not null references public.quadro_stores (id) on delete cascade,
  reference_date date not null,
  status         public.quadro_conference_status not null default 'DRAFT',
  -- Identidade confiável: preenchido pela RPC a partir de auth.uid().
  created_by     uuid not null references public.quadro_profiles (id) on delete restrict,
  submitted_by   uuid references public.quadro_profiles (id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  -- Uma única conferência por loja/data.
  constraint quadro_daily_conferences_store_date_key unique (store_id, reference_date),
  -- SUBMITTED exige carimbo e autor; qualquer outro status não pode ter carimbo.
  constraint quadro_daily_conferences_submitted_ck check (
    (status = 'SUBMITTED' and submitted_at is not null and submitted_by is not null)
    or (status <> 'SUBMITTED' and submitted_at is null and submitted_by is null)
  )
);

create index if not exists quadro_daily_conferences_store_date_idx
  on public.quadro_daily_conferences (store_id, reference_date desc);
create index if not exists quadro_daily_conferences_created_by_idx
  on public.quadro_daily_conferences (created_by);

create table if not exists public.quadro_daily_items (
  id               uuid primary key default gen_random_uuid(),
  conference_id    uuid not null references public.quadro_daily_conferences (id) on delete cascade,
  position_id      text not null references public.quadro_positions (id) on delete restrict,
  absence_quantity integer not null default 0 check (absence_quantity >= 0),
  day_off_quantity integer not null default 0 check (day_off_quantity >= 0),
  observation      text,
  constraint quadro_daily_items_conference_position_key unique (conference_id, position_id)
);

create index if not exists quadro_daily_items_conference_idx on public.quadro_daily_items (conference_id);
create index if not exists quadro_daily_items_position_idx on public.quadro_daily_items (position_id);

create table if not exists public.quadro_daily_item_reasons (
  id            uuid primary key default gen_random_uuid(),
  daily_item_id uuid not null references public.quadro_daily_items (id) on delete cascade,
  reason_id     text not null references public.quadro_absence_reasons (id) on delete restrict,
  quantity      integer not null default 0 check (quantity >= 0),
  observation   text,
  constraint quadro_daily_item_reasons_item_reason_key unique (daily_item_id, reason_id)
);

create index if not exists quadro_daily_item_reasons_item_idx on public.quadro_daily_item_reasons (daily_item_id);
create index if not exists quadro_daily_item_reasons_reason_idx on public.quadro_daily_item_reasons (reason_id);


-- ===========================================================================
-- 0005_audit.sql
-- ===========================================================================
-- 0005 — Auditoria append-only -----------------------------------------------
--
-- user_id é UUID vindo de auth.uid() (gravado dentro das RPCs), nunca texto
-- livre enviado pelo navegador.

create table if not exists public.quadro_audit_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.quadro_profiles (id) on delete restrict,
  action     text not null,
  entity     text not null,
  entity_id  text not null,
  store_id   text references public.quadro_stores (id) on delete set null,
  created_at timestamptz not null default now(),
  metadata   jsonb not null default '{}'::jsonb
);

create index if not exists quadro_audit_logs_entity_idx on public.quadro_audit_logs (entity, entity_id);
create index if not exists quadro_audit_logs_user_idx on public.quadro_audit_logs (user_id);
create index if not exists quadro_audit_logs_store_created_idx on public.quadro_audit_logs (store_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Append-only de verdade.
--
-- A RLS já não concede UPDATE/DELETE, mas gatilho é mais forte: ele vale
-- também para papéis que ignoram RLS (service_role, superusuário).
-- ---------------------------------------------------------------------------
create or replace function public.quadro_audit_logs_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'quadro_audit_logs é append-only: % não é permitido.', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists quadro_audit_logs_no_update on public.quadro_audit_logs;
create trigger quadro_audit_logs_no_update
  before update or delete on public.quadro_audit_logs
  for each row execute function public.quadro_audit_logs_append_only();


-- ===========================================================================
-- 0006_security_functions.sql
-- ===========================================================================
-- 0006 — Funções de segurança ------------------------------------------------
--
-- POR QUE SECURITY DEFINER:
--   Estas funções leem public.quadro_profiles, que está sob RLS. As próprias políticas
--   de RLS chamam estas funções. Se fossem SECURITY INVOKER, ler quadro_profiles
--   dispararia a política de quadro_profiles, que chamaria a função de novo →
--   recursão infinita ("infinite recursion detected in policy").
--   SECURITY DEFINER quebra o ciclo. É o padrão recomendado pelo Supabase.
--
-- CUIDADOS APLICADOS:
--   - `set search_path = ''` e todos os nomes qualificados: impede que um
--     objeto plantado em schema temporário sequestre a função;
--   - `stable`: o planejador pode cachear dentro da consulta;
--   - EXECUTE revogado de PUBLIC e de anon; concedido só a authenticated;
--   - nenhuma delas aceita parâmetro que troque a identidade — a identidade
--     vem sempre de auth.uid().

-- Papel do usuário autenticado. NULL = sem perfil ativo (logado mas sem acesso).
create or replace function public.quadro_current_profile_role()
returns public.quadro_profile_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
    from public.quadro_profiles p
   where p.id = auth.uid()
     and p.active;
$$;

-- Loja do usuário autenticado. NULL para SUPERVISOR/ADMIN (acesso à rede).
create or replace function public.quadro_current_profile_store_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.store_id
    from public.quadro_profiles p
   where p.id = auth.uid()
     and p.active;
$$;

-- LEITURA: gerente vê a própria loja; supervisor e admin veem a rede toda.
create or replace function public.quadro_can_access_store(p_store_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.quadro_profiles p
     where p.id = auth.uid()
       and p.active
       and (
         p.role in ('SUPERVISOR', 'ADMIN')
         or (p.role = 'MANAGER' and p.store_id = p_store_id)
       )
  );
$$;

-- ESCRITA: somente o gerente da própria loja.
--
-- SUPERVISOR e ADMIN NÃO ganham escrita por serem perfis elevados — não há
-- regra de negócio que permita supervisor lançar falta no lugar do gerente.
-- Quando existir (ex.: reabertura), entra como RPC própria e explícita.
create or replace function public.quadro_can_write_store(p_store_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.quadro_profiles p
     where p.id = auth.uid()
       and p.active
       and p.role = 'MANAGER'
       and p.store_id = p_store_id
  );
$$;

-- Autorização de transição de status: só as RPCs ligam este GUC, que é local
-- à transação. O PostgREST não expõe SET/set_config ao cliente REST, então a
-- chave anon não consegue simular esta autorização.
create or replace function public.quadro_status_change_is_authorized()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('quadro.status_change', true), 'off') = 'on';
$$;

revoke all on function public.quadro_current_profile_role()      from public;
revoke all on function public.quadro_current_profile_store_id()  from public;
revoke all on function public.quadro_can_access_store(text)      from public;
revoke all on function public.quadro_can_write_store(text)       from public;
revoke all on function public.quadro_status_change_is_authorized() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.quadro_current_profile_role() to authenticated';
    execute 'grant execute on function public.quadro_current_profile_store_id() to authenticated';
    execute 'grant execute on function public.quadro_can_access_store(text) to authenticated';
    execute 'grant execute on function public.quadro_can_write_store(text) to authenticated';
    execute 'grant execute on function public.quadro_status_change_is_authorized() to authenticated';
  end if;
end
$$;


-- ===========================================================================
-- 0007_guards.sql
-- ===========================================================================
-- 0007 — Gatilhos de imutabilidade -------------------------------------------

create or replace function public.quadro_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists quadro_daily_conferences_touch on public.quadro_daily_conferences;
create trigger quadro_daily_conferences_touch
  before update on public.quadro_daily_conferences
  for each row execute function public.quadro_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Conferência SUBMITTED é imutável; identidade da conferência é imutável
-- sempre. Só as RPCs autorizadas mudam status / submitted_at / submitted_by.
-- ---------------------------------------------------------------------------
create or replace function public.quadro_guard_conference_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'SUBMITTED' and not public.quadro_status_change_is_authorized() then
      raise exception 'Conferência enviada não pode ser excluída (loja %, data %).',
        old.store_id, old.reference_date using errcode = '55006';
    end if;
    return old;
  end if;

  -- Identidade nunca muda, nem com autorização de status.
  if new.store_id is distinct from old.store_id
     or new.reference_date is distinct from old.reference_date
     or new.created_by is distinct from old.created_by then
    raise exception 'Loja, data de referência e autor da conferência são imutáveis.'
      using errcode = '55006';
  end if;

  if public.quadro_status_change_is_authorized() then
    return new;
  end if;

  if old.status = 'SUBMITTED' then
    raise exception 'Conferência já enviada: edição bloqueada (loja %, data %).',
      old.store_id, old.reference_date using errcode = '55006';
  end if;

  if new.status is distinct from old.status then
    raise exception 'Mudança de status só é permitida pelas RPCs de conferência.'
      using errcode = '55006';
  end if;

  if new.submitted_at is distinct from old.submitted_at
     or new.submitted_by is distinct from old.submitted_by then
    raise exception 'submitted_at/submitted_by só podem ser preenchidos pela RPC de envio.'
      using errcode = '55006';
  end if;

  return new;
end;
$$;

-- 'guard' vem antes de 'touch' na ordem alfabética: bloqueia antes de carimbar.
drop trigger if exists quadro_daily_conferences_guard on public.quadro_daily_conferences;
create trigger quadro_daily_conferences_guard
  before update or delete on public.quadro_daily_conferences
  for each row execute function public.quadro_guard_conference_transition();

-- ---------------------------------------------------------------------------
-- Filhos de conferência enviada são imutáveis (INSERT, UPDATE e DELETE).
-- ---------------------------------------------------------------------------
create or replace function public.quadro_block_submitted_conference()
returns trigger
language plpgsql
as $$
declare
  v_conference_id uuid;
  v_status public.quadro_conference_status;
begin
  if tg_op = 'DELETE' then
    v_conference_id := old.conference_id;
  else
    v_conference_id := new.conference_id;
  end if;

  select dc.status into v_status
    from public.quadro_daily_conferences dc
   where dc.id = v_conference_id;

  if v_status = 'SUBMITTED' then
    raise exception 'Conferência já enviada: edição bloqueada.' using errcode = '55006';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists quadro_daily_items_block_submitted on public.quadro_daily_items;
create trigger quadro_daily_items_block_submitted
  before insert or update or delete on public.quadro_daily_items
  for each row execute function public.quadro_block_submitted_conference();

-- Mesma proteção para os MOTIVOS: a conferência precisa ser imutável por
-- inteiro — faltas, folgas, observação, motivos, quantidades e observações.
create or replace function public.quadro_block_submitted_conference_reason()
returns trigger
language plpgsql
as $$
declare
  v_item_id uuid;
  v_status public.quadro_conference_status;
begin
  if tg_op = 'DELETE' then
    v_item_id := old.daily_item_id;
  else
    v_item_id := new.daily_item_id;
  end if;

  select dc.status into v_status
    from public.quadro_daily_items di
    join public.quadro_daily_conferences dc on dc.id = di.conference_id
   where di.id = v_item_id;

  if v_status = 'SUBMITTED' then
    raise exception 'Conferência já enviada: motivos bloqueados para edição.'
      using errcode = '55006';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists quadro_daily_item_reasons_block_submitted on public.quadro_daily_item_reasons;
create trigger quadro_daily_item_reasons_block_submitted
  before insert or update or delete on public.quadro_daily_item_reasons
  for each row execute function public.quadro_block_submitted_conference_reason();


-- ===========================================================================
-- 0008_consistency.sql
-- ===========================================================================
-- 0008 — Regra de consistência (fonte única da verdade no banco) -------------
-- Espelha src/domain/validation.ts.

create or replace function public.quadro_assert_conference_is_consistent(p_conference_id uuid)
returns void
language plpgsql
as $$
declare
  offending record;
begin
  -- (a) faltas e folgas não podem ser negativas.
  select p.name, di.absence_quantity, di.day_off_quantity
    into offending
    from public.quadro_daily_items di
    join public.quadro_positions p on p.id = di.position_id
   where di.conference_id = p_conference_id
     and (di.absence_quantity < 0 or di.day_off_quantity < 0)
   limit 1;

  if found then
    raise exception 'Função %: quantidade negativa não é permitida.', offending.name
      using errcode = '23514';
  end if;

  -- (b) toda falta precisa de motivo e a soma dos motivos deve ser igual às faltas.
  for offending in
    select p.name,
           di.absence_quantity,
           coalesce(sum(dir.quantity), 0) as reason_total
      from public.quadro_daily_items di
      join public.quadro_positions p on p.id = di.position_id
      left join public.quadro_daily_item_reasons dir on dir.daily_item_id = di.id
     where di.conference_id = p_conference_id
     group by di.id, p.name, di.absence_quantity
    having di.absence_quantity <> coalesce(sum(dir.quantity), 0)
  loop
    if offending.reason_total = 0 then
      raise exception 'Função %: informe o motivo das % falta(s).',
        offending.name, offending.absence_quantity using errcode = '23514';
    else
      raise exception 'Função %: motivos informados % de %. A soma dos motivos precisa ser igual à quantidade de faltas.',
        offending.name, offending.reason_total, offending.absence_quantity
        using errcode = '23514';
    end if;
  end loop;

  -- (c) motivo que exige observação (Outros) não pode ficar sem texto.
  select p.name, ar.name as reason_name
    into offending
    from public.quadro_daily_item_reasons dir
    join public.quadro_absence_reasons ar on ar.id = dir.reason_id
    join public.quadro_daily_items di on di.id = dir.daily_item_id
    join public.quadro_positions p on p.id = di.position_id
   where di.conference_id = p_conference_id
     and ar.requires_observation
     and dir.quantity > 0
     and coalesce(btrim(dir.observation), '') = ''
   limit 1;

  if found then
    raise exception 'Função %: o motivo "%" exige observação.',
      offending.name, offending.reason_name using errcode = '23514';
  end if;
end;
$$;


-- ===========================================================================
-- 0009_rpcs.sql
-- ===========================================================================
-- 0009 — RPCs: único caminho de escrita transacional da conferência ----------
--
-- As duas são SECURITY INVOKER (padrão): rodam com os privilégios de quem
-- chama e continuam sujeitas à RLS. Não são porta dos fundos.
--
-- A identidade NUNCA vem do payload: é sempre auth.uid().

-- Assinatura antiga (recebia p_created_by do navegador) não deve sobreviver.
drop function if exists public.quadro_rpc_save_daily_conference_draft(text, date, text, jsonb);

-- ---------------------------------------------------------------------------
-- 9.1 Salvar rascunho — substituição completa e atômica.
--
-- p_items:
--   [{ "position_id": "pos-x", "absence_quantity": 1, "day_off_quantity": 0,
--      "observation": null,
--      "reasons": [{ "reason_id": "reason-y", "quantity": 1, "observation": null }] }]
--
-- Os ids das linhas NUNCA vêm do cliente: o banco mantém os seus.
-- Motivos são reescritos por completo, o que elimina motivos órfãos.
-- ---------------------------------------------------------------------------
create or replace function public.quadro_rpc_save_daily_conference_draft(
  p_store_id       text,
  p_reference_date date,
  p_items          jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_status public.quadro_conference_status;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items precisa ser um array JSON.' using errcode = '22023';
  end if;

  -- Gerente só escreve na própria loja. Supervisor/admin não escrevem aqui.
  if not public.quadro_can_write_store(p_store_id) then
    raise exception 'Sem permissão para lançar conferência da loja %.', p_store_id
      using errcode = '42501';
  end if;

  -- ATENÇÃO: sob RLS, `select ... for update` aplica TAMBÉM a política de
  -- UPDATE. Como a política de UPDATE exclui linhas SUBMITTED, travar direto
  -- faria a conferência enviada "sumir" e o erro sairia como se ela não
  -- existisse. Por isso lemos primeiro sem lock (política de SELECT) para
  -- produzir a mensagem correta, e só travamos quando ainda é editável.
  select dc.id, dc.status into v_id, v_status
    from public.quadro_daily_conferences dc
   where dc.store_id = p_store_id and dc.reference_date = p_reference_date;

  if v_status = 'SUBMITTED' then
    raise exception 'Conferência já enviada: edição bloqueada (loja %, data %).',
      p_store_id, p_reference_date using errcode = '55006';
  end if;

  if v_id is not null then
    -- Agora sim: trava a linha. Dois salvamentos simultâneos serializam aqui.
    select dc.id, dc.status into v_id, v_status
      from public.quadro_daily_conferences dc
     where dc.id = v_id
     for update;
  end if;

  if v_id is null then
    insert into public.quadro_daily_conferences (store_id, reference_date, status, created_by)
    values (p_store_id, p_reference_date, 'DRAFT', v_uid)
    on conflict (store_id, reference_date) do nothing
    returning id, status into v_id, v_status;

    -- Corrida: outro cliente inseriu entre o select e o insert.
    if v_id is null then
      select dc.id, dc.status into v_id, v_status
        from public.quadro_daily_conferences dc
       where dc.store_id = p_store_id and dc.reference_date = p_reference_date;

      if v_status = 'SUBMITTED' then
        raise exception 'Conferência já enviada: edição bloqueada (loja %, data %).',
          p_store_id, p_reference_date using errcode = '55006';
      end if;

      select dc.id into v_id
        from public.quadro_daily_conferences dc
       where dc.id = v_id
       for update;
    end if;
  end if;

  if v_id is null then
    raise exception 'Não foi possível abrir a conferência da loja % em %.',
      p_store_id, p_reference_date using errcode = '55006';
  end if;

  -- Funções que saíram do payload são removidas (sem deixar órfãos).
  delete from public.quadro_daily_items di
   where di.conference_id = v_id
     and not exists (
       select 1 from jsonb_array_elements(p_items) it
        where it->>'position_id' = di.position_id
     );

  insert into public.quadro_daily_items
    (conference_id, position_id, absence_quantity, day_off_quantity, observation)
  select v_id,
         it->>'position_id',
         greatest(0, coalesce((it->>'absence_quantity')::integer, 0)),
         greatest(0, coalesce((it->>'day_off_quantity')::integer, 0)),
         nullif(btrim(coalesce(it->>'observation', '')), '')
    from jsonb_array_elements(p_items) it
  on conflict (conference_id, position_id) do update
    set absence_quantity = excluded.absence_quantity,
        day_off_quantity = excluded.day_off_quantity,
        observation      = excluded.observation;

  -- Motivos: apaga tudo da conferência e regrava só o que veio com quantidade > 0.
  delete from public.quadro_daily_item_reasons dir
   using public.quadro_daily_items di
   where dir.daily_item_id = di.id
     and di.conference_id = v_id;

  insert into public.quadro_daily_item_reasons (daily_item_id, reason_id, quantity, observation)
  select di.id,
         r->>'reason_id',
         coalesce((r->>'quantity')::integer, 0),
         nullif(btrim(coalesce(r->>'observation', '')), '')
    from jsonb_array_elements(p_items) it
    join public.quadro_daily_items di
      on di.conference_id = v_id
     and di.position_id = it->>'position_id'
   cross join lateral jsonb_array_elements(coalesce(it->'reasons', '[]'::jsonb)) r
   where coalesce((r->>'quantity')::integer, 0) > 0;

  update public.quadro_daily_conferences set updated_at = now() where id = v_id;

  -- Auditoria gravada AQUI, na mesma transação — não depende do navegador.
  insert into public.quadro_audit_logs (user_id, action, entity, entity_id, store_id, metadata)
  values (
    v_uid, 'CONFERENCE_DRAFT_SAVED', 'quadro_daily_conferences', v_id::text, p_store_id,
    jsonb_build_object(
      'reference_date', p_reference_date,
      'quadro_positions', jsonb_array_length(p_items)
    )
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9.2 Enviar conferência — envio definitivo, atômico.
--
-- Uma função PL/pgSQL roda dentro de uma única transação: se qualquer
-- validação falhar, TODO o efeito é desfeito e nada fica parcialmente enviado.
-- ---------------------------------------------------------------------------
create or replace function public.quadro_rpc_submit_daily_conference(p_conference_id uuid)
returns public.quadro_daily_conferences
language plpgsql
as $$
declare
  v_uid        uuid := auth.uid();
  v_conference public.quadro_daily_conferences;
  v_absences   integer;
  v_day_offs   integer;
  v_impacted   integer;
begin
  -- (1) usuário autenticado?
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;

  -- (2) a conferência existe?
  --
  -- Leitura SEM lock de propósito: sob RLS, `for update` aplica também a
  -- política de UPDATE, que exclui linhas SUBMITTED. Travar aqui faria uma
  -- conferência já enviada parecer inexistente, e o gerente veria
  -- "não encontrada" em vez de "já enviada".
  select * into v_conference
    from public.quadro_daily_conferences
   where id = p_conference_id;

  if not found then
    raise exception 'Conferência não encontrada: %.', p_conference_id using errcode = 'P0002';
  end if;

  -- (3) o usuário pode escrever nesta loja?
  if not public.quadro_can_write_store(v_conference.store_id) then
    raise exception 'Sem permissão para enviar conferência da loja %.', v_conference.store_id
      using errcode = '42501';
  end if;

  -- (4) está em DRAFT ou REOPENED?
  if v_conference.status = 'SUBMITTED' then
    raise exception 'Conferência já enviada em %.', v_conference.submitted_at
      using errcode = '55006';
  end if;

  if v_conference.status not in ('DRAFT', 'REOPENED') then
    raise exception 'Status % não permite envio.', v_conference.status using errcode = '55006';
  end if;

  -- Agora que se sabe que a linha é editável, trava contra envio duplo
  -- concorrente e reconfere o status sob o lock.
  select * into v_conference
    from public.quadro_daily_conferences
   where id = p_conference_id
   for update;

  if not found or v_conference.status = 'SUBMITTED' then
    raise exception 'Conferência foi enviada por outra sessão durante este envio.'
      using errcode = '55006';
  end if;

  -- (5) os itens já estão persistidos?
  if not exists (select 1 from public.quadro_daily_items where conference_id = p_conference_id) then
    raise exception 'Conferência sem itens persistidos: salve o rascunho antes de enviar.'
      using errcode = '55006';
  end if;

  -- (6) negativos, falta sem motivo, soma dos motivos e observação obrigatória.
  perform public.quadro_assert_conference_is_consistent(p_conference_id);

  select coalesce(sum(absence_quantity), 0),
         coalesce(sum(day_off_quantity), 0),
         count(*) filter (where absence_quantity > 0 or day_off_quantity > 0)
    into v_absences, v_day_offs, v_impacted
    from public.quadro_daily_items
   where conference_id = p_conference_id;

  -- (7) só agora muda o status, com a autorização que os gatilhos exigem.
  perform set_config('quadro.status_change', 'on', true);

  update public.quadro_daily_conferences
     set status = 'SUBMITTED',
         submitted_at = now(),
         submitted_by = v_uid
   where id = p_conference_id
  returning * into v_conference;

  perform set_config('quadro.status_change', 'off', true);

  -- (8) auditoria do evento crítico, na mesma transação do envio.
  insert into public.quadro_audit_logs (user_id, action, entity, entity_id, store_id, metadata)
  values (
    v_uid, 'CONFERENCE_SUBMITTED', 'quadro_daily_conferences', p_conference_id::text,
    v_conference.store_id,
    jsonb_build_object(
      'reference_date', v_conference.reference_date,
      'total_absences', v_absences,
      'total_day_offs', v_day_offs,
      'impacted_positions', v_impacted,
      'submitted_at', v_conference.submitted_at
    )
  );

  return v_conference;
end;
$$;

revoke all on function public.quadro_rpc_save_daily_conference_draft(text, date, jsonb) from public;
revoke all on function public.quadro_rpc_submit_daily_conference(uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.quadro_rpc_save_daily_conference_draft(text, date, jsonb) to authenticated';
    execute 'grant execute on function public.quadro_rpc_submit_daily_conference(uuid) to authenticated';
  end if;
end
$$;


-- ===========================================================================
-- 0010_analytics_views.sql
-- ===========================================================================
-- 0010 — Views analíticas ----------------------------------------------------
--
-- PROBLEMA CORRIGIDO AQUI (duplicação de faltas)
--
-- A view antiga `v_daily_occurrences` juntava quadro_daily_items com
-- quadro_daily_item_reasons numa única linha. Uma função com 3 faltas divididas em
-- 2 motivos virava 2 LINHAS, cada uma repetindo absence_quantity = 3.
-- Um `sum(absence_quantity)` no dashboard resultaria em 6 faltas em vez de 3.
--
-- Correção: duas fontes analíticas com granularidades distintas e explícitas.
--
--   quadro_v_conference_items         -> 1 linha por (conferência, função)
--                                 SOMAR faltas/folgas AQUI.
--   quadro_v_conference_item_reasons  -> 1 linha por (conferência, função, motivo)
--                                 SOMAR reason_quantity AQUI, nunca faltas.
--
-- Regra de bolso para quem for montar o dashboard:
--   total de faltas   -> sum(absence_quantity)  em quadro_v_conference_items
--   faltas por motivo -> sum(reason_quantity)   em quadro_v_conference_item_reasons
--   os dois totais batem, porque a soma dos motivos é igual às faltas
--   (garantido por quadro_assert_conference_is_consistent no envio).

-- COEXISTÊNCIA: nada é dropado fora do namespace quadro_.
-- A view antiga `v_daily_occurrences` só existiu em bancos locais anteriores
-- a esta fase e NUNCA foi criada no Supabase compartilhado. Um
-- `drop view if exists public.v_daily_occurrences` aqui poderia derrubar uma
-- view homônima de outro sistema, então ele foi removido de propósito.

-- ---------------------------------------------------------------------------
-- security_invoker = true é ESSENCIAL: sem isso a view roda com os
-- privilégios do dono e ignora a RLS das tabelas de baixo — um gerente
-- enxergaria a rede inteira pela view.
-- ---------------------------------------------------------------------------
drop view if exists public.quadro_v_conference_items;
create view public.quadro_v_conference_items
with (security_invoker = true)
as
select
  dc.id              as conference_id,
  dc.store_id,
  s.code             as store_code,
  s.name             as store_name,
  dc.reference_date,
  dc.status,
  dc.submitted_at,
  p.id               as position_id,
  p.name             as position_name,
  p.function_group,
  p.sector,
  di.id              as daily_item_id,
  di.absence_quantity,
  di.day_off_quantity,
  di.observation     as item_observation
from public.quadro_daily_conferences dc
join public.quadro_stores s on s.id = dc.store_id
join public.quadro_daily_items di on di.conference_id = dc.id
join public.quadro_positions p on p.id = di.position_id;

comment on view public.quadro_v_conference_items is
  'Uma linha por conferência x função. É AQUI que se soma absence_quantity e '
  'day_off_quantity. Nunca junte esta view com motivos antes de agregar.';

drop view if exists public.quadro_v_conference_item_reasons;
create view public.quadro_v_conference_item_reasons
with (security_invoker = true)
as
select
  dc.id              as conference_id,
  dc.store_id,
  s.code             as store_code,
  s.name             as store_name,
  dc.reference_date,
  dc.status,
  p.id               as position_id,
  p.name             as position_name,
  p.function_group,
  p.sector,
  di.id              as daily_item_id,
  ar.id              as reason_id,
  ar.name            as reason_name,
  dir.quantity       as reason_quantity,
  dir.observation    as reason_observation
from public.quadro_daily_conferences dc
join public.quadro_stores s on s.id = dc.store_id
join public.quadro_daily_items di on di.conference_id = dc.id
join public.quadro_positions p on p.id = di.position_id
join public.quadro_daily_item_reasons dir on dir.daily_item_id = di.id
join public.quadro_absence_reasons ar on ar.id = dir.reason_id;

comment on view public.quadro_v_conference_item_reasons is
  'Uma linha por conferência x função x motivo. Some reason_quantity aqui. '
  'NUNCA some absence_quantity a partir desta view: ela repete a função uma '
  'vez por motivo e o total sairia multiplicado.';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on public.quadro_v_conference_items to authenticated';
    execute 'grant select on public.quadro_v_conference_item_reasons to authenticated';
  end if;
end
$$;


-- ===========================================================================
-- 0011_rls_policies.sql
-- ===========================================================================
-- 0011 — RLS real por perfil -------------------------------------------------
--
-- Nenhuma política usa `using (true)` / `with check (true)`.
-- Toda decisão passa pelas funções de 0006, que leem o perfil no BANCO —
-- a role nunca vem do frontend.
--
-- Resumo:
--   MANAGER     lê e escreve somente a própria loja, e só enquanto DRAFT/REOPENED
--   SUPERVISOR  lê a rede inteira; não escreve conferência
--   ADMIN       lê a rede inteira; administra perfis; não escreve conferência
--   anon        nada

alter table public.quadro_stores             enable row level security;
alter table public.quadro_positions          enable row level security;
alter table public.quadro_store_staffing     enable row level security;
alter table public.quadro_profiles           enable row level security;
alter table public.quadro_absence_reasons    enable row level security;
alter table public.quadro_daily_conferences  enable row level security;
alter table public.quadro_daily_items        enable row level security;
alter table public.quadro_daily_item_reasons enable row level security;
alter table public.quadro_audit_logs         enable row level security;

-- ===========================================================================
-- Cadastros (somente leitura pela API; manutenção é administrativa/SQL)
-- ===========================================================================
drop policy if exists quadro_stores_select on public.quadro_stores;
create policy quadro_stores_select on public.quadro_stores
  for select to authenticated
  using (public.quadro_can_access_store(id));

-- Gerente enxerga as funções vinculadas ao quadro da SUA loja.
-- Supervisor/admin enxergam as funções de qualquer loja acessível.
drop policy if exists quadro_positions_select on public.quadro_positions;
create policy quadro_positions_select on public.quadro_positions
  for select to authenticated
  using (
    exists (
      select 1
        from public.quadro_store_staffing ss
       where ss.position_id = quadro_positions.id
         and ss.effective_to is null
         and public.quadro_can_access_store(ss.store_id)
    )
  );

drop policy if exists quadro_store_staffing_select on public.quadro_store_staffing;
create policy quadro_store_staffing_select on public.quadro_store_staffing
  for select to authenticated
  using (public.quadro_can_access_store(store_id));

-- Tabela de referência: qualquer usuário COM PERFIL ATIVO lê.
-- (Não é `true`: usuário autenticado sem perfil ativo não lê nada.)
drop policy if exists quadro_absence_reasons_select on public.quadro_absence_reasons;
create policy quadro_absence_reasons_select on public.quadro_absence_reasons
  for select to authenticated
  using (public.quadro_current_profile_role() is not null);

-- ===========================================================================
-- Perfis
-- ===========================================================================
drop policy if exists quadro_profiles_select on public.quadro_profiles;
create policy quadro_profiles_select on public.quadro_profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.quadro_current_profile_role() in ('SUPERVISOR', 'ADMIN')
  );

-- A pessoa pode corrigir o próprio nome. role/store_id/active são bloqueados
-- pelo gatilho quadro_guard_profile_privileges (WITH CHECK não enxerga a linha antiga).
drop policy if exists quadro_profiles_update_self on public.quadro_profiles;
create policy quadro_profiles_update_self on public.quadro_profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ADMIN administra perfis (o gatilho libera role/store_id só para ADMIN).
drop policy if exists quadro_profiles_update_admin on public.quadro_profiles;
create policy quadro_profiles_update_admin on public.quadro_profiles
  for update to authenticated
  using (public.quadro_current_profile_role() = 'ADMIN')
  with check (public.quadro_current_profile_role() = 'ADMIN');

drop policy if exists quadro_profiles_insert_admin on public.quadro_profiles;
create policy quadro_profiles_insert_admin on public.quadro_profiles
  for insert to authenticated
  with check (public.quadro_current_profile_role() = 'ADMIN');

-- Sem política de DELETE: perfil não se apaga pela API.

-- ===========================================================================
-- Conferências
-- ===========================================================================
drop policy if exists quadro_daily_conferences_select on public.quadro_daily_conferences;
create policy quadro_daily_conferences_select on public.quadro_daily_conferences
  for select to authenticated
  using (public.quadro_can_access_store(store_id));

-- Criação: só o gerente da loja, sempre como DRAFT e sempre em seu próprio nome.
drop policy if exists quadro_daily_conferences_insert on public.quadro_daily_conferences;
create policy quadro_daily_conferences_insert on public.quadro_daily_conferences
  for insert to authenticated
  with check (
    public.quadro_can_write_store(store_id)
    and created_by = auth.uid()
    and status = 'DRAFT'
  );

-- Edição: só o gerente da loja e só enquanto não estiver enviada.
-- O WITH CHECK não restringe status porque a RPC de envio precisa gravar
-- SUBMITTED; quem governa a transição é o gatilho quadro_guard_conference_transition.
drop policy if exists quadro_daily_conferences_update on public.quadro_daily_conferences;
create policy quadro_daily_conferences_update on public.quadro_daily_conferences
  for update to authenticated
  using (
    public.quadro_can_write_store(store_id)
    and status in ('DRAFT', 'REOPENED')
  )
  with check (public.quadro_can_write_store(store_id));

-- Sem política de DELETE: conferência não se apaga pela API.

-- ===========================================================================
-- Itens da conferência
-- ===========================================================================
drop policy if exists quadro_daily_items_select on public.quadro_daily_items;
create policy quadro_daily_items_select on public.quadro_daily_items
  for select to authenticated
  using (
    exists (
      select 1 from public.quadro_daily_conferences dc
       where dc.id = quadro_daily_items.conference_id
         and public.quadro_can_access_store(dc.store_id)
    )
  );

drop policy if exists quadro_daily_items_insert on public.quadro_daily_items;
create policy quadro_daily_items_insert on public.quadro_daily_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.quadro_daily_conferences dc
       where dc.id = quadro_daily_items.conference_id
         and public.quadro_can_write_store(dc.store_id)
         and dc.status in ('DRAFT', 'REOPENED')
    )
  );

drop policy if exists quadro_daily_items_update on public.quadro_daily_items;
create policy quadro_daily_items_update on public.quadro_daily_items
  for update to authenticated
  using (
    exists (
      select 1 from public.quadro_daily_conferences dc
       where dc.id = quadro_daily_items.conference_id
         and public.quadro_can_write_store(dc.store_id)
         and dc.status in ('DRAFT', 'REOPENED')
    )
  )
  with check (
    exists (
      select 1 from public.quadro_daily_conferences dc
       where dc.id = quadro_daily_items.conference_id
         and public.quadro_can_write_store(dc.store_id)
    )
  );

-- A RPC de rascunho apaga funções que saíram do payload.
drop policy if exists quadro_daily_items_delete on public.quadro_daily_items;
create policy quadro_daily_items_delete on public.quadro_daily_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.quadro_daily_conferences dc
       where dc.id = quadro_daily_items.conference_id
         and public.quadro_can_write_store(dc.store_id)
         and dc.status in ('DRAFT', 'REOPENED')
    )
  );

-- ===========================================================================
-- Motivos dos itens (dois níveis acima até a conferência)
-- ===========================================================================
drop policy if exists quadro_daily_item_reasons_select on public.quadro_daily_item_reasons;
create policy quadro_daily_item_reasons_select on public.quadro_daily_item_reasons
  for select to authenticated
  using (
    exists (
      select 1
        from public.quadro_daily_items di
        join public.quadro_daily_conferences dc on dc.id = di.conference_id
       where di.id = quadro_daily_item_reasons.daily_item_id
         and public.quadro_can_access_store(dc.store_id)
    )
  );

drop policy if exists quadro_daily_item_reasons_insert on public.quadro_daily_item_reasons;
create policy quadro_daily_item_reasons_insert on public.quadro_daily_item_reasons
  for insert to authenticated
  with check (
    exists (
      select 1
        from public.quadro_daily_items di
        join public.quadro_daily_conferences dc on dc.id = di.conference_id
       where di.id = quadro_daily_item_reasons.daily_item_id
         and public.quadro_can_write_store(dc.store_id)
         and dc.status in ('DRAFT', 'REOPENED')
    )
  );

drop policy if exists quadro_daily_item_reasons_update on public.quadro_daily_item_reasons;
create policy quadro_daily_item_reasons_update on public.quadro_daily_item_reasons
  for update to authenticated
  using (
    exists (
      select 1
        from public.quadro_daily_items di
        join public.quadro_daily_conferences dc on dc.id = di.conference_id
       where di.id = quadro_daily_item_reasons.daily_item_id
         and public.quadro_can_write_store(dc.store_id)
         and dc.status in ('DRAFT', 'REOPENED')
    )
  )
  with check (
    exists (
      select 1
        from public.quadro_daily_items di
        join public.quadro_daily_conferences dc on dc.id = di.conference_id
       where di.id = quadro_daily_item_reasons.daily_item_id
         and public.quadro_can_write_store(dc.store_id)
    )
  );

drop policy if exists quadro_daily_item_reasons_delete on public.quadro_daily_item_reasons;
create policy quadro_daily_item_reasons_delete on public.quadro_daily_item_reasons
  for delete to authenticated
  using (
    exists (
      select 1
        from public.quadro_daily_items di
        join public.quadro_daily_conferences dc on dc.id = di.conference_id
       where di.id = quadro_daily_item_reasons.daily_item_id
         and public.quadro_can_write_store(dc.store_id)
         and dc.status in ('DRAFT', 'REOPENED')
    )
  );

-- ===========================================================================
-- Auditoria
-- ===========================================================================
-- Só é possível gravar log EM SEU PRÓPRIO NOME. Ninguém consegue dizer
-- "eu sou outro usuário".
drop policy if exists quadro_audit_logs_insert on public.quadro_audit_logs;
create policy quadro_audit_logs_insert on public.quadro_audit_logs
  for insert to authenticated
  with check (user_id = auth.uid());

-- Gerente não precisa da auditoria global; supervisor/admin consultam.
drop policy if exists quadro_audit_logs_select on public.quadro_audit_logs;
create policy quadro_audit_logs_select on public.quadro_audit_logs
  for select to authenticated
  using (public.quadro_current_profile_role() in ('SUPERVISOR', 'ADMIN'));

-- Sem UPDATE/DELETE: append-only (reforçado pelo gatilho de 0005).

-- ===========================================================================
-- Privilégios de tabela (RLS filtra LINHAS; o grant decide a OPERAÇÃO)
-- ===========================================================================
-- COEXISTÊNCIA: as revogações abaixo citam UMA A UMA as tabelas deste
-- sistema. Um `revoke all on all tables in schema public from anon` tiraria
-- também os privilégios das tabelas de OUTROS sistemas que compartilham o
-- schema public — por isso não é usado aqui.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.quadro_stores, public.quadro_positions,
             public.quadro_store_staffing, public.quadro_absence_reasons,
             public.quadro_profiles, public.quadro_daily_conferences,
             public.quadro_daily_items, public.quadro_daily_item_reasons,
             public.quadro_audit_logs from anon';
    execute 'revoke all on public.quadro_v_conference_items,
             public.quadro_v_conference_item_reasons from anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    -- COEXISTÊNCIA: nada de `grant/revoke ... on schema public`. O privilégio
    -- de USAGE no schema é do dono do banco e já está concedido no Supabase;
    -- mexer nele afetaria todos os sistemas que compartilham o schema.
    execute 'grant select on public.quadro_stores, public.quadro_positions, public.quadro_store_staffing,
             public.quadro_absence_reasons, public.quadro_profiles, public.quadro_daily_conferences,
             public.quadro_daily_items, public.quadro_daily_item_reasons, public.quadro_audit_logs
             to authenticated';

    -- Escrita só onde a RPC precisa. Ninguém apaga conferência nem cadastro.
    execute 'grant insert, update on public.quadro_daily_conferences to authenticated';
    execute 'grant insert, update, delete on public.quadro_daily_items to authenticated';
    execute 'grant insert, update, delete on public.quadro_daily_item_reasons to authenticated';
    execute 'grant insert on public.quadro_audit_logs to authenticated';
    execute 'grant insert, update on public.quadro_profiles to authenticated';
  end if;
end
$$;


-- ===========================================================================
-- 0012_seed_absence_reasons.sql
-- ===========================================================================
-- 0012 — Motivos de falta ----------------------------------------------------
-- FOLGA NÃO ESTÁ AQUI de propósito: folga tem campo próprio
-- (quadro_daily_items.day_off_quantity) e nunca é motivo de falta.

insert into public.quadro_absence_reasons (id, name, active, display_order, requires_observation) values
  ('reason-atestado-medico',            'Atestado médico',             true, 1, false),
  ('reason-falta-injustificada',        'Falta injustificada',         true, 2, false),
  ('reason-ausencia-justificada',       'Ausência justificada',        true, 3, false),
  ('reason-declaracao-comparecimento',  'Declaração / comparecimento', true, 4, false),
  ('reason-afastamento',                'Afastamento',                 true, 5, false),
  ('reason-licenca',                    'Licença',                     true, 6, false),
  ('reason-suspensao',                  'Suspensão',                   true, 7, false),
  ('reason-outros',                     'Outros',                      true, 8, true)
on conflict (id) do update
  set name = excluded.name,
      display_order = excluded.display_order,
      requires_observation = excluded.requires_observation;


-- ===========================================================================
-- 0013_districts.sql
-- ===========================================================================
-- 0013 -- Distritos --------------------------------------------------------
--
-- COEXISTENCIA: cria SOMENTE objetos com prefixo quadro_. Nao faz DROP nem
-- ALTER em nada do sistema Organico, nao mexe em privilegio de schema e nao
-- instala extensao.
--
-- POR QUE UMA TABELA, E NAO UM TEXTO EM CADA LOJA
-- ----------------------------------------------
-- O responsavel pelo distrito muda. Se o nome estivesse repetido nas 20 lojas
-- do Distrito 1, trocar o gerente distrital viraria um UPDATE em 20 linhas --
-- e qualquer uma esquecida vira inconsistencia silenciosa. Aqui a troca e uma
-- linha so.
--
-- ATENCAO: `manager_name` e INFORMATIVO. Nao autoriza nada. Quem decide acesso
-- e `quadro_profiles.access_scope` + `district_id`, lidos de auth.uid().

create table if not exists public.quadro_districts (
  id           text primary key,
  code         text not null,
  name         text not null,
  -- Responsavel atual do distrito. Somente exibicao.
  manager_name text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  constraint quadro_districts_code_key unique (code)
);

comment on table public.quadro_districts is
  'Distritos da rede. manager_name e informativo: a autorizacao vem de '
  'quadro_profiles.access_scope e district_id, nunca deste campo.';

-- ---------------------------------------------------------------------------
-- Lojas ganham distrito e nome por extenso
-- ---------------------------------------------------------------------------
--
-- `district_id` e NULLABLE de proposito:
--   1. a coluna entra sem quebrar as linhas que ja existem;
--   2. uma loja sem distrito fica INVISIVEL para supervisor distrital, que e
--      o padrao seguro -- ninguem ganha acesso por descuido de cadastro.
alter table public.quadro_stores
  add column if not exists district_id text
    references public.quadro_districts (id) on delete restrict;

-- Nome por extenso. A loja 124 ja esta gravada como "PARQUE SHOPPING"; o nome
-- operacional passa a ser "PQSHOP" e o longo e preservado aqui.
alter table public.quadro_stores
  add column if not exists full_name text;

create index if not exists quadro_stores_district_idx
  on public.quadro_stores (district_id);

comment on column public.quadro_stores.district_id is
  'Distrito da loja. NULL = sem distrito: nao aparece para supervisor '
  'distrital (padrao seguro).';


-- ===========================================================================
-- 0014_access_scope.sql
-- ===========================================================================
-- 0014 -- Escopo de acesso ---------------------------------------------------
--
-- O PROBLEMA QUE ISTO RESOLVE
-- ---------------------------
-- Ate aqui `role` respondia duas perguntas ao mesmo tempo: "o que a pessoa faz"
-- e "ate onde ela enxerga". Com a chegada dos gerentes distritais isso deixa de
-- funcionar: Paulo, Ericson e Roberval sao todos SUPERVISOR, mas Paulo enxerga
-- 20 lojas, Ericson 14 e Roberval as 34.
--
-- A saida foi separar as duas perguntas em vez de multiplicar papeis
-- (SUPERVISOR_D1, SUPERVISOR_D2, SUPERVISOR_GERAL...), que exigiria mexer na
-- RLS a cada distrito novo:
--
--   role         -> o que a pessoa faz   (MANAGER / SUPERVISOR / ADMIN)
--   access_scope -> ate onde ela enxerga (STORE / DISTRICT / ALL)
--
-- Distrito novo no futuro = uma linha em quadro_districts e um perfil. Nenhuma
-- policy muda.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'quadro_access_scope') then
    create type public.quadro_access_scope as enum ('STORE', 'DISTRICT', 'ALL');
  end if;
end
$$;

alter table public.quadro_profiles
  add column if not exists access_scope public.quadro_access_scope;

alter table public.quadro_profiles
  add column if not exists district_id text
    references public.quadro_districts (id) on delete restrict;

-- Cargo exibido na tela ("Gerente Distrital", "Gerente Geral").
-- INFORMATIVO. Nenhuma policy olha para este campo.
alter table public.quadro_profiles
  add column if not exists job_title text;

comment on column public.quadro_profiles.job_title is
  'Cargo exibido na interface. NUNCA usado como regra de seguranca.';

-- ---------------------------------------------------------------------------
-- Backfill: preserva EXATAMENTE o comportamento atual
-- ---------------------------------------------------------------------------
--
--   MANAGER            -> STORE  (ja enxergava so a propria loja)
--   SUPERVISOR / ADMIN -> ALL    (ja enxergavam a rede toda)
--
-- Ninguem ganha nem perde acesso nesta migration. O gerente da 124 continua
-- vendo a 124; supervisor e admin continuam vendo tudo.
update public.quadro_profiles
   set access_scope = case when role = 'MANAGER' then 'STORE'::public.quadro_access_scope
                           else 'ALL'::public.quadro_access_scope end
 where access_scope is null;

-- Perfil de escopo ALL nao deve carregar loja: o campo seria ignorado pela RLS
-- e so confundiria quem lesse a tabela. Limpa apenas o que ficaria orfao.
update public.quadro_profiles
   set store_id = null
 where access_scope = 'ALL'
   and store_id is not null;

alter table public.quadro_profiles
  alter column access_scope set not null;

alter table public.quadro_profiles
  alter column access_scope set default 'STORE';

-- ---------------------------------------------------------------------------
-- Coerencia do escopo, garantida pelo banco
-- ---------------------------------------------------------------------------
--
-- Sem isto, um perfil DISTRICT sem district_id enxergaria zero loja (falha
-- silenciosa), e um perfil STORE sem store_id tambem. O banco recusa os dois.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'quadro_profiles_scope_ck'
  ) then
    alter table public.quadro_profiles
      add constraint quadro_profiles_scope_ck check (
        (access_scope = 'STORE'    and store_id is not null and district_id is null)
        or (access_scope = 'DISTRICT' and district_id is not null and store_id is null)
        or (access_scope = 'ALL'      and store_id is null and district_id is null)
      );
  end if;
end
$$;

create index if not exists quadro_profiles_district_idx
  on public.quadro_profiles (district_id);

-- ---------------------------------------------------------------------------
-- O gatilho de privilegios passa a proteger tambem o escopo
-- ---------------------------------------------------------------------------
--
-- `quadro_guard_profile_privileges` ja impedia a propria pessoa de mudar role,
-- store_id e active. `access_scope` e `district_id` sao exatamente da mesma
-- natureza: quem pudesse trocar o proprio district_id trocaria de distrito
-- sozinho. Entram na mesma protecao.
-- AS QUATRO MENSAGENS ORIGINAIS FICAM LETRA POR LETRA COMO ESTAO EM 0003,
-- ACENTOS INCLUSIVE. Um rascunho desta migration reescreveu tudo sem acento
-- "por seguranca de encoding" e mudou o texto que o banco devolve -- os testes
-- da fase 1 pegaram. A regra ASCII vale para o SEED GERADO (0016), que passa
-- por transporte que ja corrompeu acento uma vez; nao para uma mensagem que
-- ja roda em producao ha fases.
--
-- A funcao abaixo e a de 0003 com DUAS verificacoes a mais. Todo o resto --
-- leitura do papel do ator, saida antecipada para ADMIN, as quatro checagens
-- originais e o errcode 42501 -- fica igual: esta migration ACRESCENTA
-- protecao, nunca remove.
create or replace function public.quadro_guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.quadro_profile_role;
begin
  select p.role into v_actor_role
    from public.quadro_profiles p
   where p.id = auth.uid() and p.active;

  -- ADMIN pode administrar perfis.
  if v_actor_role = 'ADMIN' then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Alteração de perfil (role) não permitida.' using errcode = '42501';
  end if;

  if new.store_id is distinct from old.store_id then
    raise exception 'Alteração de loja do usuário não permitida.' using errcode = '42501';
  end if;

  if new.active is distinct from old.active then
    raise exception 'Ativação/desativação de usuário não permitida.' using errcode = '42501';
  end if;

  if new.id is distinct from old.id then
    raise exception 'Alteração de id de perfil não permitida.' using errcode = '42501';
  end if;

  -- NOVO NESTA FASE. Sem isto, um supervisor distrital trocaria o proprio
  -- district_id e passaria a enxergar o outro distrito -- exatamente o ataque
  -- que a fase pede para bloquear.
  if new.access_scope is distinct from old.access_scope then
    raise exception 'Alteração de escopo de acesso não permitida.' using errcode = '42501';
  end if;

  if new.district_id is distinct from old.district_id then
    raise exception 'Alteração de distrito do usuário não permitida.' using errcode = '42501';
  end if;

  return new;
end;
$$;


-- ===========================================================================
-- 0015_scope_rls.sql
-- ===========================================================================
-- 0015 -- RLS por escopo -----------------------------------------------------
--
-- Substitui os helpers de acesso para entenderem STORE / DISTRICT / ALL.
--
-- O QUE NAO MUDA
-- --------------
--   - a ESCRITA continua sendo so do gerente da propria loja;
--   - conferencia SUBMITTED continua imutavel para todo mundo, inclusive ADMIN;
--   - nenhuma policy vira USING (true);
--   - nenhum objeto do Organico e tocado.
--
-- DE ONDE VEM A AUTORIZACAO
-- -------------------------
--       auth.uid()  ->  quadro_profiles  ->  access_scope + store_id/district_id
--
-- Nunca do frontend. As funcoes abaixo NAO aceitam parametro que troque a
-- identidade: recebem a loja consultada e olham o proprio perfil de quem
-- pergunta. Um usuario pode forjar qualquer coisa no navegador -- district_id
-- na URL, store_id no filtro, payload adulterado -- e nada disso chega aqui.

-- Distrito do usuario autenticado. NULL para escopo STORE e ALL.
create or replace function public.quadro_current_profile_district_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.district_id
    from public.quadro_profiles p
   where p.id = auth.uid()
     and p.active;
$$;

-- Escopo do usuario autenticado. NULL = sem perfil ativo (logado, sem acesso).
create or replace function public.quadro_current_access_scope()
returns public.quadro_access_scope
language sql
stable
security definer
set search_path = ''
as $$
  select p.access_scope
    from public.quadro_profiles p
   where p.id = auth.uid()
     and p.active;
$$;

-- ---------------------------------------------------------------------------
-- LEITURA de loja
-- ---------------------------------------------------------------------------
--
--   STORE     -> so a propria loja
--   DISTRICT  -> so lojas cujo district_id bate com o do perfil
--   ALL       -> a rede inteira
--
-- O join com quadro_stores acontece DENTRO de uma funcao security definer, e e
-- de proposito: o distrito verdadeiro da loja precisa ser lido sem passar pela
-- RLS de quadro_stores, senao a policy chamaria a si mesma.
--
-- Loja com district_id NULL nao aparece para escopo DISTRICT: `s.district_id =
-- p.district_id` e falso quando um dos lados e NULL. Padrao seguro -- descuido
-- de cadastro nao vira acesso indevido.
create or replace function public.quadro_can_access_store(p_store_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.quadro_profiles p
      left join public.quadro_stores s on s.id = p_store_id
     where p.id = auth.uid()
       and p.active
       and (
         p.access_scope = 'ALL'
         or (p.access_scope = 'STORE'    and p.store_id = p_store_id)
         or (p.access_scope = 'DISTRICT' and s.district_id = p.district_id)
       )
  );
$$;

-- ---------------------------------------------------------------------------
-- LEITURA de distrito
-- ---------------------------------------------------------------------------
--
--   ALL       -> todos os distritos (para o filtro "Todos os distritos")
--   DISTRICT  -> so o proprio
--   STORE     -> so o distrito da propria loja, para a tela exibir o nome
create or replace function public.quadro_can_access_district(p_district_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.quadro_profiles p
      left join public.quadro_stores s on s.id = p.store_id
     where p.id = auth.uid()
       and p.active
       and (
         p.access_scope = 'ALL'
         or (p.access_scope = 'DISTRICT' and p.district_id = p_district_id)
         or (p.access_scope = 'STORE'    and s.district_id = p_district_id)
       )
  );
$$;

-- ---------------------------------------------------------------------------
-- ESCRITA -- inalterada na pratica
-- ---------------------------------------------------------------------------
--
-- Continua sendo somente o gerente da propria loja. Escopo DISTRICT e ALL NAO
-- ganham escrita: nao existe regra de negocio que permita supervisor lancar
-- falta no lugar do gerente. Quando existir (reabertura), sera RPC propria,
-- explicita e auditada.
create or replace function public.quadro_can_write_store(p_store_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.quadro_profiles p
     where p.id = auth.uid()
       and p.active
       and p.role = 'MANAGER'
       and p.access_scope = 'STORE'
       and p.store_id = p_store_id
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS da tabela de distritos
-- ---------------------------------------------------------------------------
alter table public.quadro_districts enable row level security;

drop policy if exists quadro_districts_select on public.quadro_districts;
create policy quadro_districts_select on public.quadro_districts
  for select to authenticated
  using (public.quadro_can_access_district(id));

-- Sem policy de INSERT/UPDATE/DELETE: distrito nao se cria nem se apaga pela
-- API. E manutencao administrativa, por SQL.

-- ---------------------------------------------------------------------------
-- Perfis: supervisor distrital enxerga so a propria gente
-- ---------------------------------------------------------------------------
--
-- Antes: qualquer SUPERVISOR ou ADMIN lia TODOS os perfis. Com distritos isso
-- vazaria o diretorio da rede inteira para um supervisor distrital.
--
-- Agora:
--   - a propria linha, sempre;
--   - ADMIN e escopo ALL: todos os perfis;
--   - escopo DISTRICT: so perfis do proprio distrito -- inclusive os gerentes
--     das lojas do distrito, que e o que a tela de conferencias precisa para
--     mostrar quem enviou.
drop policy if exists quadro_profiles_select on public.quadro_profiles;
create policy quadro_profiles_select on public.quadro_profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.quadro_current_access_scope() = 'ALL'
    or (
      public.quadro_current_access_scope() = 'DISTRICT'
      and (
        -- perfil distrital do mesmo distrito
        district_id = public.quadro_current_profile_district_id()
        -- ou gerente de uma loja do distrito
        or exists (
          select 1
            from public.quadro_stores s
           where s.id = quadro_profiles.store_id
             and s.district_id = public.quadro_current_profile_district_id()
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Privilegios do novo objeto
-- ---------------------------------------------------------------------------
--
-- COEXISTENCIA: cada GRANT/REVOKE cita nominalmente o objeto quadro_*. Nada
-- de `on all tables in schema`, que atingiria as tabelas do Organico.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.quadro_districts from anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on public.quadro_districts to authenticated';
    execute 'grant execute on function public.quadro_current_profile_district_id() to authenticated';
    execute 'grant execute on function public.quadro_current_access_scope() to authenticated';
    execute 'grant execute on function public.quadro_can_access_district(text) to authenticated';
  end if;
end
$$;

revoke all on function public.quadro_current_profile_district_id() from public;
revoke all on function public.quadro_current_access_scope()        from public;
revoke all on function public.quadro_can_access_district(text)     from public;


-- ===========================================================================
-- 0016_seed_network.sql
-- ===========================================================================
-- 0016 -- Rede oficial: 2 distritos e 34 lojas ---------------------------
--
-- ARQUIVO GERADO. Regerar: python3 scripts/build_network.py
--
-- IDEMPOTENTE: pode rodar quantas vezes quiser. Usa `on conflict do update`,
-- entao rodar de novo apenas reafirma os valores.
--
-- PRESERVA A LOJA 124
-- -------------------
-- `store-124` JA EXISTE no banco, com perfil de gerente e conferencias
-- vinculadas. Este seed NAO a apaga nem a recria: ela entra pelo mesmo id no
-- `on conflict (id) do update`, que so atualiza nome, nome longo e distrito.
-- A chave primaria, as FKs, o historico e o login do gerente continuam
-- exatamente como estavam.
--
-- O nome operacional passa de "PARQUE SHOPPING" para "PQSHOP" (padrao da
-- rede), e "PARQUE SHOPPING" e guardado em `full_name`, entao nada se perde.

-- ---------------------------------------------------------------------------
-- Distritos
-- ---------------------------------------------------------------------------
insert into public.quadro_districts (id, code, name, manager_name) values
    ('district-1', '1', 'Distrito 1', 'Paulo Sergio'),
    ('district-2', '2', 'Distrito 2', 'Ericson Silva')
on conflict (id) do update
  set code         = excluded.code,
      name         = excluded.name,
      manager_name = excluded.manager_name,
      active       = true;

-- ---------------------------------------------------------------------------
-- Lojas
-- ---------------------------------------------------------------------------
insert into public.quadro_stores (id, code, name, full_name, district_id) values
    ('store-119'   , '119' , 'ITAIGARA'    , null                , 'district-1'),
    ('store-108'   , '108' , 'PITUBA'      , null                , 'district-1'),
    ('store-127'   , '127' , 'PATAMARES'   , null                , 'district-1'),
    ('store-104'   , '104' , 'LNORTE'      , null                , 'district-1'),
    ('store-122'   , '122' , 'OGOMES'      , null                , 'district-1'),
    ('store-126'   , '126' , 'GUARAJUBA'   , null                , 'district-1'),
    ('store-110'   , '110' , 'PFORTE'      , null                , 'district-1'),
    ('store-118'   , '118' , 'ICARDIM'     , null                , 'district-1'),
    ('store-128'   , '128' , 'CARVORES'    , null                , 'district-1'),
    ('store-125'   , '125' , 'ORLA'        , null                , 'district-1'),
    ('store-102'   , '102' , 'STELLA'      , null                , 'district-1'),
    ('store-132'   , '132' , 'ALPHAVILLE'  , null                , 'district-1'),
    ('store-133'   , '133' , 'AQUARIUS'    , null                , 'district-1'),
    ('store-131'   , '131' , 'FSANTANA'    , null                , 'district-1'),
    ('store-124'   , '124' , 'PQSHOP'      , 'PARQUE SHOPPING'   , 'district-1'),
    ('store-113'   , '113' , 'ECOSTELLA'   , null                , 'district-1'),
    ('store-307'   , '307' , 'LEPARC'      , 'LE PARC'           , 'district-1'),
    ('store-310'   , '310' , 'HEMISPHE'    , 'HEMISFERIO'        , 'district-1'),
    ('store-308'   , '308' , 'SAUIPE'      , 'SAUIPE'            , 'district-1'),
    ('store-309'   , '309' , 'IBERO'       , 'IBEROSTAR'         , 'district-1'),
    ('store-115'   , '115' , 'CANELA'      , null                , 'district-2'),
    ('store-129'   , '129' , 'HORTO'       , null                , 'district-2'),
    ('store-114'   , '114' , 'ARMACAO'     , null                , 'district-2'),
    ('store-120'   , '120' , 'MDIAS'       , null                , 'district-2'),
    ('store-107'   , '107' , 'BARRA'       , null                , 'district-2'),
    ('store-130'   , '130' , 'AMAZONAS'    , null                , 'district-2'),
    ('store-105'   , '105' , 'LAPA'        , null                , 'district-2'),
    ('store-117'   , '117' , 'VLAURA'      , null                , 'district-2'),
    ('store-123'   , '123' , 'VITORIA'     , null                , 'district-2'),
    ('store-109'   , '109' , 'PARALELA'    , null                , 'district-2'),
    ('store-106'   , '106' , 'GRACA'       , null                , 'district-2'),
    ('store-121'   , '121' , 'APIPEMA'     , null                , 'district-2'),
    ('store-306'   , '306' , 'CESPANA'     , 'COSTA ESPANHA'     , 'district-2'),
    ('store-311'   , '311' , 'PANAMBY'     , 'PANAMBY'           , 'district-2')
on conflict (id) do update
  set code        = excluded.code,
      name        = excluded.name,
      -- Nao apaga um nome longo que ja exista no banco se o seed nao trouxer um.
      full_name   = coalesce(excluded.full_name, public.quadro_stores.full_name),
      district_id = excluded.district_id,
      active      = true;

-- ---------------------------------------------------------------------------
-- Conferencia do resultado
-- ---------------------------------------------------------------------------
do $$
declare
  v_total int;
  v_d1    int;
  v_d2    int;
begin
  select count(*) into v_total from public.quadro_stores where active;
  select count(*) into v_d1    from public.quadro_stores where active and district_id = 'district-1';
  select count(*) into v_d2    from public.quadro_stores where active and district_id = 'district-2';

  if v_total <> 34 then
    raise exception 'Esperado 34 lojas ativas, encontrado %', v_total;
  end if;
  if v_d1 <> 20 then
    raise exception 'Esperado 20 lojas no Distrito 1, encontrado %', v_d1;
  end if;
  if v_d2 <> 14 then
    raise exception 'Esperado 14 lojas no Distrito 2, encontrado %', v_d2;
  end if;

  raise notice 'Rede oficial: % lojas ativas (D1=%, D2=%)', v_total, v_d1, v_d2;
end
$$;


-- ===========================================================================
-- 0017_seed_network_staffing.sql
-- ===========================================================================
-- ===========================================================================
-- 0017 -- FUNCOES DISPONIVEIS EM TODAS AS LOJAS DA REDE
-- ===========================================================================
--
-- O PROBLEMA QUE ESTA MIGRATION RESOLVE
-- -------------------------------------
-- A tela do gerente carrega as funcoes da loja por `quadro_store_staffing`:
--
--     select ... from quadro_store_staffing
--      where store_id = ? and effective_to is null
--
-- Ate a fase 4 so existia a loja 124, com seus 25 vinculos. Depois de abrir a
-- rede para 34 lojas, as outras 33 entrariam com a lista de funcoes VAZIA --
-- o gerente faria login e nao teria em que lancar falta nem folga.
--
-- Verificado antes de escrever esta migration, num banco com as 34 lojas:
-- 33 lojas com 0 funcoes, 1 loja com 25.
--
--
-- POR QUE UM ARQUIVO NOVO, E NAO DENTRO DE 0016
-- --------------------------------------------
-- 0016 e GERADO por scripts/build_network.py. Logica escrita a mao la dentro
-- seria apagada na proxima regeracao -- ou o gerador teria que aprender sobre
-- staffing, que nao e assunto dele: ele responde "quais lojas existem", nao
-- "que funcoes cada loja confere". As duas coisas mudam por motivos
-- diferentes, entao ficam em arquivos diferentes.
--
--
-- ATENCAO A ORDEM DE EXECUCAO -- LEIA ANTES DE MOVER ESTE ARQUIVO
-- ---------------------------------------------------------------
-- Este seed depende de DUAS fontes:
--
--     quadro_stores      <- migration 0016
--     quadro_positions   <- seed.sql   (NAO e migration)
--
-- E `install.sql` roda as migrations ANTES do seed.sql. Ou seja: num banco
-- NOVO, quando esta migration executa na ordem numerica, o catalogo de funcoes
-- ainda esta vazio e o insert acerta zero linhas.
--
-- Duas providencias, porque uma so nao bastaria:
--
--   1. build_schema.sh REPETE este arquivo no fim do install.sql, depois do
--      seed. Como tudo aqui e idempotente, executar duas vezes nao duplica
--      nada -- a primeira passada nao acha funcao e nao faz nada, a segunda
--      cria os vinculos;
--
--   2. o bloco de verificacao no fim distingue os dois casos e AVISA. Zero
--      vinculo com catalogo vazio e situacao esperada e passa; zero vinculo
--      com catalogo cheio e defeito e levanta excecao.
--
-- No banco que ja esta em producao (que tem as funcoes ha fases) a ordem nao
-- e problema nenhum: rodar 0013..0017 em sequencia funciona direto.
--
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ----------------------------
-- NAO inventa quadro autorizado. Todo vinculo novo nasce com
-- `authorized_quantity = NULL`, que e como o sistema diz "nao informado".
-- Enquanto for NULL, nenhuma tela calcula percentual de impacto sobre o
-- quadro -- nao existe denominador real, e um numero inventado seria pior que
-- numero nenhum.
--
-- NAO toca nos vinculos que ja existem. A loja 124 mantem seus 25 registros
-- originais: mesmos ids, mesmo `effective_from`, mesmo `authorized_quantity`.
-- O `not exists` abaixo pula qualquer par (loja, funcao) que ja tenha vinculo
-- ativo, entao rodar isto na 124 nao cria uma segunda linha nem sobrescreve a
-- primeira.
--
-- NAO consolida funcao nenhuma. ATENDENTE ALIMENTOS - PADARIA, - FATIADOS e
-- - FRUTAS entram como tres vinculos separados em cada loja, e o mesmo vale
-- para AUX. DE COZINHA e REPOSITOR. O cadastro operacional segue a planilha.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Os vinculos que faltam
--
-- CROSS JOIN entre lojas ativas e funcoes ativas, menos o que ja existe.
-- Escrever 850 linhas a mao daria o mesmo resultado hoje e estaria errado
-- amanha: loja nova ou funcao nova exigiria reescrever o arquivo, e e
-- exatamente ai que uma linha se perde sem ninguem notar.
--
-- ID DETERMINISTICO, no mesmo padrao dos registros que ja existem:
--
--     store-124 + pos-operador-de-caixa  ->  staff-124-operador-de-caixa
--     store-307 + pos-operador-de-caixa  ->  staff-307-operador-de-caixa
--
-- Determinismo aqui nao e estetica: como o id e sempre o mesmo para o mesmo
-- par, a chave primaria vira a segunda barreira contra duplicata, junto com o
-- indice unico parcial `quadro_store_staffing_active_unique_idx`.
--
-- `effective_from = current_date`: o vinculo passa a valer quando a rede foi
-- implantada. Copiar a data da 124 (2026-01-01) seria inventar que a loja 307
-- confere funcoes desde janeiro.
-- ---------------------------------------------------------------------------
insert into public.quadro_store_staffing
  (id, store_id, position_id, authorized_quantity, effective_from)
select 'staff-' || s.code || '-' || regexp_replace(p.id, '^pos-', ''),
       s.id,
       p.id,
       null,
       current_date
  from public.quadro_stores s
 cross join public.quadro_positions p
 where s.active
   and p.active
   and not exists (
     select 1
       from public.quadro_store_staffing existente
      where existente.store_id = s.id
        and existente.position_id = p.id
        and existente.effective_to is null
   )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Verificacao -- o banco cobra o proprio resultado
--
-- Um seed pela metade e pior que um seed que falha: ele instala silenciosamente
-- uma rede em que algumas lojas nao conseguem lancar conferencia, e isso so
-- aparece quando um gerente tenta usar o sistema.
-- ---------------------------------------------------------------------------
do $$
declare
  v_lojas      integer;
  v_funcoes    integer;
  v_vinculos   integer;
  v_incompleta text;
begin
  select count(*) into v_lojas   from public.quadro_stores    where active;
  select count(*) into v_funcoes from public.quadro_positions where active;

  select count(*) into v_vinculos
    from public.quadro_store_staffing st
    join public.quadro_stores    s on s.id = st.store_id    and s.active
    join public.quadro_positions p on p.id = st.position_id and p.active
   where st.effective_to is null;

  -- Catalogo de funcoes ainda vazio: e a ordem de instalacao, nao um defeito.
  -- build_schema.sh roda este arquivo de novo depois do seed.
  if v_funcoes = 0 then
    raise notice
      'Staffing: catalogo de funcoes vazio -- nada a vincular. Rode este arquivo novamente APOS o seed.sql.';
    return;
  end if;

  -- Alguma loja ficou sem o conjunto completo de funcoes.
  select string_agg(s.code || ' (' || v.n || ')', ', ' order by s.code)
    into v_incompleta
    from (
      select st.store_id, count(*) as n
        from public.quadro_store_staffing st
        join public.quadro_positions p on p.id = st.position_id and p.active
       where st.effective_to is null
       group by st.store_id
    ) v
    right join public.quadro_stores s on s.id = v.store_id and s.active
   where s.active
     and coalesce(v.n, 0) <> v_funcoes;

  if v_incompleta is not null then
    raise exception
      'Staffing incompleto: as lojas a seguir nao ficaram com % funcoes -> %',
      v_funcoes, v_incompleta;
  end if;

  if v_vinculos <> v_lojas * v_funcoes then
    raise exception
      'Staffing inconsistente: esperado % vinculos (% lojas x % funcoes), encontrado %.',
      v_lojas * v_funcoes, v_lojas, v_funcoes, v_vinculos;
  end if;

  raise notice 'Staffing da rede: % vinculos ativos (% lojas x % funcoes).',
    v_vinculos, v_lojas, v_funcoes;
end $$;


-- ===========================================================================
-- 0018_pending_reason_resolution.sql
-- ===========================================================================
-- 0018 — PRÉ-REGISTRO DO DIA E RESOLUÇÃO DE JUSTIFICATIVA PENDENTE ----------
--
-- Esta migration faz cinco coisas, e todas elas existem pelo mesmo motivo: o
-- FATO da ausência e o MOTIVO da ausência acontecem em momentos diferentes.
--
--   18.1  o motivo provisório "Aguardando justificativa";
--   18.2  a proteção de data DENTRO das RPCs (dívida da fase 4.3);
--   18.3  uma autorização de sessão ESTREITA, só para resolver motivo;
--   18.4  o gatilho de motivos passando a reconhecer essa autorização;
--   18.5  a RPC de resolução, transacional e auditada.
--
-- NADA aqui altera migrations 0001–0017: as funções e políticas que mudam são
-- substituídas por `create or replace` / `drop policy ... create policy`, que é
-- o mesmo mecanismo que a 0015 usou para reescrever `quadro_can_write_store`.
--
-- Nenhum objeto fora do prefixo `quadro_` é tocado. Nenhum ALTER DEFAULT
-- PRIVILEGES, nenhum grant global, nenhuma extensão, nada em auth.users.

-- ===========================================================================
-- 18.1 — O motivo provisório
-- ===========================================================================
--
-- "Aguardando justificativa" NÃO é sinônimo de falta injustificada. Ele diz
-- exatamente o que se sabe no momento do lançamento: a ausência ocorreu, o
-- documento ainda não chegou. Tratar como injustificada seria registrar uma
-- acusação que ninguém apurou; deixar a falta sem motivo seria impedir o envio
-- da conferência por uma informação que ainda não existe.
--
-- `requires_observation = false`: exigir texto para dizer "ainda não sei" é
-- pedir ao gerente que escreva a mesma frase todo dia. A observação continua
-- disponível, opcional.
--
-- display_order 9 o coloca DEPOIS de "Outros" — ele é a saída de exceção, não
-- a primeira opção que o olho encontra.
insert into public.quadro_absence_reasons (id, name, active, display_order, requires_observation)
values ('reason-aguardando-justificativa', 'Aguardando justificativa', true, 9, false)
on conflict (id) do update
  set name = excluded.name,
      active = excluded.active,
      display_order = excluded.display_order,
      requires_observation = excluded.requires_observation;

-- ===========================================================================
-- 18.2 — PROTEÇÃO DE DATA NO SERVIDOR (dívida da fase 4.3)
-- ===========================================================================
--
-- Até aqui, "hoje e futuro não podem ser conferidos" morava SÓ em
-- `src/services/conferenceService.ts`. Auditado nesta fase: nenhuma das duas
-- RPCs olhava para `reference_date`, e não havia CHECK na tabela. Uma chamada
-- direta ao PostgREST com token de gerente autenticado enviava conferência de
-- amanhã, e ela entrava nos números oficiais do supervisor.
--
-- A tela bloqueia por EXPERIÊNCIA. A RPC bloqueia por INTEGRIDADE.
--
-- Por que não um CHECK na tabela: a data operacional não é imutável, e um CHECK
-- que depende do relógio é reavaliado em dump/restore e em VALIDATE CONSTRAINT
-- — uma linha válida hoje pode ser recusada na restauração de amanhã. A regra
-- pertence ao caminho de escrita, que é a RPC.

-- ---------------------------------------------------------------------------
-- 18.2.0 A DATA OPERACIONAL — e por que NÃO pode ser `current_date`
-- ---------------------------------------------------------------------------
--
-- `current_date` depende do TimeZone DA SESSÃO. O Supabase roda em UTC, e o
-- PostgREST deixa o cliente escolher o fuso da requisição com o cabeçalho
-- `Prefer: timezone=...`. Ou seja: quem chama a API escolhia que dia era hoje.
--
-- Isso foi EXPLORADO de verdade contra este banco, com o gerente legítimo:
--
--   set time zone 'Pacific/Kiritimati';   -- UTC+14
--   -- data operacional da Bahia: 2026-09-07 | current_date da sessão: 2026-09-08
--   ... save_draft  de 2026-09-08 (AMANHÃ na Bahia)  -> gravou
--   ... submit      de 2026-09-07 (HOJE   na Bahia)  -> SUBMITTED
--
-- As duas regras da fase caíram com um cabeçalho HTTP. Uma conferência de hoje
-- virou número oficial antes de o dia terminar.
--
-- A CORREÇÃO: a data operacional é a data CIVIL DA BAHIA, calculada a partir
-- do instante absoluto (`now()`, que é o mesmo em qualquer fuso) e convertida
-- explicitamente. O TimeZone da sessão não participa da conta.
--
-- O banco continua em UTC. NADA de `alter database ... set timezone`: mudar o
-- fuso global afetaria o sistema Organico, que divide este banco.
--
-- UMA função só, e não a expressão repetida em cada RPC: duas cópias divergem,
-- e divergir aqui significa gravar por uma regra e enviar por outra.
create or replace function public.quadro_business_date()
returns date
language sql
stable
set search_path = ''
as $$
  -- `now()` é o instante absoluto — igual em qualquer fuso de sessão.
  -- `at time zone` o converte no relógio de parede da Bahia.
  select (pg_catalog.now() at time zone 'America/Bahia')::date;
$$;

comment on function public.quadro_business_date() is
  'Data civil de operação (America/Bahia). NÃO usar current_date nas regras: '
  'ele segue o TimeZone da sessão, que o cliente escolhe via Prefer: timezone.';

revoke all on function public.quadro_business_date() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.quadro_business_date() to authenticated';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 18.2.0b O TAMANHO DA JANELA — o outro lado da mesma dívida
--
-- A data operacional fechou o lado de CIMA (hoje e o futuro). Faltava o lado de
-- BAIXO: as RPCs aceitavam qualquer data passada, por mais antiga que fosse.
--
-- A tela sempre ofereceu 7 dias (`REFERENCE_WINDOW_DAYS`), então o gerente nunca
-- viu uma data mais velha — mas "a tela não oferece" nunca foi uma regra. Uma
-- chamada direta ao PostgREST, com o token legítimo do próprio gerente, gravava
-- e ENVIAVA a conferência de três meses atrás, e ela entrava nos números
-- oficiais do supervisor como se tivesse sido conferida na época.
--
-- POR QUE UMA FUNÇÃO, E NÃO UM `- 7` NO CORPO DAS RPCs
-- ----------------------------------------------------
-- O número existe em dois lugares: aqui e em `REFERENCE_WINDOW_DAYS` no React.
-- Dois lugares divergem — é só questão de quando. Sendo uma função, o banco tem
-- UM valor, o self-check consegue cobrar as duas RPCs por nome, e um teste
-- compara o valor do banco com o do frontend e falha se alguém mexer só num
-- lado.
--
-- POR QUE 7. Sete cobre o pior caso comum: voltar de uma semana fora e
-- regularizar o que ficou. Não cobre "o mês inteiro", e isso é deliberado —
-- quanto mais longe a data, menos confiável é a memória de quem preenche.
--
-- REGULARIZAÇÃO ANTIGA NÃO É ISTO. Se um dia for preciso corrigir algo fora da
-- janela, será um fluxo separado de supervisor/admin, auditado — não um gerente
-- alargando a janela por chamada direta.
-- ---------------------------------------------------------------------------
create or replace function public.quadro_reference_window_days()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 7;
$$;

comment on function public.quadro_reference_window_days() is
  'Tamanho da janela de conferência, em dias. Espelha REFERENCE_WINDOW_DAYS do '
  'frontend; src/tests compara os dois. Rascunho: [D-N, D]. Envio: [D-N, D-1].';

revoke all on function public.quadro_reference_window_days() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.quadro_reference_window_days() to authenticated';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 18.2.a Rascunho: a janela inteira, hoje incluído. Futuro NÃO, antigo NÃO.
--
--     D-7 ...... D-1 ...... D          D+1
--     |------ pode gravar ---|          x
--     x
--    D-8: fora da janela
--
-- Hoje é explicitamente permitido porque é o pré-registro: o gerente lança a
-- ocorrência no próprio dia, enquanto lembra, e envia depois. É o mesmo DRAFT de
-- sempre — o banco não ganha status novo.
-- ---------------------------------------------------------------------------
create or replace function public.quadro_rpc_save_daily_conference_draft(
  p_store_id       text,
  p_reference_date date,
  p_items          jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_status public.quadro_conference_status;
  -- A data operacional é a data civil da BAHIA, não o `current_date` da
  -- sessão: o cliente escolhe o fuso da requisição, e não pode escolher que
  -- dia é hoje. Ver 18.2.0.
  v_business_date constant date := public.quadro_business_date();
  -- O piso da janela. Ver 18.2.0b — o mesmo número que a tela usa.
  v_window_days constant integer := public.quadro_reference_window_days();
  v_window_start constant date := v_business_date - v_window_days;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items precisa ser um array JSON.' using errcode = '22023';
  end if;

  -- FASE 4.5: o futuro não existe para ser conferido, nem como rascunho.
  -- Hoje é permitido (pré-registro); ontem e antes, dentro da janela, também.
  if p_reference_date > v_business_date then
    raise exception 'Data de referência no futuro (%): a conferência registra o que já aconteceu.',
      p_reference_date using errcode = '22007';
  end if;

  -- E o outro lado: a janela tem PISO. Sem isto, a tela limitava a 7 dias e uma
  -- chamada direta gravava a conferência de três meses atrás.
  if p_reference_date < v_window_start then
    raise exception
      'Data de referência % fora da janela de % dias: só de % em diante.',
      p_reference_date, v_window_days, v_window_start using errcode = '22007';
  end if;

  -- Gerente só escreve na própria loja. Supervisor/admin não escrevem aqui.
  if not public.quadro_can_write_store(p_store_id) then
    raise exception 'Sem permissão para lançar conferência da loja %.', p_store_id
      using errcode = '42501';
  end if;

  -- ATENÇÃO: sob RLS, `select ... for update` aplica TAMBÉM a política de
  -- UPDATE. Como a política de UPDATE exclui linhas SUBMITTED, travar direto
  -- faria a conferência enviada "sumir" e o erro sairia como se ela não
  -- existisse. Por isso lemos primeiro sem lock (política de SELECT) para
  -- produzir a mensagem correta, e só travamos quando ainda é editável.
  select dc.id, dc.status into v_id, v_status
    from public.quadro_daily_conferences dc
   where dc.store_id = p_store_id and dc.reference_date = p_reference_date;

  if v_status = 'SUBMITTED' then
    raise exception 'Conferência já enviada: edição bloqueada (loja %, data %).',
      p_store_id, p_reference_date using errcode = '55006';
  end if;

  if v_id is not null then
    -- Agora sim: trava a linha. Dois salvamentos simultâneos serializam aqui.
    select dc.id, dc.status into v_id, v_status
      from public.quadro_daily_conferences dc
     where dc.id = v_id
     for update;
  end if;

  if v_id is null then
    insert into public.quadro_daily_conferences (store_id, reference_date, status, created_by)
    values (p_store_id, p_reference_date, 'DRAFT', v_uid)
    on conflict (store_id, reference_date) do nothing
    returning id, status into v_id, v_status;

    -- Corrida: outro cliente inseriu entre o select e o insert.
    if v_id is null then
      select dc.id, dc.status into v_id, v_status
        from public.quadro_daily_conferences dc
       where dc.store_id = p_store_id and dc.reference_date = p_reference_date;

      if v_status = 'SUBMITTED' then
        raise exception 'Conferência já enviada: edição bloqueada (loja %, data %).',
          p_store_id, p_reference_date using errcode = '55006';
      end if;

      select dc.id into v_id
        from public.quadro_daily_conferences dc
       where dc.id = v_id
       for update;
    end if;
  end if;

  if v_id is null then
    raise exception 'Não foi possível abrir a conferência da loja % em %.',
      p_store_id, p_reference_date using errcode = '55006';
  end if;

  -- Funções que saíram do payload são removidas (sem deixar órfãos).
  delete from public.quadro_daily_items di
   where di.conference_id = v_id
     and not exists (
       select 1 from jsonb_array_elements(p_items) it
        where it->>'position_id' = di.position_id
     );

  insert into public.quadro_daily_items
    (conference_id, position_id, absence_quantity, day_off_quantity, observation)
  select v_id,
         it->>'position_id',
         greatest(0, coalesce((it->>'absence_quantity')::integer, 0)),
         greatest(0, coalesce((it->>'day_off_quantity')::integer, 0)),
         nullif(btrim(coalesce(it->>'observation', '')), '')
    from jsonb_array_elements(p_items) it
  on conflict (conference_id, position_id) do update
    set absence_quantity = excluded.absence_quantity,
        day_off_quantity = excluded.day_off_quantity,
        observation      = excluded.observation;

  -- Motivos: apaga tudo da conferência e regrava só o que veio com quantidade > 0.
  delete from public.quadro_daily_item_reasons dir
   using public.quadro_daily_items di
   where dir.daily_item_id = di.id
     and di.conference_id = v_id;

  insert into public.quadro_daily_item_reasons (daily_item_id, reason_id, quantity, observation)
  select di.id,
         r->>'reason_id',
         coalesce((r->>'quantity')::integer, 0),
         nullif(btrim(coalesce(r->>'observation', '')), '')
    from jsonb_array_elements(p_items) it
    join public.quadro_daily_items di
      on di.conference_id = v_id
     and di.position_id = it->>'position_id'
   cross join lateral jsonb_array_elements(coalesce(it->'reasons', '[]'::jsonb)) r
   where coalesce((r->>'quantity')::integer, 0) > 0;

  update public.quadro_daily_conferences set updated_at = now() where id = v_id;

  -- Auditoria gravada AQUI, na mesma transação — não depende do navegador.
  insert into public.quadro_audit_logs (user_id, action, entity, entity_id, store_id, metadata)
  values (
    v_uid, 'CONFERENCE_DRAFT_SAVED', 'quadro_daily_conferences', v_id::text, p_store_id,
    jsonb_build_object(
      'reference_date', p_reference_date,
      'quadro_positions', jsonb_array_length(p_items)
    )
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 18.2.b Envio: só o passado DENTRO da janela.
--
--     D-7 ...... D-1     D        D+1
--     |-- pode enviar --| x        x
--     x
--    D-8: fora da janela
--
-- Envio é o ato que transforma o lançamento em NÚMERO OFICIAL. O dia de hoje
-- ainda não terminou: uma conferência de hoje enviada de manhã já nasce
-- desatualizada à tarde. O pré-registro existe justamente para cobrir esse
-- intervalo sem falsear o número.
--
-- E o piso vale também aqui, por um motivo mais forte que no rascunho: rascunho
-- antigo é sujeira, envio antigo é NÚMERO OFICIAL retroativo — entra na Visão da
-- Rede como se tivesse sido conferido na época.
--
-- A janela é a mesma do rascunho; o topo é que difere em um dia (D-1, não D).
-- ---------------------------------------------------------------------------
create or replace function public.quadro_rpc_submit_daily_conference(p_conference_id uuid)
returns public.quadro_daily_conferences
language plpgsql
as $$
declare
  v_uid        uuid := auth.uid();
  v_conference public.quadro_daily_conferences;
  v_absences   integer;
  v_day_offs   integer;
  v_impacted   integer;
  -- Idem: data civil da Bahia, imune ao fuso que o cliente pedir.
  v_business_date constant date := public.quadro_business_date();
  -- Idem: o mesmo piso do rascunho, o mesmo número que a tela usa.
  v_window_days constant integer := public.quadro_reference_window_days();
  v_window_start constant date := v_business_date - v_window_days;
begin
  -- (1) usuário autenticado?
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;

  -- (2) a conferência existe?
  --
  -- Leitura SEM lock de propósito: sob RLS, `for update` aplica também a
  -- política de UPDATE, que exclui linhas SUBMITTED. Travar aqui faria uma
  -- conferência já enviada parecer inexistente, e o gerente veria
  -- "não encontrada" em vez de "já enviada".
  select * into v_conference
    from public.quadro_daily_conferences
   where id = p_conference_id;

  if not found then
    raise exception 'Conferência não encontrada: %.', p_conference_id using errcode = 'P0002';
  end if;

  -- (3) o usuário pode escrever nesta loja?
  if not public.quadro_can_write_store(v_conference.store_id) then
    raise exception 'Sem permissão para enviar conferência da loja %.', v_conference.store_id
      using errcode = '42501';
  end if;

  -- (3.1) FASE 4.5 — só o passado vira número oficial.
  --
  -- Esta checagem NÃO pode viver só no frontend: era exatamente esse o buraco
  -- auditado nesta fase. Vale para chamada por PostgREST, curl, DevTools ou SDK.
  if v_conference.reference_date >= v_business_date then
    raise exception 'Conferência de % não pode ser enviada: o dia ainda não terminou.',
      v_conference.reference_date using errcode = '22007';
  end if;

  -- (3.2) E o piso da janela. Um envio antigo não é sujeira: é número oficial
  -- retroativo, que entra na Visão da Rede como se tivesse sido conferido na
  -- época. A tela nunca ofereceu a data; a RPC agora também não aceita.
  if v_conference.reference_date < v_window_start then
    raise exception
      'Conferência de % está fora da janela de % dias: só de % em diante.',
      v_conference.reference_date, v_window_days, v_window_start using errcode = '22007';
  end if;

  -- (4) está em DRAFT ou REOPENED?
  if v_conference.status = 'SUBMITTED' then
    raise exception 'Conferência já enviada em %.', v_conference.submitted_at
      using errcode = '55006';
  end if;

  if v_conference.status not in ('DRAFT', 'REOPENED') then
    raise exception 'Status % não permite envio.', v_conference.status using errcode = '55006';
  end if;

  -- Agora que se sabe que a linha é editável, trava contra envio duplo
  -- concorrente e reconfere o status sob o lock.
  select * into v_conference
    from public.quadro_daily_conferences
   where id = p_conference_id
   for update;

  if not found or v_conference.status = 'SUBMITTED' then
    raise exception 'Conferência foi enviada por outra sessão durante este envio.'
      using errcode = '55006';
  end if;

  -- (5) os itens já estão persistidos?
  if not exists (select 1 from public.quadro_daily_items where conference_id = p_conference_id) then
    raise exception 'Conferência sem itens persistidos: salve o rascunho antes de enviar.'
      using errcode = '55006';
  end if;

  -- (6) negativos, falta sem motivo, soma dos motivos e observação obrigatória.
  --
  -- "Aguardando justificativa" entra nessa soma como qualquer outro motivo: é
  -- por isso que a conferência com pendência PODE ser enviada. A falta ocorreu
  -- e precisa entrar no número oficial; o que falta é o documento.
  perform public.quadro_assert_conference_is_consistent(p_conference_id);

  select coalesce(sum(absence_quantity), 0),
         coalesce(sum(day_off_quantity), 0),
         count(*) filter (where absence_quantity > 0 or day_off_quantity > 0)
    into v_absences, v_day_offs, v_impacted
    from public.quadro_daily_items
   where conference_id = p_conference_id;

  -- (7) só agora muda o status, com a autorização que os gatilhos exigem.
  perform set_config('quadro.status_change', 'on', true);

  update public.quadro_daily_conferences
     set status = 'SUBMITTED',
         submitted_at = now(),
         submitted_by = v_uid
   where id = p_conference_id
  returning * into v_conference;

  perform set_config('quadro.status_change', 'off', true);

  -- (8) auditoria do evento crítico, na mesma transação do envio.
  insert into public.quadro_audit_logs (user_id, action, entity, entity_id, store_id, metadata)
  values (
    v_uid, 'CONFERENCE_SUBMITTED', 'quadro_daily_conferences', p_conference_id::text,
    v_conference.store_id,
    jsonb_build_object(
      'reference_date', v_conference.reference_date,
      'total_absences', v_absences,
      'total_day_offs', v_day_offs,
      'impacted_positions', v_impacted,
      'submitted_at', v_conference.submitted_at
    )
  );

  return v_conference;
end;
$$;

-- ===========================================================================
-- 18.3 — AUTORIZAÇÃO ESTREITA, SÓ PARA RESOLVER MOTIVO
-- ===========================================================================
--
-- SEPARAÇÃO DE PRIVILÉGIOS, e não é formalidade.
--
-- `quadro.status_change` autoriza MUDAR O STATUS de uma conferência — abrir,
-- enviar, reabrir. Se a resolução de motivo reaproveitasse essa chave, todo
-- ajuste de justificativa passaria a rodar com permissão de mexer no status, e
-- um bug na RPC de resolução poderia reabrir ou desenviar uma conferência.
--
-- `quadro.reason_resolution` autoriza UMA coisa: alterar linhas de
-- `quadro_daily_item_reasons` de uma conferência enviada. Ela não é lida por
-- `quadro_guard_conference_transition`, então não move status nem carimbo de
-- envio. E o gatilho de motivos não lê `quadro.status_change`, então enviar uma
-- conferência não abre a porta dos motivos.
--
-- As duas são GUCs LOCAIS à transação (`set_config(..., true)`), e o PostgREST
-- não expõe SET nem set_config ao cliente REST: nenhuma chave anon ou
-- authenticated consegue ligá-las por fora de uma RPC.
create or replace function public.quadro_reason_resolution_is_authorized()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('quadro.reason_resolution', true), 'off') = 'on';
$$;

revoke all on function public.quadro_reason_resolution_is_authorized() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.quadro_reason_resolution_is_authorized() to authenticated';
  end if;
end
$$;

-- ===========================================================================
-- 18.4 — O GATILHO DE MOTIVOS PASSA A CONHECER A AUTORIZAÇÃO ESTREITA
-- ===========================================================================
--
-- Comportamento padrão INALTERADO: motivo de conferência enviada é imutável.
-- A única diferença é que agora existe uma porta, ela é estreita, e só a RPC
-- de resolução tem a chave — pelo tempo de uma transação.
create or replace function public.quadro_block_submitted_conference_reason()
returns trigger
language plpgsql
as $$
declare
  v_item_id uuid;
  v_status public.quadro_conference_status;
begin
  if tg_op = 'DELETE' then
    v_item_id := old.daily_item_id;
  else
    v_item_id := new.daily_item_id;
  end if;

  select dc.status into v_status
    from public.quadro_daily_items di
    join public.quadro_daily_conferences dc on dc.id = di.conference_id
   where di.id = v_item_id;

  -- FASE 4.5: a resolução de justificativa pendente é a ÚNICA exceção, e ela
  -- se identifica pela autorização estreita da própria RPC. Note que o teste é
  -- por `quadro.reason_resolution` e NÃO por `quadro.status_change`: quem está
  -- autorizado a enviar não fica, de quebra, autorizado a mexer em motivo.
  if v_status = 'SUBMITTED' and not public.quadro_reason_resolution_is_authorized() then
    raise exception 'Conferência já enviada: motivos bloqueados para edição.'
      using errcode = '55006';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 18.5 — RLS DOS MOTIVOS: a mesma exceção, na camada de políticas
-- ===========================================================================
--
-- A RPC de resolução é SECURITY INVOKER, como as outras duas — ela NÃO é porta
-- dos fundos, e continua sujeita à RLS. Para que ela consiga escrever, a
-- política precisa admitir o mesmo caso estreito que o gatilho admite.
--
-- O que NÃO muda: `quadro_can_write_store` continua exigido em todos os
-- caminhos, ou seja, apenas o GERENTE ATIVO DA PRÓPRIA LOJA, com
-- access_scope = STORE. Supervisor e admin não escrevem aqui, com ou sem
-- autorização de sessão.
drop policy if exists quadro_daily_item_reasons_insert on public.quadro_daily_item_reasons;
create policy quadro_daily_item_reasons_insert on public.quadro_daily_item_reasons
  for insert to authenticated
  with check (
    exists (
      select 1
        from public.quadro_daily_items di
        join public.quadro_daily_conferences dc on dc.id = di.conference_id
       where di.id = quadro_daily_item_reasons.daily_item_id
         and public.quadro_can_write_store(dc.store_id)
         and (
           dc.status in ('DRAFT', 'REOPENED')
           or (dc.status = 'SUBMITTED' and public.quadro_reason_resolution_is_authorized())
         )
    )
  );

drop policy if exists quadro_daily_item_reasons_update on public.quadro_daily_item_reasons;
create policy quadro_daily_item_reasons_update on public.quadro_daily_item_reasons
  for update to authenticated
  using (
    exists (
      select 1
        from public.quadro_daily_items di
        join public.quadro_daily_conferences dc on dc.id = di.conference_id
       where di.id = quadro_daily_item_reasons.daily_item_id
         and public.quadro_can_write_store(dc.store_id)
         and (
           dc.status in ('DRAFT', 'REOPENED')
           or (dc.status = 'SUBMITTED' and public.quadro_reason_resolution_is_authorized())
         )
    )
  )
  with check (
    exists (
      select 1
        from public.quadro_daily_items di
        join public.quadro_daily_conferences dc on dc.id = di.conference_id
       where di.id = quadro_daily_item_reasons.daily_item_id
         and public.quadro_can_write_store(dc.store_id)
    )
  );

drop policy if exists quadro_daily_item_reasons_delete on public.quadro_daily_item_reasons;
create policy quadro_daily_item_reasons_delete on public.quadro_daily_item_reasons
  for delete to authenticated
  using (
    exists (
      select 1
        from public.quadro_daily_items di
        join public.quadro_daily_conferences dc on dc.id = di.conference_id
       where di.id = quadro_daily_item_reasons.daily_item_id
         and public.quadro_can_write_store(dc.store_id)
         and (
           dc.status in ('DRAFT', 'REOPENED')
           or (dc.status = 'SUBMITTED' and public.quadro_reason_resolution_is_authorized())
         )
    )
  );

-- ===========================================================================
-- 18.6 — AUDITORIA DEDICADA DA RESOLUÇÃO
-- ===========================================================================
--
-- POR QUE UMA TABELA NOVA, e não só `quadro_audit_logs`.
--
-- `quadro_audit_logs` é um diário genérico: entity + entity_id + metadata jsonb.
-- Ele guardaria os dados, mas guardaria `from_reason_id` e `to_reason_id` como
-- texto solto dentro de um JSON — sem chave estrangeira, sem integridade. Numa
-- trilha que existe para explicar por que um número mudou, um motivo escrito
-- errado é pior que nenhum registro: parece certo.
--
-- Aqui cada campo é coluna, com FK. E o `quadro_audit_logs` continua recebendo
-- o evento também, na mesma transação, para a linha do tempo da loja não ficar
-- com um buraco entre "enviada" e "número mudou".
create table if not exists public.quadro_absence_reason_resolutions (
  id                  uuid primary key default gen_random_uuid(),
  --
  -- SEM CHAVE ESTRANGEIRA PARA A CONFERÊNCIA, de propósito — a mesma decisão
  -- que a 0005 tomou para `quadro_audit_logs.entity_id`.
  --
  -- Uma trilha que desaparece junto com o objeto auditado não é trilha. Com
  -- `on delete cascade`, apagar uma conferência apagaria a prova de que alguém
  -- mudou um motivo dela; com `on delete restrict`, o gatilho append-only e a
  -- FK brigariam entre si e a conferência viraria indelével por acidente. O id
  -- fica como identificação, e a integridade que importa está nas dimensões
  -- abaixo, que nunca são apagadas.
  conference_id       uuid not null,
  conference_item_id  uuid not null,
  store_id            text not null references public.quadro_stores (id) on delete restrict,
  reference_date      date not null,
  position_id         text not null references public.quadro_positions (id) on delete restrict,
  quantity            integer not null check (quantity > 0),
  from_reason_id      text not null references public.quadro_absence_reasons (id) on delete restrict,
  to_reason_id        text not null references public.quadro_absence_reasons (id) on delete restrict,
  -- Sempre auth.uid(), gravado dentro da RPC. Nunca identidade vinda do cliente.
  changed_by          uuid not null references public.quadro_profiles (id) on delete restrict,
  changed_at          timestamptz not null default now(),
  observation         text,
  -- Trocar um motivo por ele mesmo não é resolução, é ruído na trilha.
  constraint quadro_reason_resolutions_distinct_ck check (from_reason_id <> to_reason_id)
);

create index if not exists quadro_reason_resolutions_conference_idx
  on public.quadro_absence_reason_resolutions (conference_id);
create index if not exists quadro_reason_resolutions_item_idx
  on public.quadro_absence_reason_resolutions (conference_item_id);
create index if not exists quadro_reason_resolutions_store_date_idx
  on public.quadro_absence_reason_resolutions (store_id, reference_date desc);

-- Append-only por GATILHO, não só por RLS: gatilho vale também para papéis que
-- ignoram RLS (service_role, superusuário). É a mesma decisão da 0005.
create or replace function public.quadro_reason_resolutions_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'quadro_absence_reason_resolutions é append-only: % não é permitido.', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists quadro_reason_resolutions_no_update
  on public.quadro_absence_reason_resolutions;
create trigger quadro_reason_resolutions_no_update
  before update or delete on public.quadro_absence_reason_resolutions
  for each row execute function public.quadro_reason_resolutions_append_only();

alter table public.quadro_absence_reason_resolutions enable row level security;

-- LEITURA: quem enxerga a loja enxerga a trilha dela. O supervisor precisa ver
-- o que foi resolvido dentro do escopo dele — ele só não resolve.
drop policy if exists quadro_reason_resolutions_select on public.quadro_absence_reason_resolutions;
create policy quadro_reason_resolutions_select on public.quadro_absence_reason_resolutions
  for select to authenticated
  using (public.quadro_can_access_store(store_id));

-- ESCRITA: SÓ DE DENTRO DA RPC.
--
-- APPEND-ONLY TEM DOIS LADOS, e eu só tinha fechado um. O gatilho acima impede
-- que alguém ALTERE a trilha; faltava impedir que alguém a FABRIQUE. Com apenas
-- `changed_by = auth.uid() and quadro_can_write_store(store_id)`, o gerente
-- legítimo da própria loja fazia INSERT direto por PostgREST e inventava uma
-- resolução que nunca aconteceu: a linha de auditoria existia, com o nome dele,
-- a data que ele quisesse e o motivo que ele quisesse — e NENHUMA falta tinha
-- mudado de motivo de verdade. Uma trilha que aceita registro inventado é pior
-- que nenhuma, porque parece prova.
--
-- `quadro_reason_resolution_is_authorized()` fecha isso: a GUC
-- `quadro.reason_resolution` é ligada DENTRO da RPC, com `set_config(..., true)`
-- — local à transação — e o PostgREST não expõe SET nem set_config a cliente
-- REST. Então:
--
--   pela RPC oficial ...... GUC ligada  -> INSERT passa
--   INSERT direto ......... GUC apagada -> INSERT recusado
--
-- As três condições continuam valendo juntas, e cada uma responde a uma coisa
-- diferente: a GUC diz DE ONDE veio, `changed_by` diz EM NOME DE QUEM, e
-- `quadro_can_write_store` diz SOBRE QUAL LOJA. Nenhuma substitui a outra.
--
-- E continua sendo `quadro.reason_resolution`, nunca `quadro.status_change`: a
-- separação de privilégios da 18.4 vale nos dois sentidos, e uma porta que abre
-- a outra não é separação nenhuma.
drop policy if exists quadro_reason_resolutions_insert on public.quadro_absence_reason_resolutions;
create policy quadro_reason_resolutions_insert on public.quadro_absence_reason_resolutions
  for insert to authenticated
  with check (
    public.quadro_reason_resolution_is_authorized()
    and changed_by = auth.uid()
    and public.quadro_can_write_store(store_id)
  );

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select, insert on public.quadro_absence_reason_resolutions to authenticated';
  end if;
end
$$;

-- ===========================================================================
-- 18.7 — A RPC DE RESOLUÇÃO
-- ===========================================================================
--
-- O QUE ELA É: mover quantidade de "Aguardando justificativa" para um motivo
-- definitivo, dentro de uma função de uma conferência JÁ ENVIADA.
--
-- O QUE ELA NÃO É: uma reabertura. O status continua SUBMITTED, o total de
-- faltas continua idêntico, e nenhum outro campo se move. A conferência nunca
-- volta a ser editável.
--
--   antes:  faltas = 2 | Atestado = 1 | Aguardando = 1
--   depois: faltas = 2 | Atestado = 2 | Aguardando = 0
--   nunca:  faltas = 3
--
-- SECURITY INVOKER (padrão), como as outras duas RPCs do projeto: ela roda com
-- os privilégios de quem chama e continua sujeita à RLS. A autorização estreita
-- da 18.3 abre exatamente uma porta, e só depois que todas as permissões já
-- foram conferidas.
create or replace function public.quadro_rpc_resolve_pending_absence_reason(
  p_conference_item_id uuid,
  p_to_reason_id       text,
  p_quantity           integer,
  p_observation        text default null
)
returns uuid
language plpgsql
as $$
declare
  v_pending_id constant text := 'reason-aguardando-justificativa';
  v_uid        uuid := auth.uid();
  v_item       public.quadro_daily_items;
  v_conference public.quadro_daily_conferences;
  v_to_reason  public.quadro_absence_reasons;
  v_pending    public.quadro_daily_item_reasons;
  v_observation text := nullif(btrim(coalesce(p_observation, '')), '');
  v_resolution_id uuid;
  v_reason_total  integer;
begin
  -- (1) autenticado?
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;

  -- (2) quantidade faz sentido?
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantidade a resolver precisa ser maior que zero.' using errcode = '22023';
  end if;

  -- (3) o item existe e é visível para quem chama?
  --
  -- Sob RLS, um gerente de OUTRA loja não enxerga a linha e cai aqui como
  -- "não encontrado" — de propósito: a mensagem não confirma a existência de
  -- dados de uma loja alheia.
  select di.* into v_item
    from public.quadro_daily_items di
   where di.id = p_conference_item_id;

  if not found then
    raise exception 'Lançamento não encontrado: %.', p_conference_item_id using errcode = 'P0002';
  end if;

  select dc.* into v_conference
    from public.quadro_daily_conferences dc
   where dc.id = v_item.conference_id;

  if not found then
    raise exception 'Conferência do lançamento % não encontrada.', p_conference_item_id
      using errcode = 'P0002';
  end if;

  -- (4) SÓ O GERENTE ATIVO DA PRÓPRIA LOJA.
  --
  -- `quadro_can_write_store` já cobra, numa função só: perfil ativo, papel
  -- MANAGER, access_scope STORE e loja igual à da conferência. Supervisor e
  -- admin caem aqui — por decisão de produto, eles veem e não resolvem.
  if not public.quadro_can_write_store(v_conference.store_id) then
    raise exception 'Sem permissão para resolver justificativa da loja %.',
      v_conference.store_id using errcode = '42501';
  end if;

  -- (5) esta operação é só para conferência ENVIADA.
  --
  -- Em rascunho não há o que "resolver": o gerente simplesmente troca o motivo
  -- na tela e salva, pelo caminho normal.
  if v_conference.status <> 'SUBMITTED' then
    raise exception 'A resolução de justificativa só existe para conferência enviada (status atual: %).',
      v_conference.status using errcode = '55006';
  end if;

  -- (6) o motivo de destino é válido?
  select ar.* into v_to_reason
    from public.quadro_absence_reasons ar
   where ar.id = p_to_reason_id;

  if not found then
    raise exception 'Motivo de destino inexistente: %.', p_to_reason_id using errcode = '22023';
  end if;

  if not v_to_reason.active then
    raise exception 'Motivo de destino inativo: %.', v_to_reason.name using errcode = '22023';
  end if;

  -- (7) resolver "aguardando" para "aguardando" não resolve nada.
  if p_to_reason_id = v_pending_id then
    raise exception 'O motivo de destino não pode ser "Aguardando justificativa".'
      using errcode = '22023';
  end if;

  -- (8) destino que exige observação continua exigindo (caso de "Outros").
  if v_to_reason.requires_observation and v_observation is null then
    raise exception 'O motivo "%" exige observação.', v_to_reason.name using errcode = '23514';
  end if;

  -- (9) A PORTA ESTREITA ABRE AQUI — depois de todas as permissões conferidas,
  -- e nunca antes. O `true` faz o set_config ser LOCAL à transação: acabou a
  -- transação, acabou a autorização, com commit ou com rollback.
  --
  -- Precisa vir antes do `for update` porque, sob RLS, travar uma linha aplica
  -- a política de UPDATE — e sem a autorização a linha de uma conferência
  -- enviada simplesmente não apareceria.
  perform set_config('quadro.reason_resolution', 'on', true);

  -- (10) trava a linha de "Aguardando" e revalida o saldo SOB O LOCK.
  --
  -- É este bloqueio que impede duas resoluções simultâneas de consumirem a
  -- mesma unidade: a segunda espera aqui e, quando entra, lê o saldo já
  -- decrementado.
  select dir.* into v_pending
    from public.quadro_daily_item_reasons dir
   where dir.daily_item_id = p_conference_item_id
     and dir.reason_id = v_pending_id
   for update;

  if not found or v_pending.quantity <= 0 then
    raise exception 'Não há falta aguardando justificativa neste lançamento.'
      using errcode = '55006';
  end if;

  if v_pending.quantity < p_quantity then
    raise exception 'Só há % falta(s) aguardando justificativa; foi pedido resolver %.',
      v_pending.quantity, p_quantity using errcode = '55006';
  end if;

  -- (11) consome a quantidade pendente. Zerou, a linha sai — é a mesma forma
  -- que o rascunho grava (só motivos com quantidade > 0).
  if v_pending.quantity = p_quantity then
    delete from public.quadro_daily_item_reasons where id = v_pending.id;
  else
    update public.quadro_daily_item_reasons
       set quantity = quantity - p_quantity
     where id = v_pending.id;
  end if;

  -- (12) credita no motivo definitivo, somando se ele já existir na função.
  insert into public.quadro_daily_item_reasons (daily_item_id, reason_id, quantity, observation)
  values (p_conference_item_id, p_to_reason_id, p_quantity, v_observation)
  on conflict (daily_item_id, reason_id) do update
    set quantity = public.quadro_daily_item_reasons.quantity + excluded.quantity,
        observation = coalesce(excluded.observation, public.quadro_daily_item_reasons.observation);

  -- (13) A INVARIANTE, conferida no próprio banco.
  --
  -- Segunda camada de propósito: a aritmética acima já preserva a soma, mas uma
  -- conferência cujo total de motivos deixe de bater com as faltas é um número
  -- oficial errado. Se algum dia isto disparar, é bug — e o rollback devolve
  -- tudo em vez de gravar o erro.
  select coalesce(sum(dir.quantity), 0) into v_reason_total
    from public.quadro_daily_item_reasons dir
   where dir.daily_item_id = p_conference_item_id;

  if v_reason_total <> v_item.absence_quantity then
    raise exception 'Resolução recusada: motivos somariam % para % falta(s).',
      v_reason_total, v_item.absence_quantity using errcode = '23514';
  end if;

  -- (14) AUDITORIA NA MESMA TRANSAÇÃO.
  --
  -- Se qualquer um dos dois inserts falhar, a resolução inteira volta atrás:
  -- número que muda sem trilha é número que ninguém consegue explicar depois.
  insert into public.quadro_absence_reason_resolutions (
    conference_id, conference_item_id, store_id, reference_date, position_id,
    quantity, from_reason_id, to_reason_id, changed_by, observation
  )
  values (
    v_conference.id, v_item.id, v_conference.store_id, v_conference.reference_date,
    v_item.position_id, p_quantity, v_pending_id, p_to_reason_id, v_uid, v_observation
  )
  returning id into v_resolution_id;

  insert into public.quadro_audit_logs (user_id, action, entity, entity_id, store_id, metadata)
  values (
    v_uid, 'ABSENCE_REASON_RESOLVED', 'quadro_daily_items', v_item.id::text,
    v_conference.store_id,
    jsonb_build_object(
      'conference_id', v_conference.id,
      'reference_date', v_conference.reference_date,
      'position_id', v_item.position_id,
      'quantity', p_quantity,
      'from_reason_id', v_pending_id,
      'to_reason_id', p_to_reason_id,
      'resolution_id', v_resolution_id
    )
  );

  -- (15) fecha a porta antes de devolver. O `local` já garantiria isso no fim
  -- da transação; fechar explicitamente deixa o resto da transação do chamador
  -- sem uma autorização pendurada.
  perform set_config('quadro.reason_resolution', 'off', true);

  return v_resolution_id;
end;
$$;

revoke all on function public.quadro_rpc_resolve_pending_absence_reason(uuid, text, integer, text)
  from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.quadro_rpc_resolve_pending_absence_reason(uuid, text, integer, text) to authenticated';
  end if;
end
$$;

-- ===========================================================================
-- 18.8 — Verificação da própria migration
-- ===========================================================================
--
-- Uma migration que "roda sem erro" mas não instala o que prometeu é pior que
-- uma que falha: o defeito só aparece em produção. Este bloco cobra o que a
-- 0018 tinha de deixar pronto.
do $$
declare
  v_faltando text[] := array[]::text[];
  v_rpc      text;
  v_codigo   text;
begin
  if not exists (
    select 1 from public.quadro_absence_reasons
     where id = 'reason-aguardando-justificativa' and active
  ) then
    v_faltando := v_faltando || 'motivo reason-aguardando-justificativa'::text;
  end if;

  if to_regprocedure('public.quadro_reason_resolution_is_authorized()') is null then
    v_faltando := v_faltando || 'funcao quadro_reason_resolution_is_authorized'::text;
  end if;

  if to_regprocedure(
       'public.quadro_rpc_resolve_pending_absence_reason(uuid, text, integer, text)'
     ) is null then
    v_faltando := v_faltando || 'rpc quadro_rpc_resolve_pending_absence_reason'::text;
  end if;

  if to_regclass('public.quadro_absence_reason_resolutions') is null then
    v_faltando := v_faltando || 'tabela quadro_absence_reason_resolutions'::text;
  end if;

  -- A TRILHA NAO PODE SER FABRICADA. O gatilho impede ALTERAR o historico; a
  -- policy de INSERT e o que impede INVENTA-LO. Sem a autorizacao no `with
  -- check`, o gerente legitimo grava direto por PostgREST uma resolucao que
  -- nunca aconteceu.
  --
  -- Le a EXPRESSAO da policy no catalogo (`pg_policies.with_check`), nao o texto
  -- da migration: o que vale e o que o banco vai avaliar.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'quadro_absence_reason_resolutions'
       and policyname = 'quadro_reason_resolutions_insert'
       and cmd = 'INSERT'
       and with_check like '%quadro_reason_resolution_is_authorized%'
  ) then
    v_faltando := v_faltando ||
      'policy de INSERT da trilha nao exige quadro_reason_resolution_is_authorized'::text;
  end if;

  -- E a autorizacao tem de ser A DA RESOLUCAO. Se a policy passasse a aceitar
  -- `quadro.status_change`, a separacao de privilegios da 18.4 cairia: quem
  -- pode mexer em status passaria a poder forjar auditoria.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'quadro_absence_reason_resolutions'
       and policyname = 'quadro_reason_resolutions_insert'
       and with_check like '%status_change%'
  ) then
    v_faltando := v_faltando || 'policy de INSERT da trilha aceita status_change'::text;
  end if;

  if to_regprocedure('public.quadro_business_date()') is null then
    v_faltando := v_faltando || 'funcao quadro_business_date'::text;
  end if;

  if to_regprocedure('public.quadro_reference_window_days()') is null then
    v_faltando := v_faltando || 'funcao quadro_reference_window_days'::text;
  end if;

  -- A ZONA PRECISA EXISTIR. Sem ela, `at time zone` levanta erro em tempo de
  -- execucao — ou seja, a primeira gravacao do gerente falharia em producao.
  if not exists (select 1 from pg_timezone_names where name = 'America/Bahia') then
    v_faltando := v_faltando || 'timezone America/Bahia no PostgreSQL'::text;
  end if;

  -- As duas RPCs precisam usar a DATA OPERACIONAL, e nao `current_date`: este
  -- ultimo segue o TimeZone da sessao, que o cliente escolhe pelo cabecalho
  -- `Prefer: timezone`. Cobrar as duas coisas — a presenca da funcao e a
  -- ausencia de current_date — impede tanto esquecer a correcao quanto
  -- reintroduzi-la depois.
  --
  -- O CODIGO, NAO A PROSA. `prosrc` traz os comentarios junto, e este bloco de
  -- verificacao ja se acusou uma vez por causa de um comentario que EXPLICAVA
  -- por que nao usar current_date. Tirar os comentarios antes de procurar faz o
  -- teste medir o que a funcao FAZ, e nao o que ela diz.
  for v_rpc in
    select unnest(array['quadro_rpc_save_daily_conference_draft',
                        'quadro_rpc_submit_daily_conference'])
  loop
    -- string_agg, e nao `select into`, DE PROPOSITO: se sobrar uma sobrecarga
    -- antiga da RPC, ela entra na verificacao junto. Com `into`, a versao errada
    -- poderia ficar escondida atras da certa.
    select string_agg(
             regexp_replace(
               regexp_replace(prosrc, '/\*.*?\*/', '', 'gs'),  -- comentario de bloco
               '--[^' || chr(10) || ']*', '', 'g'                -- comentario de linha
             ), chr(10))
      into v_codigo
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_rpc;

    if v_codigo is null or v_codigo not like '%quadro_business_date%' then
      v_faltando := v_faltando || ('data operacional ausente em ' || v_rpc);
    end if;

    if v_codigo like '%current_date%' then
      v_faltando := v_faltando || ('current_date ainda presente em ' || v_rpc);
    end if;

    -- O PISO DA JANELA. Duas exigencias, e as duas importam: a funcao da janela
    -- tem de ser consultada (senao o numero estaria solto no corpo, livre para
    -- divergir do frontend) E o piso tem de ser efetivamente COMPARADO (chamar a
    -- funcao sem comparar com nada nao protege coisa nenhuma).
    if v_codigo not like '%quadro_reference_window_days%' then
      v_faltando := v_faltando || ('janela de dias ausente em ' || v_rpc);
    end if;

    if v_codigo not like '%< v_window_start%' then
      v_faltando := v_faltando || ('piso da janela nao comparado em ' || v_rpc);
    end if;
  end loop;

  -- ATE AQUI a verificacao LEU o codigo. Estas duas EXECUTAM: a janela tem de
  -- devolver um numero util e a conta do piso tem de fechar. Ler prova que a
  -- linha existe; executar prova que ela faz o que promete.
  if public.quadro_reference_window_days() is distinct from 7 then
    v_faltando := v_faltando || format(
      'janela deveria ser 7 dias, veio %s (e REFERENCE_WINDOW_DAYS no frontend?)',
      coalesce(public.quadro_reference_window_days()::text, 'nulo'));
  end if;

  if public.quadro_business_date() - public.quadro_reference_window_days()
     <> public.quadro_business_date() - 7 then
    v_faltando := v_faltando || 'conta do piso da janela nao fecha'::text;
  end if;

  if array_length(v_faltando, 1) is not null then
    raise exception 'Migration 0018 incompleta: %', array_to_string(v_faltando, ', ');
  end if;
end
$$;

