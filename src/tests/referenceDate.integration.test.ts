/**
 * FASE 4.3 — A DATA DE REFERÊNCIA no banco, contra PostgreSQL REAL.
 *
 * Rodam apenas com DATABASE_URL definida; sem ela a suíte é PULADA.
 *
 * O que só o banco pode responder:
 *
 *   • a unicidade `loja + data` é real, ou só uma convenção do frontend?
 *   • a RPC de rascunho REUSA a conferência do dia, ou cria outra?
 *   • um gerente consegue gravar conferência de OUTRA loja?
 *
 * Nenhuma migration foi criada para esta fase: a constraint
 * `quadro_daily_conferences_store_date_key` já existia desde a 0004. Estes
 * testes são a prova de que ela faz o trabalho — e o motivo de não haver
 * migration nova.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  OTHER_STORE,
  TEST_STORE,
  USERS,
  asSuperuser,
  daysAgo,
  asUser,
  connect,
  resetConferences,
  rpcItems,
  saveDraft,
  seedTestUsers,
  submitConference,
} from './dbHelpers';

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * O "sábado" e o "domingo" da história — RELATIVOS ao hoje.
 *
 * Eram datas fixas: a fase 4.3 não tinha regra de data no banco, então tanto
 * fazia. A fase 4.5 pôs o guard dentro da RPC (`reference_date >= current_date`
 * é recusado no envio), e uma data fixa passaria a falhar exatamente no dia em
 * que ela virasse "hoje". Relativa, a história é a mesma e o teste não envelhece.
 */
const SABADO = daysAgo(2);
const DOMINGO = daysAgo(1);

const CAIXA = 'pos-operador-de-caixa';
const INJUSTIFICADA = 'reason-falta-injustificada';

const suite = DATABASE_URL ? describe : describe.skip;

suite('Data de referência — integridade no banco', () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect(DATABASE_URL as string);
    await seedTestUsers(db);
  });

  afterAll(async () => {
    if (db) {
      await asSuperuser(db);
      await db.end();
    }
  });

  beforeEach(async () => {
    await resetConferences(db);
    // Limpa também as duas datas da história, que ficam fora do reset padrão.
    await asSuperuser(db);
    await db.query("select set_config('quadro.status_change', 'on', false)");
    await db.query(
      'delete from public.quadro_daily_conferences where reference_date = any($1::date[])',
      [[SABADO, DOMINGO]],
    );
    await db.query("select set_config('quadro.status_change', 'off', false)");
  });

  const umaFalta = (quantidade: number) =>
    rpcItems([
      {
        positionId: CAIXA,
        absence: quantidade,
        reasons: [{ reasonId: INJUSTIFICADA, quantity: quantidade }],
      },
    ]);

  /* =====================================================================
   * I) Uma conferência por loja e data
   * ================================================================== */

  // TESTE I
  it('I. a mesma loja e data NÃO produzem duas conferências', async () => {
    await asUser(db, USERS.manager.id);

    const primeira = await saveDraft(db, TEST_STORE, SABADO, umaFalta(1));
    // Segunda gravação na MESMA data: tem de reusar, não criar outra.
    const segunda = await saveDraft(db, TEST_STORE, SABADO, umaFalta(4));

    expect(segunda).toBe(primeira);

    await asSuperuser(db);
    const { rows } = await db.query(
      'select count(*)::int as total from public.quadro_daily_conferences where store_id = $1 and reference_date = $2::date',
      [TEST_STORE, SABADO],
    );
    expect(rows[0].total).toBe(1);
  });

  it('I. e o INSERT direto de uma segunda é recusado pela constraint', async () => {
    await asUser(db, USERS.manager.id);
    await saveDraft(db, TEST_STORE, SABADO, umaFalta(1));

    await asSuperuser(db);
    await expect(
      db.query(
        `insert into public.quadro_daily_conferences (store_id, reference_date, status, created_by)
         values ($1, $2::date, 'DRAFT', $3)`,
        [TEST_STORE, SABADO, USERS.manager.id],
      ),
    ).rejects.toThrow(/quadro_daily_conferences_store_date_key|duplicate key/i);
  });

  it('a constraint de unicidade existe e é por (store_id, reference_date)', async () => {
    await asSuperuser(db);
    const { rows } = await db.query(
      `select pg_get_constraintdef(oid) as definicao
         from pg_constraint
        where conrelid = 'public.quadro_daily_conferences'::regclass
          and contype = 'u'`,
    );
    expect(rows.map((r) => r.definicao)).toContain('UNIQUE (store_id, reference_date)');
  });

  /* =====================================================================
   * Sábado e domingo são conferências independentes
   * ================================================================== */

  it('sábado e domingo convivem como conferências separadas', async () => {
    await asUser(db, USERS.manager.id);

    const sabado = await saveDraft(db, TEST_STORE, SABADO, umaFalta(3));
    const domingo = await saveDraft(db, TEST_STORE, DOMINGO, umaFalta(1));

    expect(sabado).not.toBe(domingo);

    await submitConference(db, sabado);

    await asSuperuser(db);
    const { rows } = await db.query(
      `select reference_date::text as data, status
         from public.quadro_daily_conferences
        where store_id = $1 and reference_date = any($2::date[])
        order by reference_date`,
      [TEST_STORE, [SABADO, DOMINGO]],
    );

    // Enviar o sábado não mexe no domingo: ele continua rascunho.
    expect(rows).toEqual([
      { data: SABADO, status: 'SUBMITTED' },
      { data: DOMINGO, status: 'DRAFT' },
    ]);
  });

  // TESTE G, no banco
  it('G. conferência ENVIADA não aceita alteração nem novo envio', async () => {
    await asUser(db, USERS.manager.id);
    const id = await saveDraft(db, TEST_STORE, SABADO, umaFalta(2));
    await submitConference(db, id);

    // Regravar a mesma data pela RPC de rascunho tem de falhar.
    await expect(saveDraft(db, TEST_STORE, SABADO, umaFalta(9))).rejects.toThrow();

    await asSuperuser(db);
    const { rows } = await db.query(
      'select status, (select sum(absence_quantity) from public.quadro_daily_items i where i.conference_id = c.id) as faltas from public.quadro_daily_conferences c where c.id = $1',
      [id],
    );
    expect(rows[0].status).toBe('SUBMITTED');
    expect(Number(rows[0].faltas)).toBe(2); // continua 2, não virou 9
  });

  /* =====================================================================
   * L) A loja continua vindo do perfil
   * ================================================================== */

  // TESTE L
  it('L. o gerente não grava conferência de OUTRA loja, em nenhuma data', async () => {
    await asUser(db, USERS.manager.id);

    // Mesmo pedindo explicitamente a loja alheia, e mesmo numa data válida.
    for (const data of [SABADO, DOMINGO]) {
      await expect(saveDraft(db, OTHER_STORE, data, umaFalta(1))).rejects.toThrow(
        /Sem permissão/i,
      );
    }

    await asSuperuser(db);
    const { rows } = await db.query(
      'select count(*)::int as total from public.quadro_daily_conferences where store_id = $1',
      [OTHER_STORE],
    );
    expect(rows[0].total).toBe(0);
  });

  it('L. e nem enxerga a conferência da outra loja', async () => {
    await asUser(db, USERS.otherManager.id);
    const alheia = await saveDraft(db, OTHER_STORE, SABADO, umaFalta(5));
    expect(alheia).toBeTruthy();

    await asUser(db, USERS.manager.id);
    const { rows } = await db.query(
      'select id from public.quadro_daily_conferences where reference_date = $1::date',
      [SABADO],
    );
    expect(rows).toHaveLength(0);
  });

  /* =====================================================================
   * M e N) O supervisor não muda
   * ================================================================== */

  // TESTE M
  it('M. só SUBMITTED alimenta os números oficiais', async () => {
    await asUser(db, USERS.manager.id);
    const sabado = await saveDraft(db, TEST_STORE, SABADO, umaFalta(3));
    await submitConference(db, sabado);
    // O domingo fica em RASCUNHO com 10 faltas — não pode entrar em nada.
    await saveDraft(db, TEST_STORE, DOMINGO, umaFalta(10));

    await asUser(db, USERS.supervisor.id);
    const { rows } = await db.query(
      `select coalesce(sum(absence_quantity), 0)::int as faltas
         from public.quadro_v_conference_items
        where store_id = $1
          and reference_date = any($2::date[])
          and status = 'SUBMITTED'`,
      [TEST_STORE, [SABADO, DOMINGO]],
    );

    // 3, não 13. As 10 do rascunho ficam de fora.
    expect(rows[0].faltas).toBe(3);
  });

  // TESTE N
  it('N. dia SEM conferência é ausência de dado, não zero falta', async () => {
    await asUser(db, USERS.manager.id);
    const sabado = await saveDraft(db, TEST_STORE, SABADO, umaFalta(3));
    await submitConference(db, sabado);
    // O domingo não recebe conferência nenhuma.

    await asUser(db, USERS.supervisor.id);
    const { rows } = await db.query(
      `select c.reference_date::text as data, c.status
         from public.quadro_daily_conferences c
        where c.store_id = $1 and c.reference_date = any($2::date[])`,
      [TEST_STORE, [SABADO, DOMINGO]],
    );

    // O domingo simplesmente NÃO EXISTE como linha. Quem lê o consolidado tem
    // de tratar isso como "não informado" — nunca como um zero apurado. É a
    // mesma distinção que `DayCoverageState` faz na Visão da Rede.
    expect(rows).toHaveLength(1);
    expect(rows[0].data).toBe(SABADO);
    expect(rows.some((r) => r.data === DOMINGO)).toBe(false);
  });
});
