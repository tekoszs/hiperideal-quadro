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
