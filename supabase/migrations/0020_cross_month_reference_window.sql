-- 0020_cross_month_reference_window.sql
-- Mantem a janela operacional de 7 dias atravessando a virada do mes.
-- Ex.: em 01/10, 30/09 continua disponivel para regularizacao.

create or replace function public.quadro_reference_window_start()
returns date
language sql
stable
set search_path = ''
as $$
  select public.quadro_business_date() - 7;
$$;

comment on function public.quadro_reference_window_start() is
  'Inicio da janela operacional de 7 dias, inclusive quando atravessa a virada do mes.';

create or replace function public.quadro_reference_window_days()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 7;
$$;

comment on function public.quadro_reference_window_days() is
  'Janela operacional de 7 dias. Rascunho: [D-7,D]. Envio: [D-7,D-1].';

revoke all on function public.quadro_reference_window_start() from public;
revoke all on function public.quadro_reference_window_days() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.quadro_reference_window_start() to authenticated;
    grant execute on function public.quadro_reference_window_days() to authenticated;
  end if;
end
$$;
