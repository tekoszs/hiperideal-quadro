/**
 * FASE 4.1 — AS FUNÇÕES DE CADA LOJA, contra PostgreSQL REAL.
 *
 * Rodam apenas com DATABASE_URL definida; sem ela a suíte é PULADA.
 *
 *   DATABASE_URL=postgres://usuario:senha@localhost:5432/hiperideal npm test
 *
 * O DEFEITO QUE ESTES TESTES IMPEDEM DE VOLTAR
 * --------------------------------------------
 * A tela do gerente carrega as funções por `quadro_store_staffing`. Depois de
 * abrir a rede para 34 lojas, só a 124 tinha vínculos — as outras 33 entrariam
 * com a lista vazia e o gerente não teria em que lançar falta nem folga.
 *
 * Verificado antes da correção, num banco com as 34 lojas: 33 lojas com 0
 * funções. O que o defeito tem de perigoso é ser MUDO: nenhum erro, nenhuma
 * exceção — só uma tela vazia que parece "ainda não carregou".
 *
 * SOBRE AS CONTAGENS
 * ------------------
 * `seedTestUsers` cria uma loja extra (`store-999-teste`) que existe só para
 * provar isolamento entre lojas e NÃO faz parte da rede oficial. Por isso os
 * testes de contagem se apoiam na lista oficial de `@/data/network`, e não em
 * "tudo que está na tabela": assim eles afirmam o que realmente querem dizer
 * — "as 34 lojas oficiais têm 25 funções cada" — sem depender de quais
 * fixtures de teste rodaram antes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { NETWORK_STORES } from '@/data/network';
import {
  OTHER_STORE,
  TEST_STORE,
  USERS,
  asSuperuser,
  asUser,
  connect,
  seedTestUsers,
} from './dbHelpers';

const DATABASE_URL = process.env.DATABASE_URL;

/** Ids das lojas OFICIAIS — a rede, sem as lojas de teste. */
const OFICIAIS = NETWORK_STORES.filter((store) => store.active).map((store) => store.id);

const suite = DATABASE_URL ? describe : describe.skip;

suite('Funções disponíveis por loja (staffing da rede)', () => {
  let db: Client;

  /** Lido do banco, nunca fixado: se o catálogo crescer, o esperado cresce. */
  let funcoesAtivas = 0;

  beforeAll(async () => {
    db = await connect(DATABASE_URL as string);
    await seedTestUsers(db);
    await asSuperuser(db);

    const { rows } = await db.query(
      'select count(*)::int as total from public.quadro_positions where active',
    );
    funcoesAtivas = rows[0].total;
  });

  afterAll(async () => {
    if (db) {
      await asSuperuser(db);
      await db.end();
    }
  });

  /**
   * As funções que a loja entrega, pelo MESMO caminho do frontend.
   *
   * Espelha `listPositionsByStore` em `src/services/catalogService.ts`:
   *
   *     .from('quadro_store_staffing')
   *     .select('... positions:quadro_positions (...)')
   *     .eq('store_id', storeId)
   *     .is('effective_to', null)
   *
   * Duas coisas de propósito: o join com `quadro_positions` (o adaptador pede
   * o aninhado, então função inativa não deve aparecer) e a ausência de
   * qualquer filtro extra — o que a consulta devolve é o que a tela mostra.
   */
  async function funcoesDaLoja(storeId: string) {
    const { rows } = await db.query(
      `select p.id, p.name, p.function_group, p.sector
         from public.quadro_store_staffing st
         join public.quadro_positions p on p.id = st.position_id
        where st.store_id = $1
          and st.effective_to is null
          and p.active
        order by p.display_order`,
      [storeId],
    );
    return rows as Array<{ id: string; name: string; function_group: string; sector: string | null }>;
  }

  /* =======================================================================
   * A rede e o total
   * ==================================================================== */

  // TESTE 1
  it('1. a rede oficial tem 34 lojas ativas', async () => {
    await asSuperuser(db);
    const { rows } = await db.query(
      'select count(*)::int as total from public.quadro_stores where active and id = any($1)',
      [OFICIAIS],
    );
    expect(rows[0].total).toBe(34);
  });

  // TESTE 2
  it('2. o catálogo tem 25 funções ativas', () => {
    expect(funcoesAtivas).toBe(25);
  });

  // TESTE 3
  it('3. a rede oficial tem exatamente 850 vínculos ativos', async () => {
    await asSuperuser(db);
    const { rows } = await db.query(
      `select count(*)::int as total
         from public.quadro_store_staffing st
         join public.quadro_positions p on p.id = st.position_id and p.active
        where st.effective_to is null
          and st.store_id = any($1)`,
      [OFICIAIS],
    );
    expect(rows[0].total).toBe(850);
    // E 850 não é um número mágico: é 34 × 25.
    expect(rows[0].total).toBe(OFICIAIS.length * funcoesAtivas);
  });

  // TESTE 4 — o que realmente importa para o gerente.
  it('4. TODA loja ativa tem exatamente 25 funções — nenhuma fica vazia', async () => {
    await asSuperuser(db);
    const { rows } = await db.query(
      `select s.id, s.code, count(st.id)::int as funcoes
         from public.quadro_stores s
         left join public.quadro_store_staffing st
                on st.store_id = s.id and st.effective_to is null
        where s.active
        group by s.id, s.code
       having count(st.id) <> $1
        order by s.code`,
      [funcoesAtivas],
    );

    expect(
      rows.map((row) => `${row.code}=${row.funcoes}`),
      'estas lojas não ficaram com o conjunto completo de funções',
    ).toEqual([]);
  });

  // TESTE 5
  it('5. nenhuma loja tem a mesma função duas vezes', async () => {
    await asSuperuser(db);
    const { rows } = await db.query(
      `select store_id, position_id, count(*)::int as n
         from public.quadro_store_staffing
        where effective_to is null
        group by store_id, position_id
       having count(*) > 1`,
    );
    expect(rows).toEqual([]);
  });

  /* =======================================================================
   * A loja que já estava em produção
   * ==================================================================== */

  // TESTE 6 — o erro clássico de seed: duplicar em vez de completar.
  it('6. a loja 124 continua com 25 vínculos, não 50', async () => {
    await asSuperuser(db);
    const { rows } = await db.query(
      'select count(*)::int as total from public.quadro_store_staffing where store_id = $1',
      [TEST_STORE],
    );
    // Conta TODAS as linhas, inclusive encerradas: 50 aqui significaria que o
    // seed criou uma segunda geração de vínculos por cima da primeira.
    expect(rows[0].total).toBe(25);
  });

  // TESTE 7
  it('7. os ids e as datas originais da 124 permanecem intactos', async () => {
    await asSuperuser(db);
    const { rows } = await db.query(
      `select id, effective_from::text as desde
         from public.quadro_store_staffing
        where store_id = $1
        order by id`,
      [TEST_STORE],
    );

    // Ids no padrão do seed original, sem "pos-" no meio.
    expect(rows[0].id).toBe('staff-124-acougueiro');
    expect(rows.every((row) => /^staff-124-[a-z0-9-]+$/.test(row.id))).toBe(true);
    expect(rows.some((row) => row.id.includes('-pos-'))).toBe(false);

    // A data de início é a do catálogo, não a da implantação da rede.
    expect(new Set(rows.map((row) => row.desde))).toEqual(new Set(['2026-01-01']));
  });

  // TESTE 8 — não inventar quadro autorizado.
  it('8. todo vínculo novo nasce com authorized_quantity NULL', async () => {
    await asSuperuser(db);
    const { rows } = await db.query(
      `select count(*)::int as preenchidos
         from public.quadro_store_staffing
        where authorized_quantity is not null`,
    );
    // Sem denominador real não existe "% do quadro ausente" — e um número
    // inventado seria pior que número nenhum.
    expect(rows[0].preenchidos).toBe(0);
  });

  /* =======================================================================
   * O caminho do frontend, loja por loja
   * ==================================================================== */

  // TESTES 9 a 12
  const sondas: Array<[string, string]> = [
    ['store-307', 'LEPARC'],
    ['store-311', 'PANAMBY'],
    ['store-115', 'CANELA'],
    ['store-124', 'PQSHOP'],
  ];

  for (const [storeId, nome] of sondas) {
    it(`${9 + sondas.findIndex(([id]) => id === storeId)}. ${nome} devolve 25 funções pelo caminho do frontend`, async () => {
      await asSuperuser(db);
      const funcoes = await funcoesDaLoja(storeId);
      expect(funcoes).toHaveLength(funcoesAtivas);
      expect(new Set(funcoes.map((f) => f.id)).size).toBe(funcoesAtivas);
    });
  }

  // TESTE 13
  it('13. as funções detalhadas continuam separadas em cada loja', async () => {
    await asSuperuser(db);

    for (const storeId of ['store-307', 'store-311', 'store-124']) {
      const funcoes = await funcoesDaLoja(storeId);
      const doGrupo = (grupo: string) => funcoes.filter((f) => f.function_group === grupo);

      // Nada de "ATENDENTE ALIMENTOS" consolidado: são três registros.
      expect(doGrupo('ATENDENTE ALIMENTOS').map((f) => f.sector).sort()).toEqual([
        'FATIADOS',
        'FRUTAS',
        'PADARIA',
      ]);
      expect(doGrupo('AUX. DE COZINHA').map((f) => f.sector).sort()).toEqual([
        'GALETERIA',
        'REFEITÓRIO',
      ]);
      expect(doGrupo('REPOSITOR').map((f) => f.sector).sort()).toEqual([
        'BAZAR',
        'FRIOS',
        'HORTI',
        'MERCEARIA',
      ]);
    }
  });

  // TESTE 14 — o seed pode ser reexecutado sem estragar nada.
  it('14. rodar o seed de novo não passa de 850 nem cria linha nova', async () => {
    await asSuperuser(db);

    const antes = await db.query(
      'select count(*)::int as total from public.quadro_store_staffing',
    );

    // O MESMO insert da migration 0017, palavra por palavra.
    await db.query(
      `insert into public.quadro_store_staffing
         (id, store_id, position_id, authorized_quantity, effective_from)
       select 'staff-' || s.code || '-' || regexp_replace(p.id, '^pos-', ''),
              s.id, p.id, null, current_date
         from public.quadro_stores s
        cross join public.quadro_positions p
        where s.active and p.active
          and not exists (
            select 1 from public.quadro_store_staffing existente
             where existente.store_id = s.id
               and existente.position_id = p.id
               and existente.effective_to is null
          )
       on conflict (id) do nothing`,
    );

    const depois = await db.query(
      'select count(*)::int as total from public.quadro_store_staffing',
    );

    expect(depois.rows[0].total).toBe(antes.rows[0].total);

    const oficiais = await db.query(
      `select count(*)::int as total
         from public.quadro_store_staffing st
         join public.quadro_positions p on p.id = st.position_id and p.active
        where st.effective_to is null and st.store_id = any($1)`,
      [OFICIAIS],
    );
    expect(oficiais.rows[0].total).toBe(850);
  });

  // TESTE 15 — a RLS não afrouxou ao abrir a rede.
  it('15. o gerente lê apenas o staffing da própria loja', async () => {
    await asUser(db, USERS.manager.id);

    const todas = await db.query(
      'select distinct store_id from public.quadro_store_staffing where effective_to is null',
    );
    expect(todas.rows.map((row) => row.store_id)).toEqual([TEST_STORE]);

    // E a lista dele continua completa: isolamento não é o mesmo que ficar sem dado.
    const proprias = await db.query(
      `select count(*)::int as total
         from public.quadro_store_staffing st
         join public.quadro_positions p on p.id = st.position_id and p.active
        where st.effective_to is null`,
    );
    expect(proprias.rows[0].total).toBe(funcoesAtivas);

    // Pedir a loja de outro gerente pelo id não traz nada.
    const alheia = await db.query(
      'select id from public.quadro_store_staffing where store_id = $1',
      [OTHER_STORE],
    );
    expect(alheia.rows).toHaveLength(0);

    // Uma loja da rede que ele não gerencia também não aparece.
    const daRede = await db.query(
      'select id from public.quadro_store_staffing where store_id = $1',
      ['store-307'],
    );
    expect(daRede.rows).toHaveLength(0);
  });
});
