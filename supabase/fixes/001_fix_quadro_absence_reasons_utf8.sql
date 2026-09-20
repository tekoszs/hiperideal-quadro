-- =============================================================================
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
-- (\u00e9 = e-agudo, \u00e7 = c-cedilha, \u00e3 = a-til, \u00ea = e-circunflexo).
-- O PostgreSQL converte na hora de gravar. Assim o proprio script nao pode se
-- corromper ao ser aberto, copiado ou colado - que foi exatamente o que
-- corrompeu os dados na primeira vez.
--
-- COMO USAR: Supabase > SQL Editor > New query > cole tudo > Run.
-- O resultado mostra ANTES e DEPOIS de cada motivo.
-- =============================================================================

with corretos (id, nome_correto) as (
  values
    ('reason-atestado-medico'            , E'Atestado m\u00e9dico'),
    ('reason-falta-injustificada'        , 'Falta injustificada'),
    ('reason-ausencia-justificada'       , E'Aus\u00eancia justificada'),
    ('reason-declaracao-comparecimento'  , E'Declara\u00e7\u00e3o / comparecimento'),
    ('reason-afastamento'                , 'Afastamento'),
    ('reason-licenca'                    , E'Licen\u00e7a'),
    ('reason-suspensao'                  , E'Suspens\u00e3o'),
    ('reason-outros'                     , 'Outros')
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
where name ~ E'[\u00c2-\u00c3][\u0080-\u00bf]|\ufffd';
