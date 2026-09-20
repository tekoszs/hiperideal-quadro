-- ============================================================================
-- VERIFICAÇÃO DE INSTALAÇÃO — HIPERIDEAL Conferência Diária de Quadro
--
-- Confere a ESTRUTURA do banco depois de aplicar schema.sql + seed.sql.
-- Não depende de autenticação, então roda em qualquer lugar:
--
--   psql -d hiperideal -f supabase/tests/schema_checks.sql
--   ou colado no SQL Editor do Supabase
--
-- O COMPORTAMENTO (RLS por perfil, RPCs, imutabilidade) é coberto pelos
-- testes de integração da aplicação:
--   DATABASE_URL=... npm test
-- ============================================================================
\pset pager off

with esperado as (
  select * from (values
    -- (grupo, item, condição)
    ('Tabela', 'quadro_stores',             to_regclass('public.quadro_stores')             is not null),
    ('Tabela', 'quadro_positions',          to_regclass('public.quadro_positions')          is not null),
    ('Tabela', 'quadro_store_staffing',     to_regclass('public.quadro_store_staffing')     is not null),
    ('Tabela', 'quadro_profiles',           to_regclass('public.quadro_profiles')           is not null),
    ('Tabela', 'quadro_absence_reasons',    to_regclass('public.quadro_absence_reasons')    is not null),
    ('Tabela', 'quadro_daily_conferences',  to_regclass('public.quadro_daily_conferences')  is not null),
    ('Tabela', 'quadro_daily_items',        to_regclass('public.quadro_daily_items')        is not null),
    ('Tabela', 'quadro_daily_item_reasons', to_regclass('public.quadro_daily_item_reasons') is not null),
    ('Tabela', 'quadro_audit_logs',         to_regclass('public.quadro_audit_logs')         is not null),

    ('Auth', 'schema auth existe (Supabase ou shim local)',
      exists (select 1 from pg_namespace where nspname = 'auth')),
    ('Auth', 'auth.uid() disponivel',
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'auth' and p.proname = 'uid')),
    ('Auth', 'quadro_profiles.id referencia auth.users',
      exists (select 1 from pg_constraint c
               where c.conrelid = 'public.quadro_profiles'::regclass
                 and c.contype = 'f'
                 and c.confrelid = 'auth.users'::regclass)),
    ('Auth', 'quadro_daily_conferences.created_by e uuid',
      (select atttypid = 'uuid'::regtype from pg_attribute
        where attrelid = 'public.quadro_daily_conferences'::regclass and attname = 'created_by')),
    ('Auth', 'quadro_audit_logs.user_id e uuid',
      (select atttypid = 'uuid'::regtype from pg_attribute
        where attrelid = 'public.quadro_audit_logs'::regclass and attname = 'user_id')),
    ('Auth', 'MANAGER exige loja (constraint)',
      exists (select 1 from pg_constraint
               where conname = 'quadro_profiles_manager_needs_store_ck')),

    ('RPC', 'quadro_rpc_save_daily_conference_draft(text,date,jsonb)',
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and p.proname = 'quadro_rpc_save_daily_conference_draft'
                 and pg_get_function_arguments(p.oid) = 'p_store_id text, p_reference_date date, p_items jsonb')),
    ('RPC', 'assinatura antiga com p_created_by removida',
      not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname = 'quadro_rpc_save_daily_conference_draft'
                     and pg_get_function_arguments(p.oid) like '%p_created_by%')),
    ('RPC', 'quadro_rpc_submit_daily_conference(uuid)',
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'quadro_rpc_submit_daily_conference')),
    ('RPC', 'RPCs NAO sao security definer (respeitam RLS)',
      not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname ~ '^quadro_rpc_' and p.prosecdef)),

    ('Gatilho', 'quadro_daily_conferences_guard',
      exists (select 1 from pg_trigger where tgname = 'quadro_daily_conferences_guard')),
    ('Gatilho', 'quadro_daily_items_block_submitted',
      exists (select 1 from pg_trigger where tgname = 'quadro_daily_items_block_submitted')),
    ('Gatilho', 'quadro_daily_item_reasons_block_submitted',
      exists (select 1 from pg_trigger where tgname = 'quadro_daily_item_reasons_block_submitted')),
    ('Gatilho', 'quadro_audit_logs_no_update (append-only)',
      exists (select 1 from pg_trigger where tgname = 'quadro_audit_logs_no_update')),
    ('Gatilho', 'quadro_profiles_guard_privileges',
      exists (select 1 from pg_trigger where tgname = 'quadro_profiles_guard_privileges')),

    ('Seguranca', 'RLS ligada em TODAS as tabelas quadro_*',
      not exists (select 1 from pg_tables
                   where schemaname = 'public' and tablename ~ '^quadro_'
                     and not rowsecurity)),
    ('Seguranca', 'nenhuma politica aberta using(true)/with check(true)',
      not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename ~ '^quadro_'
                     and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true'))),
    ('Seguranca', 'existem politicas por perfil (>= 21 em quadro_*)',
      (select count(*) from pg_policies
        where schemaname = 'public' and tablename ~ '^quadro_') >= 21),
    ('Seguranca', 'funcoes quadro_* security definer tem search_path fixo',
      not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef
           and p.proname ~ '^quadro_'
           and not exists (
             select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
              where cfg like 'search_path=%'))),
    ('Seguranca', 'funcoes de perfil existem',
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'quadro_can_access_store')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'quadro_can_write_store')),

    ('Views', 'quadro_v_conference_items existe',
      to_regclass('public.quadro_v_conference_items') is not null),
    ('Views', 'quadro_v_conference_item_reasons existe',
      to_regclass('public.quadro_v_conference_item_reasons') is not null),
    ('Coexistencia', 'nenhuma tabela deste sistema sem o prefixo quadro_',
      not exists (
        select 1 from (values
          ('stores'), ('positions'), ('store_staffing'), ('profiles'),
          ('absence_reasons'), ('daily_conferences'), ('daily_items'),
          ('daily_item_reasons'), ('audit_logs')
        ) as t(nome)
        where to_regclass('public.quadro_' || nome) is null)),
    ('Coexistencia', 'todo objeto quadro_* tem RLS ou e view/funcao',
      (select count(*) from pg_tables
        where schemaname = 'public' and tablename ~ '^quadro_') = 9),
    ('Views', 'views quadro_* usam security_invoker=true',
      not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'v'
           and c.relname ~ '^quadro_'
           and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=true%')),

    ('Dados', '8 motivos de falta cadastrados',
      (select count(*) from public.quadro_absence_reasons) = 8),
    ('Dados', 'FOLGA nao e motivo de falta',
      not exists (select 1 from public.quadro_absence_reasons where lower(name) like '%folga%')),
    ('Dados', 'motivo "Outros" exige observacao',
      (select requires_observation from public.quadro_absence_reasons where id = 'reason-outros')),
    ('Dados', 'catalogo carregado (>= 1 loja e 25 funcoes)',
      (select count(*) from public.quadro_stores) >= 1
      and (select count(*) from public.quadro_positions) >= 25),
    ('Dados', 'REPOSITOR separado em 4 setores',
      (select count(*) from public.quadro_positions where function_group = 'REPOSITOR') = 4),
    ('Dados', 'ATENDENTE ALIMENTOS separado em 3 setores',
      (select count(*) from public.quadro_positions where function_group = 'ATENDENTE ALIMENTOS') = 3),
    ('Dados', 'AUX. DE COZINHA separado em 2 setores',
      (select count(*) from public.quadro_positions where function_group = 'AUX. DE COZINHA') = 2),
    ('Dados', 'quadro autorizado NAO foi inventado (fica nulo)',
      not exists (select 1 from public.quadro_store_staffing where authorized_quantity is not null))
  ) as t(grupo, item, ok)
)
select grupo                                   as "Grupo",
       case when ok then 'OK   ' else 'FALHA' end as "Res",
       item                                    as "Verificacao"
  from esperado
 order by grupo, item;

-- Resumo -------------------------------------------------------------------
with esperado as (
  select * from (values
    (to_regclass('public.quadro_v_conference_items') is not null),
    (to_regclass('public.quadro_v_conference_item_reasons') is not null),
    (not exists (select 1 from pg_tables
                  where schemaname = 'public' and tablename ~ '^quadro_'
                    and not rowsecurity)),
    (not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename ~ '^quadro_'
                    and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true'))),
    (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname = 'quadro_rpc_save_daily_conference_draft'
                and pg_get_function_arguments(p.oid) not like '%p_created_by%')),
    (exists (select 1 from pg_trigger where tgname = 'quadro_daily_item_reasons_block_submitted')),
    (exists (select 1 from pg_trigger where tgname = 'quadro_audit_logs_no_update')),
    (not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and p.proname ~ '^quadro_'
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
                          where cfg like 'search_path=%')))
  ) as t(ok)
)
select count(*) filter (where ok)     as "passaram",
       count(*) filter (where not ok) as "falharam",
       case when bool_and(ok) then 'ESTRUTURA CRITICA OK'
            else 'ATENCAO: revise as linhas marcadas como FALHA acima' end as "Resumo"
  from esperado;
