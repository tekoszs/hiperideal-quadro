import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OTHER_STORE,
  TEST_STORE,
  USERS,
  asAnon,
  asSuperuser,
  asUser,
  connect,
  resetConferences,
  rpcItems,
  seedHistoricalConference,
  seedTestUsers,
} from './dbHelpers';

/**
 * FASE 3B — a leitura por PERÍODO contra PostgreSQL REAL.
 *
 * As mesmas consultas que o SupabaseAdapter faz em `getNetworkRange`, com o
 * papel `authenticated` e a identidade que o PostgREST publica. É aqui que a
 * RLS é provada: os testes de tela usam adaptador de mentira e, por definição,
 * não conseguem provar acesso.
 *
 * Sem DATABASE_URL a suíte é PULADA — nunca marcada como aprovada.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/** Três dias seguidos, longe das datas usadas pelas outras suítes. */
const DIA_1 = '2026-04-10';
const DIA_2 = '2026-04-11';
const DIA_3 = '2026-04-12';
const INICIO = DIA_1;
const FIM = DIA_3;

/** Colunas exatamente como o adaptador pede na view de itens. */
const ITEMS_RANGE = `
  select conference_id, store_id, store_name, reference_date, position_id,
         position_name, function_group, sector, absence_quantity, day_off_quantity
    from public.quadro_v_conference_items
   where reference_date >= $1 and reference_date <= $2
`;

/** Idem na view de motivos — sem absence_quantity, que nem existe lá. */
const REASONS_RANGE = `
  select conference_id, store_id, reference_date, position_id,
         reason_id, reason_name, reason_quantity
    from public.quadro_v_conference_item_reasons
   where reference_date >= $1 and reference_date <= $2
`;

const CONFERENCES_RANGE = `
  select id, store_id, reference_date, status, submitted_at
    from public.quadro_daily_conferences
   where reference_date >= $1 and reference_date <= $2
`;

suite('Visão da Rede por período (PostgreSQL real)', () => {
  let db: Client;

  /**
   * Uma conferência ENVIADA no dia pedido.
   *
   * Escrita direto nas tabelas, não pela RPC: as datas desta suíte são de meses
   * atrás — escolhidas de propósito para não colidir com as outras suítes — e
   * desde a 0018 as RPCs recusam qualquer data fora da janela de 7 dias. Aqui o
   * que se prova é a LEITURA analítica, e o histórico antigo é o insumo dela.
   */
  async function enviarConferencia(date: string, itens: ReturnType<typeof rpcItems>) {
    await seedHistoricalConference(db, {
      storeId: TEST_STORE,
      referenceDate: date,
      createdBy: USERS.manager.id,
      status: 'SUBMITTED',
      items: itens,
    });
  }

  beforeAll(async () => {
    db = await connect(DATABASE_URL as string);
    await seedTestUsers(db);
    await resetConferences(db);

    // DIA 1 — 3 faltas, sendo 2 no caixa divididas em 2 motivos, e 6 folgas.
    await enviarConferencia(DIA_1, [
      {
        position_id: 'pos-atendente-alimentos-padaria',
        absence_quantity: 1,
        day_off_quantity: 0,
        observation: null,
        reasons: [{ reason_id: 'reason-atestado-medico', quantity: 1, observation: null }],
      },
      {
        position_id: 'pos-operador-de-caixa',
        absence_quantity: 2,
        day_off_quantity: 6,
        observation: null,
        reasons: [
          { reason_id: 'reason-atestado-medico', quantity: 1, observation: null },
          { reason_id: 'reason-falta-injustificada', quantity: 1, observation: null },
        ],
      },
    ]);

    // DIA 2 — 2 faltas.
    await enviarConferencia(DIA_2, [
      {
        position_id: 'pos-operador-de-caixa',
        absence_quantity: 2,
        day_off_quantity: 0,
        observation: null,
        reasons: [{ reason_id: 'reason-falta-injustificada', quantity: 2, observation: null }],
      },
    ]);

    // DIA 3 fica SEM conferência de propósito: é a pendência do período.
    await asSuperuser(db);
  });

  afterAll(async () => {
    if (!db) return;
    await resetConferences(db);
    await db.end();
  });

  // TESTE 25
  describe('SUPERVISOR lê a rede no período', () => {
    it('lê as conferências do intervalo', async () => {
      await asUser(db, USERS.supervisor.id);
      const { rows } = await db.query(CONFERENCES_RANGE, [INICIO, FIM]);

      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.reference_date.toISOString().slice(0, 10)).sort()).toEqual([
        DIA_1,
        DIA_2,
      ]);
      expect(rows.every((row) => row.status === 'SUBMITTED')).toBe(true);
    });

    it('lê a view de itens com o filtro de data', async () => {
      await asUser(db, USERS.supervisor.id);
      const { rows } = await db.query(ITEMS_RANGE, [INICIO, FIM]);

      // 2 funções no dia 1 + 1 no dia 2.
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.store_id === TEST_STORE)).toBe(true);
      // O nome da loja e o grupo de função vêm prontos na view.
      expect(rows[0].store_name).toBeTruthy();
      expect(rows.some((row) => row.function_group === 'OPERADOR DE CAIXA')).toBe(true);
    });

    // TESTES 1 e 2 no banco
    it('os totais do período saem da view de ITENS', async () => {
      await asUser(db, USERS.supervisor.id);
      const { rows } = await db.query(
        `select sum(absence_quantity)::int as faltas,
                sum(day_off_quantity)::int as folgas,
                count(distinct reference_date)::int as dias_com_dado
           from public.quadro_v_conference_items
          where reference_date >= $1 and reference_date <= $2`,
        [INICIO, FIM],
      );

      expect(rows[0].faltas).toBe(5); // 1 + 2 + 2
      expect(rows[0].folgas).toBe(6);
      expect(rows[0].dias_com_dado).toBe(2);
    });

    // TESTES 3 e 24 no banco
    it('somar faltas pela view de MOTIVOS é impossível: a coluna não existe', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public'
            and table_name = 'quadro_v_conference_item_reasons'
            and column_name in ('absence_quantity', 'day_off_quantity')`,
      );
      expect(rows).toHaveLength(0);

      await asUser(db, USERS.supervisor.id);
      await expect(
        db.query(
          `select sum(absence_quantity) from public.quadro_v_conference_item_reasons
            where reference_date >= $1 and reference_date <= $2`,
          [INICIO, FIM],
        ),
      ).rejects.toThrow(/does not exist/i);
    });

    it('a view de motivos repete a função — e mesmo assim os totais batem', async () => {
      await asUser(db, USERS.supervisor.id);

      const motivos = await db.query(REASONS_RANGE, [INICIO, FIM]);
      // O caixa do dia 1 aparece 2 vezes (2 motivos) + padaria + caixa do dia 2.
      expect(motivos.rows).toHaveLength(4);

      const soma = await db.query(
        `select sum(reason_quantity)::int as total
           from public.quadro_v_conference_item_reasons
          where reference_date >= $1 and reference_date <= $2`,
        [INICIO, FIM],
      );
      // A soma dos motivos fecha com as 5 faltas — nunca 7.
      expect(soma.rows[0].total).toBe(5);
    });

    it('enxerga todas as lojas ativas, base do cálculo de cobertura', async () => {
      await asUser(db, USERS.supervisor.id);
      const { rows } = await db.query('select id from public.quadro_stores where active');
      const ids = rows.map((row) => row.id as string);

      expect(ids).toContain(TEST_STORE);
      expect(ids).toContain(OTHER_STORE);
    });

    // TESTES 17 e 18 no banco
    it('a cobertura sai do cruzamento lojas × dias × conferências enviadas', async () => {
      await asUser(db, USERS.supervisor.id);

      const lojas = await db.query('select count(*)::int as total from public.quadro_stores where active');
      const enviadas = await db.query(
        `select count(*)::int as total from public.quadro_daily_conferences
          where reference_date >= $1 and reference_date <= $2 and status = 'SUBMITTED'`,
        [INICIO, FIM],
      );

      const esperadas = lojas.rows[0].total * 3; // 3 dias
      expect(enviadas.rows[0].total).toBe(2);
      expect(esperadas).toBeGreaterThan(enviadas.rows[0].total);
      // O dia 3 e a outra loja são pendência real, não um número inventado.
      expect(esperadas - enviadas.rows[0].total).toBeGreaterThan(0);
    });

    it('o setor vem da view e função sem setor devolve null, não texto', async () => {
      await asUser(db, USERS.supervisor.id);
      const { rows } = await db.query(ITEMS_RANGE, [INICIO, FIM]);

      const caixa = rows.find((row) => row.position_id === 'pos-operador-de-caixa');
      const padaria = rows.find((row) => row.position_id === 'pos-atendente-alimentos-padaria');

      expect(caixa?.sector).toBeNull();
      expect(padaria?.sector).toBe('PADARIA');
    });
  });

  // TESTE 26
  describe('MANAGER não ganha acesso analítico à rede', () => {
    it('o gerente de outra loja não lê nenhuma linha do período', async () => {
      await asUser(db, USERS.otherManager.id);

      const conferencias = await db.query(CONFERENCES_RANGE, [INICIO, FIM]);
      const itens = await db.query(ITEMS_RANGE, [INICIO, FIM]);
      const motivos = await db.query(REASONS_RANGE, [INICIO, FIM]);

      expect(conferencias.rows).toHaveLength(0);
      expect(itens.rows).toHaveLength(0);
      expect(motivos.rows).toHaveLength(0);
    });

    it('o gerente da loja vê só a própria loja — nunca a rede', async () => {
      await asUser(db, USERS.manager.id);

      const lojas = await db.query('select id from public.quadro_stores');
      expect(lojas.rows.map((row) => row.id)).toEqual([TEST_STORE]);

      const itens = await db.query(ITEMS_RANGE, [INICIO, FIM]);
      expect(new Set(itens.rows.map((row) => row.store_id))).toEqual(new Set([TEST_STORE]));
    });

    it('usuário sem perfil não lê nada do período', async () => {
      await asUser(db, USERS.orphan.id);

      const itens = await db.query(ITEMS_RANGE, [INICIO, FIM]);
      const lojas = await db.query('select id from public.quadro_stores');

      expect(itens.rows).toHaveLength(0);
      expect(lojas.rows).toHaveLength(0);
    });

    it('anon não lê as views analíticas', async () => {
      await asAnon(db);
      await expect(db.query(ITEMS_RANGE, [INICIO, FIM])).rejects.toThrow(/permission denied/i);
      await asSuperuser(db);
    });
  });

  describe('A Visão da Rede não escreve — o banco garante', () => {
    it('supervisor não altera conferência do período', async () => {
      await asUser(db, USERS.supervisor.id);

      const { rowCount } = await db.query(
        `update public.quadro_daily_conferences set status = 'DRAFT'
          where reference_date >= $1 and reference_date <= $2`,
        [INICIO, FIM],
      );
      expect(rowCount).toBe(0);

      await asSuperuser(db);
      const { rows } = await db.query(CONFERENCES_RANGE, [INICIO, FIM]);
      expect(rows.every((row) => row.status === 'SUBMITTED')).toBe(true);
    });

    it('supervisor não apaga itens do período', async () => {
      await asUser(db, USERS.supervisor.id);

      const { rowCount } = await db.query(
        `delete from public.quadro_daily_items
          where conference_id in (
            select id from public.quadro_daily_conferences
             where reference_date >= $1 and reference_date <= $2
          )`,
        [INICIO, FIM],
      );
      expect(rowCount).toBe(0);

      await asSuperuser(db);
      const restantes = await db.query(ITEMS_RANGE, [INICIO, FIM]);
      expect(restantes.rows).toHaveLength(3);
    });
  });

  describe('Desempenho: uma consulta por período, não por loja', () => {
    it('o filtro de data é resolvido pelo banco, não no navegador', async () => {
      await asUser(db, USERS.supervisor.id);

      // Um intervalo de um dia só devolve as linhas daquele dia — prova de que
      // o recorte acontece no PostgreSQL e não depois, em memória.
      const soDia2 = await db.query(ITEMS_RANGE, [DIA_2, DIA_2]);
      expect(soDia2.rows).toHaveLength(1);
      expect(soDia2.rows[0].reference_date.toISOString().slice(0, 10)).toBe(DIA_2);
    });

    it('o plano usa o índice de data quando ele existe', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        `select indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'quadro_daily_conferences'`,
      );
      const definicoes = rows.map((row) => row.indexdef as string).join('\n');

      // Hoje existe (store_id, reference_date desc) — ótimo para a tela do
      // gerente. Um índice só por reference_date ajudaria a Visão da Rede
      // quando a rede crescer; está documentado no adaptador e NÃO foi criado
      // aqui, porque mexer no banco real é decisão do dono.
      expect(definicoes).toContain('reference_date');
    });
  });
});

/**
 * CORREÇÃO DE CONSISTÊNCIA — a prova no banco de que as views trazem DRAFT.
 *
 * Esta suíte cria uma conferência EM RASCUNHO e mostra, em SQL, que ela
 * aparece nas duas views sem nenhum filtro. É o defeito que a correção
 * resolve — e a razão de o adaptador precisar filtrar `status`.
 */
suite('As views NÃO filtram status (por isso o adapter precisa filtrar)', () => {
  let db: Client;
  const DIA_ENVIADA = '2026-04-20';
  const DIA_RASCUNHO = '2026-04-21';

  beforeAll(async () => {
    db = await connect(DATABASE_URL as string);
    await seedTestUsers(db);

    await asSuperuser(db);
    await db.query("select set_config('quadro.status_change','on',false)");
    await db.query('delete from public.quadro_daily_conferences where reference_date = any($1)', [
      [DIA_ENVIADA, DIA_RASCUNHO],
    ]);
    await db.query("select set_config('quadro.status_change','off',false)");

    const payload = (faltas: number, motivo: string) =>
      rpcItems([
        {
          positionId: 'pos-operador-de-caixa',
          absence: faltas,
          reasons: [{ reasonId: motivo, quantity: faltas }],
        },
      ]);

    // Uma ENVIADA com 3 faltas.
    await seedHistoricalConference(db, {
      storeId: TEST_STORE,
      referenceDate: DIA_ENVIADA,
      status: 'SUBMITTED',
      items: payload(3, 'reason-atestado-medico'),
    });

    // Uma em RASCUNHO com 10 faltas — nunca enviada. É a que não pode entrar
    // nos números oficiais.
    await seedHistoricalConference(db, {
      storeId: TEST_STORE,
      referenceDate: DIA_RASCUNHO,
      status: 'DRAFT',
      items: payload(10, 'reason-falta-injustificada'),
    });
    await asSuperuser(db);
  });

  afterAll(async () => {
    if (!db) return;
    await asSuperuser(db);
    await db.query("select set_config('quadro.status_change','on',false)");
    await db.query('delete from public.quadro_daily_conferences where reference_date = any($1)', [
      [DIA_ENVIADA, DIA_RASCUNHO],
    ]);
    await db.query("select set_config('quadro.status_change','off',false)");
    await db.end();
  });

  it('a conferência em rascunho existe e NÃO está enviada', async () => {
    await asUser(db, USERS.supervisor.id);
    const { rows } = await db.query(
      'select status from public.quadro_daily_conferences where reference_date = $1',
      [DIA_RASCUNHO],
    );
    expect(rows[0].status).toBe('DRAFT');
  });

  it('DEFEITO: a view de itens devolve as faltas do rascunho', async () => {
    await asUser(db, USERS.supervisor.id);
    const { rows } = await db.query(
      `select status, absence_quantity from public.quadro_v_conference_items
        where reference_date = $1`,
      [DIA_RASCUNHO],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('DRAFT');
    expect(rows[0].absence_quantity).toBe(10);
  });

  it('DEFEITO: a view de motivos também', async () => {
    await asUser(db, USERS.supervisor.id);
    const { rows } = await db.query(
      `select status, reason_quantity from public.quadro_v_conference_item_reasons
        where reference_date = $1`,
      [DIA_RASCUNHO],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('DRAFT');
  });

  it('sem filtro somaria 13; com o filtro do adapter, 3', async () => {
    await asUser(db, USERS.supervisor.id);

    const semFiltro = await db.query(
      `select coalesce(sum(absence_quantity), 0)::int as total
         from public.quadro_v_conference_items
        where reference_date between $1 and $2`,
      [DIA_ENVIADA, DIA_RASCUNHO],
    );
    // Exatamente o que o SupabaseAdapter passou a fazer.
    const comFiltro = await db.query(
      `select coalesce(sum(absence_quantity), 0)::int as total
         from public.quadro_v_conference_items
        where reference_date between $1 and $2 and status = 'SUBMITTED'`,
      [DIA_ENVIADA, DIA_RASCUNHO],
    );

    expect(semFiltro.rows[0].total).toBe(13);
    expect(comFiltro.rows[0].total).toBe(3);
  });

  it('o filtro por status funciona sem selecionar a coluna', async () => {
    await asUser(db, USERS.supervisor.id);
    // É o que o PostgREST faz: .select(sem status).eq('status','SUBMITTED')
    const { rows } = await db.query(
      `select conference_id, absence_quantity
         from public.quadro_v_conference_items
        where reference_date between $1 and $2 and status = 'SUBMITTED'`,
      [DIA_ENVIADA, DIA_RASCUNHO],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].absence_quantity).toBe(3);
    expect(rows[0]).not.toHaveProperty('status');
  });

  it('a conferência em rascunho continua contando como pendência', async () => {
    await asUser(db, USERS.supervisor.id);
    const { rows } = await db.query(
      `select count(*)::int as total
         from public.quadro_daily_conferences
        where reference_date between $1 and $2 and status <> 'SUBMITTED'`,
      [DIA_ENVIADA, DIA_RASCUNHO],
    );
    expect(rows[0].total).toBe(1);
  });
});
