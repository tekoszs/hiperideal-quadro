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
