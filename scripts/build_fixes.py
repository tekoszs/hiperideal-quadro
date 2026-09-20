"""Gera os SQL de correcao 100% ASCII (acentos como escapes Unicode)."""
import os

os.chdir('/home/claude/hiperideal-quadro')
os.makedirs('supabase/fixes', exist_ok=True)


def esc(s):
    """Todo caractere nao-ASCII vira \\uXXXX."""
    return ''.join(ch if ord(ch) < 128 else '\\u%04x' % ord(ch) for ch in s)


def lit(s):
    """Literal SQL: E'...' quando ha escape, '...' quando ja e ASCII puro."""
    escaped = esc(s).replace("'", "''")
    plain = s.replace("'", "''")
    return "E'%s'" % escaped if escaped != plain else "'%s'" % plain


REASONS = [
    ('reason-atestado-medico',           'Atestado médico'),
    ('reason-falta-injustificada',       'Falta injustificada'),
    ('reason-ausencia-justificada',      'Ausência justificada'),
    ('reason-declaracao-comparecimento', 'Declaração / comparecimento'),
    ('reason-afastamento',               'Afastamento'),
    ('reason-licenca',                   'Licença'),
    ('reason-suspensao',                 'Suspensão'),
    ('reason-outros',                    'Outros'),
]

POSITIONS = [
    ('pos-aux-de-cozinha-refeitorio',
     'AUX. DE COZINHA - REFEITÓRIO',
     'REFEITÓRIO'),
]

# Detector de mojibake.
# Mojibake de UTF-8 lido como Latin-1 SEMPRE tem U+00C2 ou U+00C3 seguido de um
# byte de continuacao reinterpretado (U+0080..U+00BF). Portugues legitimo nao
# cai nisso: em "SAO" com A-til, a letra seguinte e 'O' (U+004F), fora da faixa.
# U+FFFD e o losango de interrogacao que aparece quando o byte foi perdido.
MOJIBAKE = '[Â-Ã][-¿]|�'
MOJIBAKE_SQL = lit(MOJIBAKE)

CAB = """-- Gerado por scripts/, nao editar a mao: rode `python3 scripts/build_fixes.py`.
"""

# --------------------------------------------------------------- 000 auditoria
audit = """-- =============================================================================
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
               'select %I as v from public.%I where %I ~ MOJIBAKE_PLACEHOLDER',
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
"""
# O regex vai dentro de uma string SQL que ja esta dentro de outra string SQL,
# entao as aspas simples precisam ser dobradas mais uma vez.
audit = audit.replace(
    'MOJIBAKE_PLACEHOLDER',
    MOJIBAKE_SQL.replace("'", "''")
)

with open('supabase/fixes/000_auditoria_mojibake.sql', 'w', encoding='ascii') as fh:
    fh.write(audit)

# ---------------------------------------------- 001 fix quadro_absence_reasons
valores = ',\n'.join(
    "    (%-36s, %s)" % ("'%s'" % rid, lit(nome)) for rid, nome in REASONS
)

fix1 = """-- =============================================================================
-- 001 - CORRECAO DE ACENTUACAO EM public.quadro_absence_reasons
-- =============================================================================
-- ALTERA EXCLUSIVAMENTE public.quadro_absence_reasons.name
--
--   NAO cria e NAO apaga nada.        NAO altera estrutura.
--   NAO toca em objeto do Organico.   NAO mexe em display_order,
--                                     active nem requires_observation.
--
-- IDEMPOTENTE: pode rodar quantas vezes quiser. So grava a linha que estiver
-- diferente do valor correto - rodando de novo, tudo aparece como
-- "ja estava correto".
--
-- Este arquivo e 100% ASCII: os acentos estao escritos como escapes Unicode
-- (\\u00e9 = e-agudo, \\u00e7 = c-cedilha, \\u00e3 = a-til, \\u00ea = e-circunflexo).
-- O PostgreSQL converte na hora de gravar. Assim o proprio script nao pode se
-- corromper ao ser aberto, copiado ou colado - que foi exatamente o que
-- corrompeu os dados na primeira vez.
--
-- COMO USAR: Supabase > SQL Editor > New query > cole tudo > Run.
-- O resultado mostra ANTES e DEPOIS de cada motivo.
-- =============================================================================

with corretos (id, nome_correto) as (
  values
VALORES_PLACEHOLDER
),
antes as (
  -- Fotografia do estado atual. Todas as CTEs enxergam o banco como estava
  -- ANTES do update, entao da para mostrar antes e depois na mesma consulta.
  select r.id, r.name as nome_antes
  from public.quadro_absence_reasons r
),
aplicado as (
  update public.quadro_absence_reasons as r
     set name = c.nome_correto
    from corretos c
   where r.id = c.id
     and r.name is distinct from c.nome_correto
  returning r.id
)
select
  c.id           as id,
  a.nome_antes   as antes,
  c.nome_correto as depois,
  case
    when a.id is null                  then 'AUSENTE (motivo nao existe nesta base)'
    when a.nome_antes = c.nome_correto then 'ja estava correto'
    else                                    'CORRIGIDO'
  end            as situacao
from corretos c
left join antes a on a.id = c.id
order by c.id;

-- Conferencia final: tem que voltar 0.
select count(*) as motivos_ainda_corrompidos
from public.quadro_absence_reasons
where name ~ MOJIBAKE_PLACEHOLDER;
"""
fix1 = fix1.replace('VALORES_PLACEHOLDER', valores)
fix1 = fix1.replace('MOJIBAKE_PLACEHOLDER', MOJIBAKE_SQL)

with open('supabase/fixes/001_fix_quadro_absence_reasons_utf8.sql', 'w',
          encoding='ascii') as fh:
    fh.write(fix1)

# ---------------------------------------------------- 002 fix quadro_positions
valores2 = ',\n'.join(
    "    (%s, %s, %s)" % ("'%s'" % pid, lit(nome), lit(setor))
    for pid, nome, setor in POSITIONS
)

fix2 = """-- =============================================================================
-- 002 - CORRECAO DE ACENTUACAO EM public.quadro_positions      (OPCIONAL)
-- =============================================================================
-- Rode este arquivo SOMENTE se a auditoria (000) apontar quadro_positions.
--
-- Por que ele existe: no catalogo inteiro existem 7 textos com acento. Cinco
-- sao os motivos de falta (arquivo 001). Os outros dois estao aqui:
--
--     quadro_positions.name   = 'AUX. DE COZINHA - REFEIT\\u00d3RIO'
--     quadro_positions.sector = 'REFEIT\\u00d3RIO'
--
-- Se os motivos vieram corrompidos, estes dois quase certamente vieram junto:
-- entraram no banco pelo mesmo install.sql, no mesmo copiar e colar.
--
-- ALTERA EXCLUSIVAMENTE public.quadro_positions (colunas name e sector).
-- NAO altera estrutura, NAO apaga dados, NAO toca no Organico.
-- IDEMPOTENTE: so grava o que estiver diferente.
--
-- Arquivo 100% ASCII, pelo mesmo motivo do 001.
-- =============================================================================

with corretos (id, nome_correto, setor_correto) as (
  values
VALORES_PLACEHOLDER
),
antes as (
  select p.id, p.name as nome_antes, p.sector as setor_antes
  from public.quadro_positions p
),
aplicado as (
  update public.quadro_positions as p
     set name   = c.nome_correto,
         sector = c.setor_correto
    from corretos c
   where p.id = c.id
     and (p.name   is distinct from c.nome_correto
       or p.sector is distinct from c.setor_correto)
  returning p.id
)
select
  c.id            as id,
  a.nome_antes    as nome_antes,
  c.nome_correto  as nome_depois,
  a.setor_antes   as setor_antes,
  c.setor_correto as setor_depois,
  case
    when a.id is null then 'AUSENTE'
    when a.nome_antes = c.nome_correto
     and a.setor_antes = c.setor_correto then 'ja estava correto'
    else                                      'CORRIGIDO'
  end             as situacao
from corretos c
left join antes a on a.id = c.id
order by c.id;

-- Conferencia final: tem que voltar 0.
select count(*) as funcoes_ainda_corrompidas
from public.quadro_positions
where name ~ MOJIBAKE_PLACEHOLDER
   or coalesce(sector, '') ~ MOJIBAKE_PLACEHOLDER;
"""
fix2 = fix2.replace('VALORES_PLACEHOLDER', valores2)
fix2 = fix2.replace('MOJIBAKE_PLACEHOLDER', MOJIBAKE_SQL)

with open('supabase/fixes/002_fix_quadro_positions_utf8.sql', 'w',
          encoding='ascii') as fh:
    fh.write(fix2)

for nome in sorted(os.listdir('supabase/fixes')):
    caminho = 'supabase/fixes/' + nome
    print(caminho, os.path.getsize(caminho), 'bytes')
