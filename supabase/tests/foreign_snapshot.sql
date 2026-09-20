-- ============================================================================
-- FOTOGRAFIA DOS OBJETOS QUE NÃO SÃO DESTE SISTEMA
--
-- Lista tudo em `public` que NÃO começa com quadro_: tabelas (com estado de
-- RLS), views, funções, tipos, policies, triggers, índices, grants para
-- anon/authenticated e a contagem de linhas das tabelas do Organico.
--
-- Rode ANTES e DEPOIS do install.sql e compare com `diff`. Precisa dar igual.
--
--   psql -d BANCO -t -A -f supabase/tests/foreign_snapshot.sql > antes.txt
--   psql -d BANCO -f supabase/install.sql
--   psql -d BANCO -t -A -f supabase/tests/foreign_snapshot.sql > depois.txt
--   diff antes.txt depois.txt
--
-- Observação: a última linha ("DADOS ...") só funciona no banco de teste com
-- o Organico simulado. Num Supabase real, remova-a ou troque pelas tabelas
-- reais do outro sistema.
-- ============================================================================
select 'TABELA  ' || tablename || ' | rls=' || rowsecurity as objeto
  from pg_tables
 where schemaname = 'public' and tablename not like 'quadro\_%' escape '\'
union all
select 'VIEW    ' || viewname
  from pg_views
 where schemaname = 'public' and viewname not like 'quadro\_%' escape '\'
union all
select 'FUNCAO  ' || p.proname || '(' || pg_get_function_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname not like 'quadro\_%' escape '\'
union all
select 'TIPO    ' || t.typname
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
 where n.nspname = 'public' and t.typtype = 'e' and t.typname not like 'quadro\_%' escape '\'
union all
select 'POLICY  ' || tablename || '.' || policyname
  from pg_policies
 where schemaname = 'public' and tablename not like 'quadro\_%' escape '\'
union all
select 'TRIGGER ' || c.relname || '.' || t.tgname
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and not t.tgisinternal
   and c.relname not like 'quadro\_%' escape '\'
union all
select 'INDICE  ' || indexname
  from pg_indexes
 where schemaname = 'public' and tablename not like 'quadro\_%' escape '\'
union all
select 'GRANT   ' || table_name || '.' || privilege_type || ' -> ' || grantee
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated')
   and table_name not like 'quadro\_%' escape '\'
union all
select 'EXEC    ' || p.proname || ' -> anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'can_access_store'
union all
select 'DADOS   stores=' || (select count(*)::text from public.stores)
       || ' positions=' || (select count(*)::text from public.positions)
       || ' daily_items=' || (select count(*)::text from public.daily_items)
       || ' audit_logs=' || (select count(*)::text from public.audit_logs)
       || ' profiles=' || (select count(*)::text from public.profiles)
order by 1;
