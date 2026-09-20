-- =============================================================================
-- 000 - AUDITORIA DE MOJIBAKE (somente leitura, nao altera nada)
-- =============================================================================
-- Procura texto corrompido em TODAS as colunas de texto de TODAS as tabelas
-- cujo nome comeca com quadro_. Nao le, nao altera e nao cita nenhuma tabela
-- do sistema Organico.
--
-- O que e "mojibake": texto gravado em UTF-8 que passou por alguma etapa que o
-- leu como Latin-1 / Windows-1252. "Atestado medico" (com e-agudo) vira
-- "Atestado mA-til-copyright-dico" na tela. O padrao e sempre o mesmo: um
-- A-til ou A-circunflexo seguido de um caractere na faixa U+0080..U+00BF.
--
-- Este arquivo e 100% ASCII de proposito - assim ele mesmo nao pode se
-- corromper no caminho ate o SQL Editor.
--
-- COMO USAR: Supabase > SQL Editor > New query > cole tudo > Run.
-- RESULTADO VAZIO = nenhum texto corrompido. E o que voce quer ver.
-- =============================================================================

select
  c.table_name  as tabela,
  c.column_name as coluna,
  achado.valor  as texto_corrompido
from information_schema.columns c
cross join lateral (
  select (xpath('/row/v/text()', linha))[1]::text as valor
  from unnest(
         xpath(
           '/table/row',
           -- tableforest = false: a raiz <table> sempre existe, mesmo com zero
           -- linhas. Com true, uma tabela limpa devolveria XML vazio e o xpath
           -- quebraria com "could not parse XML document".
           query_to_xml(
             format(
               'select %I as v from public.%I where %I ~ E''[\u00c2-\u00c3][\u0080-\u00bf]|\ufffd''',
               c.column_name, c.table_name, c.column_name
             ),
             false, false, ''
           )
         )
       ) as linha
) as achado
where c.table_schema = 'public'
  and c.table_name like 'quadro=_%' escape '='
  and c.data_type in ('text', 'character varying')
order by 1, 2, 3;
