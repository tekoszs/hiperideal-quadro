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
