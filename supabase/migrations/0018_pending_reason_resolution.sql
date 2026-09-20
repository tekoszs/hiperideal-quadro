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
