-- 0019_month_calendar.sql
-- Calendario mensal para o gerente.
-- A migration 0018 permanece imutavel.
--
-- Regra:
-- SAVE   = primeiro dia do mes operacional ate HOJE
-- SUBMIT = primeiro dia do mes operacional ate ONTEM
--
-- Mes anterior fica fora da janela de escrita do gerente.

create or replace function public.quadro_reference_window_start()
returns date
language sql
stable
set search_path = ''
as $$
  select pg_catalog.date_trunc(
    'month',
    public.quadro_business_date()
  )::date;
$$;

comment on function public.quadro_reference_window_start() is
  'Primeiro dia do mes atual conforme a data operacional America/Bahia.';

revoke all on function public.quadro_reference_window_start() from public;

do $$
begin
  if exists (
    select 1
    from pg_roles
    where rolname = 'authenticated'
  ) then
    execute 'grant execute on function public.quadro_reference_window_start() to authenticated';
  end if;
end
$$;


-- Compatibilidade com as RPCs instaladas pela 0018.
--
-- As RPCs calculam:
--
-- v_window_start = v_business_date - v_window_days
--
-- Portanto, no modelo mensal:
--
-- v_window_days =
-- data operacional - primeiro dia do mes

create or replace function public.quadro_reference_window_days()
returns integer
language sql
stable
set search_path = ''
as $$
  select
    public.quadro_business_date()
    - public.quadro_reference_window_start();
$$;

comment on function public.quadro_reference_window_days() is
  'Compatibilidade das RPCs: quantidade de dias entre a data operacional e o primeiro dia do mes.';

revoke all on function public.quadro_reference_window_days() from public;

do $$
begin
  if exists (
    select 1
    from pg_roles
    where rolname = 'authenticated'
  ) then
    execute 'grant execute on function public.quadro_reference_window_days() to authenticated';
  end if;
end
$$;


-- ============================================================
-- SELF-CHECK
-- ============================================================

do $$
declare
  v_business_date date := public.quadro_business_date();
  v_start         date := public.quadro_reference_window_start();
  v_errors        text[] := array[]::text[];
  v_rpc           text;
  v_code          text;
begin

  -- Primeiro dia do mes precisa estar correto.
  if v_start is distinct from
     pg_catalog.date_trunc('month', v_business_date)::date
  then
    v_errors := array_append(
      v_errors,
      'inicio mensal incorreto'
    );
  end if;


  -- A funcao de compatibilidade precisa fechar exatamente a conta.
  if public.quadro_reference_window_days()
     is distinct from
     (v_business_date - v_start)
  then
    v_errors := array_append(
      v_errors,
      'deslocamento mensal incorreto'
    );
  end if;


  -- As DUAS RPCs reais da 0018 precisam continuar usando
  -- quadro_reference_window_days e comparando com v_window_start.
  for v_rpc in
    select unnest(array[
      'quadro_rpc_save_daily_conference_draft',
      'quadro_rpc_submit_daily_conference'
    ])
  loop

    select string_agg(
             regexp_replace(
               regexp_replace(
                 p.prosrc,
                 '/\*.*?\*/',
                 '',
                 'gs'
               ),
               '--[^' || chr(10) || ']*',
               '',
               'g'
             ),
             chr(10)
           )
      into v_code
      from pg_proc p
      join pg_namespace n
        on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = v_rpc;


    if v_code is null then
      v_errors := array_append(
        v_errors,
        v_rpc || ' nao encontrada'
      );

    else

      if v_code not like '%quadro_reference_window_days%' then
        v_errors := array_append(
          v_errors,
          v_rpc || ' sem referencia ao piso mensal'
        );
      end if;

      if v_code not like '%< v_window_start%' then
        v_errors := array_append(
          v_errors,
          v_rpc || ' sem bloqueio de data anterior ao mes atual'
        );
      end if;

      if v_code not like '%quadro_business_date%' then
        v_errors := array_append(
          v_errors,
          v_rpc || ' sem data operacional America/Bahia'
        );
      end if;

    end if;

  end loop;


  if array_length(v_errors, 1) is not null then
    raise exception
      'Migration 0019 incompleta: %',
      array_to_string(v_errors, ', ');
  end if;

end
$$;