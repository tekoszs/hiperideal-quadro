-- ===========================================================================
-- 0017 -- FUNCOES DISPONIVEIS EM TODAS AS LOJAS DA REDE
-- ===========================================================================
--
-- O PROBLEMA QUE ESTA MIGRATION RESOLVE
-- -------------------------------------
-- A tela do gerente carrega as funcoes da loja por `quadro_store_staffing`:
--
--     select ... from quadro_store_staffing
--      where store_id = ? and effective_to is null
--
-- Ate a fase 4 so existia a loja 124, com seus 25 vinculos. Depois de abrir a
-- rede para 34 lojas, as outras 33 entrariam com a lista de funcoes VAZIA --
-- o gerente faria login e nao teria em que lancar falta nem folga.
--
-- Verificado antes de escrever esta migration, num banco com as 34 lojas:
-- 33 lojas com 0 funcoes, 1 loja com 25.
--
--
-- POR QUE UM ARQUIVO NOVO, E NAO DENTRO DE 0016
-- --------------------------------------------
-- 0016 e GERADO por scripts/build_network.py. Logica escrita a mao la dentro
-- seria apagada na proxima regeracao -- ou o gerador teria que aprender sobre
-- staffing, que nao e assunto dele: ele responde "quais lojas existem", nao
-- "que funcoes cada loja confere". As duas coisas mudam por motivos
-- diferentes, entao ficam em arquivos diferentes.
--
--
-- ATENCAO A ORDEM DE EXECUCAO -- LEIA ANTES DE MOVER ESTE ARQUIVO
-- ---------------------------------------------------------------
-- Este seed depende de DUAS fontes:
--
--     quadro_stores      <- migration 0016
--     quadro_positions   <- seed.sql   (NAO e migration)
--
-- E `install.sql` roda as migrations ANTES do seed.sql. Ou seja: num banco
-- NOVO, quando esta migration executa na ordem numerica, o catalogo de funcoes
-- ainda esta vazio e o insert acerta zero linhas.
--
-- Duas providencias, porque uma so nao bastaria:
--
--   1. build_schema.sh REPETE este arquivo no fim do install.sql, depois do
--      seed. Como tudo aqui e idempotente, executar duas vezes nao duplica
--      nada -- a primeira passada nao acha funcao e nao faz nada, a segunda
--      cria os vinculos;
--
--   2. o bloco de verificacao no fim distingue os dois casos e AVISA. Zero
--      vinculo com catalogo vazio e situacao esperada e passa; zero vinculo
--      com catalogo cheio e defeito e levanta excecao.
--
-- No banco que ja esta em producao (que tem as funcoes ha fases) a ordem nao
-- e problema nenhum: rodar 0013..0017 em sequencia funciona direto.
--
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ----------------------------
-- NAO inventa quadro autorizado. Todo vinculo novo nasce com
-- `authorized_quantity = NULL`, que e como o sistema diz "nao informado".
-- Enquanto for NULL, nenhuma tela calcula percentual de impacto sobre o
-- quadro -- nao existe denominador real, e um numero inventado seria pior que
-- numero nenhum.
--
-- NAO toca nos vinculos que ja existem. A loja 124 mantem seus 25 registros
-- originais: mesmos ids, mesmo `effective_from`, mesmo `authorized_quantity`.
-- O `not exists` abaixo pula qualquer par (loja, funcao) que ja tenha vinculo
-- ativo, entao rodar isto na 124 nao cria uma segunda linha nem sobrescreve a
-- primeira.
--
-- NAO consolida funcao nenhuma. ATENDENTE ALIMENTOS - PADARIA, - FATIADOS e
-- - FRUTAS entram como tres vinculos separados em cada loja, e o mesmo vale
-- para AUX. DE COZINHA e REPOSITOR. O cadastro operacional segue a planilha.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Os vinculos que faltam
--
-- CROSS JOIN entre lojas ativas e funcoes ativas, menos o que ja existe.
-- Escrever 850 linhas a mao daria o mesmo resultado hoje e estaria errado
-- amanha: loja nova ou funcao nova exigiria reescrever o arquivo, e e
-- exatamente ai que uma linha se perde sem ninguem notar.
--
-- ID DETERMINISTICO, no mesmo padrao dos registros que ja existem:
--
--     store-124 + pos-operador-de-caixa  ->  staff-124-operador-de-caixa
--     store-307 + pos-operador-de-caixa  ->  staff-307-operador-de-caixa
--
-- Determinismo aqui nao e estetica: como o id e sempre o mesmo para o mesmo
-- par, a chave primaria vira a segunda barreira contra duplicata, junto com o
-- indice unico parcial `quadro_store_staffing_active_unique_idx`.
--
-- `effective_from = current_date`: o vinculo passa a valer quando a rede foi
-- implantada. Copiar a data da 124 (2026-01-01) seria inventar que a loja 307
-- confere funcoes desde janeiro.
-- ---------------------------------------------------------------------------
insert into public.quadro_store_staffing
  (id, store_id, position_id, authorized_quantity, effective_from)
select 'staff-' || s.code || '-' || regexp_replace(p.id, '^pos-', ''),
       s.id,
       p.id,
       null,
       current_date
  from public.quadro_stores s
 cross join public.quadro_positions p
 where s.active
   and p.active
   and not exists (
     select 1
       from public.quadro_store_staffing existente
      where existente.store_id = s.id
        and existente.position_id = p.id
        and existente.effective_to is null
   )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Verificacao -- o banco cobra o proprio resultado
--
-- Um seed pela metade e pior que um seed que falha: ele instala silenciosamente
-- uma rede em que algumas lojas nao conseguem lancar conferencia, e isso so
-- aparece quando um gerente tenta usar o sistema.
-- ---------------------------------------------------------------------------
do $$
declare
  v_lojas      integer;
  v_funcoes    integer;
  v_vinculos   integer;
  v_incompleta text;
begin
  select count(*) into v_lojas   from public.quadro_stores    where active;
  select count(*) into v_funcoes from public.quadro_positions where active;

  select count(*) into v_vinculos
    from public.quadro_store_staffing st
    join public.quadro_stores    s on s.id = st.store_id    and s.active
    join public.quadro_positions p on p.id = st.position_id and p.active
   where st.effective_to is null;

  -- Catalogo de funcoes ainda vazio: e a ordem de instalacao, nao um defeito.
  -- build_schema.sh roda este arquivo de novo depois do seed.
  if v_funcoes = 0 then
    raise notice
      'Staffing: catalogo de funcoes vazio -- nada a vincular. Rode este arquivo novamente APOS o seed.sql.';
    return;
  end if;

  -- Alguma loja ficou sem o conjunto completo de funcoes.
  select string_agg(s.code || ' (' || v.n || ')', ', ' order by s.code)
    into v_incompleta
    from (
      select st.store_id, count(*) as n
        from public.quadro_store_staffing st
        join public.quadro_positions p on p.id = st.position_id and p.active
       where st.effective_to is null
       group by st.store_id
    ) v
    right join public.quadro_stores s on s.id = v.store_id and s.active
   where s.active
     and coalesce(v.n, 0) <> v_funcoes;

  if v_incompleta is not null then
    raise exception
      'Staffing incompleto: as lojas a seguir nao ficaram com % funcoes -> %',
      v_funcoes, v_incompleta;
  end if;

  if v_vinculos <> v_lojas * v_funcoes then
    raise exception
      'Staffing inconsistente: esperado % vinculos (% lojas x % funcoes), encontrado %.',
      v_lojas * v_funcoes, v_lojas, v_funcoes, v_vinculos;
  end if;

  raise notice 'Staffing da rede: % vinculos ativos (% lojas x % funcoes).',
    v_vinculos, v_lojas, v_funcoes;
end $$;
