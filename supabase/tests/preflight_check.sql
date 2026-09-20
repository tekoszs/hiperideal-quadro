-- ============================================================================
-- ETAPA 0 — VERIFICAÇÃO PRÉVIA (rode ANTES do install.sql)
--
-- Procura QUALQUER objeto `quadro_*` que já exista no schema public:
-- tabelas, views, materialized views, índices, sequences, funções,
-- procedures, tipos/enums, domínios — e também policies/triggers `quadro_*`
-- que estejam presos a tabelas que NÃO são deste sistema.
--
-- RESULTADO ESPERADO NUM BANCO ONDE ESTE SISTEMA AINDA NÃO FOI INSTALADO:
--   "NADA ENCONTRADO — pode instalar"
--
-- Se aparecer qualquer linha, PARE e mande o resultado. Pode significar que
-- o sistema já foi instalado, ou que outro sistema usa o mesmo prefixo.
-- ============================================================================

with achados as (

  -- Tabelas, views, materialized views, índices, sequences e afins
  select
    case c.relkind
      when 'r' then 'TABELA'
      when 'p' then 'TABELA PARTICIONADA'
      when 'v' then 'VIEW'
      when 'm' then 'MATERIALIZED VIEW'
      when 'i' then 'INDICE'
      when 'I' then 'INDICE PARTICIONADO'
      when 'S' then 'SEQUENCE'
      when 'f' then 'FOREIGN TABLE'
      when 'c' then 'TIPO COMPOSTO'
      else c.relkind::text
    end                                   as tipo_objeto,
    c.relname                             as nome,
    ''                                    as detalhe
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname ~ '^quadro_'

  union all

  -- Funções e procedures
  select
    case p.prokind
      when 'f' then 'FUNCAO'
      when 'p' then 'PROCEDURE'
      when 'a' then 'FUNCAO DE AGREGACAO'
      when 'w' then 'FUNCAO DE JANELA'
      else p.prokind::text
    end,
    p.proname,
    '(' || pg_get_function_arguments(p.oid) || ')'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname ~ '^quadro_'

  union all

  -- Tipos, enums e domínios
  select
    case t.typtype
      when 'e' then 'ENUM'
      when 'd' then 'DOMINIO'
      when 'c' then 'TIPO COMPOSTO'
      when 'r' then 'TIPO RANGE'
      else 'TIPO'
    end,
    t.typname,
    ''
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
    and t.typname ~ '^quadro_'
    -- ignora o tipo-linha que toda tabela cria automaticamente
    and not exists (
      select 1 from pg_class c
       where c.oid = t.typrelid and c.relkind in ('r', 'v', 'm', 'p')
    )

  union all

  -- Policies com nome quadro_* — inclusive presas a tabelas de outro sistema
  select
    case when tablename ~ '^quadro_' then 'POLICY'
         else 'POLICY EM TABELA DE OUTRO SISTEMA' end,
    policyname,
    'na tabela ' || tablename
  from pg_policies
  where schemaname = 'public'
    and policyname ~ '^quadro_'

  union all

  -- Triggers com nome quadro_* — inclusive presos a tabelas de outro sistema
  select
    case when c.relname ~ '^quadro_' then 'TRIGGER'
         else 'TRIGGER EM TABELA DE OUTRO SISTEMA' end,
    tg.tgname,
    'na tabela ' || c.relname
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not tg.tgisinternal
    and tg.tgname ~ '^quadro_'

  union all

  -- Extensões instaladas dentro do schema public (contexto — não bloqueia)
  select 'EXTENSAO NO SCHEMA PUBLIC', e.extname, '(informativo)'
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where n.nspname = 'public'
    and e.extname ~ '^quadro_'
)

select tipo_objeto as "Tipo",
       nome        as "Nome",
       detalhe     as "Onde"
  from achados
 order by 1, 2;

-- Veredito
select case
         when count(*) = 0
           then 'NADA ENCONTRADO — pode instalar o install.sql'
         else 'ATENCAO: ' || count(*) || ' objeto(s) quadro_* JA existem. PARE e reporte.'
       end as "Resultado da Etapa 0"
  from (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname ~ '^quadro_'
    union all
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname ~ '^quadro_'
    union all
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname ~ '^quadro_'
       and not exists (select 1 from pg_class c
                        where c.oid = t.typrelid and c.relkind in ('r','v','m','p'))
    union all
    select 1 from pg_policies
     where schemaname = 'public' and policyname ~ '^quadro_'
    union all
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not tg.tgisinternal and tg.tgname ~ '^quadro_'
  ) t;
