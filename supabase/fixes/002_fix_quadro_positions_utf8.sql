-- =============================================================================
-- 002 - CORRECAO DE ACENTUACAO EM public.quadro_positions      (OPCIONAL)
-- =============================================================================
-- Rode este arquivo SOMENTE se a auditoria (000) apontar quadro_positions.
--
-- Por que ele existe: no catalogo inteiro existem 7 textos com acento. Cinco
-- sao os motivos de falta (arquivo 001). Os outros dois estao aqui:
--
--     quadro_positions.name   = 'AUX. DE COZINHA - REFEIT\u00d3RIO'
--     quadro_positions.sector = 'REFEIT\u00d3RIO'
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
    ('pos-aux-de-cozinha-refeitorio', E'AUX. DE COZINHA - REFEIT\u00d3RIO', E'REFEIT\u00d3RIO')
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
where name ~ E'[\u00c2-\u00c3][\u0080-\u00bf]|\ufffd'
   or coalesce(sector, '') ~ E'[\u00c2-\u00c3][\u0080-\u00bf]|\ufffd';
