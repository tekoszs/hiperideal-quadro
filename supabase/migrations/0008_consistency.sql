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
