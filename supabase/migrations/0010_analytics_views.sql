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
