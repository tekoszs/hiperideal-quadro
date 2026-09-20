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
 * FASE 3A — a leitura da rede contra PostgreSQL REAL.
 *
 * Aqui é onde as regras de acesso são provadas: os testes de tela usam um
 * adaptador de mentira e por definição não conseguem provar RLS. Estes rodam
 * as MESMAS consultas do SupabaseAdapter, com o mesmo papel `authenticated` e
 * a mesma identidade que o PostgREST publica.
 *
 * Sem DATABASE_URL a suíte é PULADA — nunca marcada como aprovada.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const REFERENCE_DATE = '2026-03-10';

/** As colunas que o SupabaseAdapter pede na view de itens. */
const ITEMS_SELECT = `
  select conference_id, store_id, position_id, position_name,
         function_group, sector, absence_quantity, day_off_quantity, item_observation
    from public.quadro_v_conference_items
   where reference_date = $1
`;

/**
 * As colunas que o SupabaseAdapter pede na view de motivos.
 * Repare que absence_quantity NÃO está aqui — de propósito.
 */
const REASONS_SELECT = `
  select conference_id, position_id, reason_id, reason_name,
         reason_quantity, reason_observation
    from public.quadro_v_conference_item_reasons
   where reference_date = $1
`;

suite('Leitura da rede pelo supervisor (PostgreSQL real)', () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect(DATABASE_URL as string);
    await seedTestUsers(db);
    await resetConferences(db);

    // Uma conferência ENVIADA na loja 124, com o cenário da duplicação:
    // OPERADOR DE CAIXA com 2 faltas divididas em 2 motivos.
    //
    // Escrita direto nas tabelas, não pela RPC: a data é de meses atrás, e desde
    // a 0018 as RPCs recusam qualquer coisa fora da janela de 7 dias. Esta
    // suíte prova a LEITURA do supervisor, e precisa de histórico longe das
    // datas das outras suítes para não colidir com elas.
    await seedHistoricalConference(db, {
      storeId: TEST_STORE,
      referenceDate: REFERENCE_DATE,
      createdBy: USERS.manager.id,
      status: 'SUBMITTED',
      items: rpcItems([
        {
          positionId: 'pos-atendente-alimentos-padaria',
          absence: 1,
          observation: 'Associada apresentou atestado.',
          reasons: [{ reasonId: 'reason-atestado-medico', quantity: 1 }],
        },
        {
          positionId: 'pos-operador-de-caixa',
          absence: 2,
          dayOff: 6,
          reasons: [
            { reasonId: 'reason-atestado-medico', quantity: 1 },
            { reasonId: 'reason-falta-injustificada', quantity: 1 },
          ],
        },
        { positionId: 'pos-acougueiro' },
      ]),
    });
    await asSuperuser(db);
  });

  afterAll(async () => {
    if (!db) return;
    await resetConferences(db);
    await db.end();
  });

  // TESTE 15
  describe('SUPERVISOR lê a rede inteira', () => {
    it('enxerga TODAS as lojas cadastradas, não só as que enviaram', async () => {
      await asUser(db, USERS.supervisor.id);
      const { rows } = await db.query(
        'select id from public.quadro_stores where active order by id',
      );
      const ids = rows.map((row) => row.id as string);

      expect(ids).toContain(TEST_STORE);
      expect(ids).toContain(OTHER_STORE);
      expect(ids.length).toBeGreaterThanOrEqual(2);
    });

    it('enxerga a conferência da loja 124 na data', async () => {
      await asUser(db, USERS.supervisor.id);
      const { rows } = await db.query(
        `select store_id, status, submitted_at, submitted_by
           from public.quadro_daily_conferences
          where reference_date = $1`,
        [REFERENCE_DATE],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].store_id).toBe(TEST_STORE);
      expect(rows[0].status).toBe('SUBMITTED');
      expect(rows[0].submitted_at).not.toBeNull();
    });

    it('lê as duas views analíticas', async () => {
      await asUser(db, USERS.supervisor.id);

      const itens = await db.query(ITEMS_SELECT, [REFERENCE_DATE]);
      const motivos = await db.query(REASONS_SELECT, [REFERENCE_DATE]);

      expect(itens.rows.length).toBe(3); // 3 funções no payload
      expect(motivos.rows.length).toBe(3); // 1 + 2 motivos
    });

    // TESTE 3, 4 e 5 no banco real
    it('os totais da view de itens não duplicam por motivo', async () => {
      await asUser(db, USERS.supervisor.id);

      const { rows } = await db.query(
        `select sum(absence_quantity)::int as faltas,
                sum(day_off_quantity)::int as folgas,
                count(*) filter (where absence_quantity > 0 or day_off_quantity > 0)::int as impactadas
           from public.quadro_v_conference_items
          where reference_date = $1`,
        [REFERENCE_DATE],
      );

      expect(rows[0].faltas).toBe(3); // 1 + 2
      expect(rows[0].folgas).toBe(6);
      expect(rows[0].impactadas).toBe(2);
    });

    it('a view de motivos REPETE a função — a duplicação é real', async () => {
      await asUser(db, USERS.supervisor.id);

      const { rows } = await db.query(
        `select position_id, count(*)::int as linhas, sum(reason_quantity)::int as soma
           from public.quadro_v_conference_item_reasons
          where reference_date = $1
          group by position_id`,
        [REFERENCE_DATE],
      );

      const caixa = rows.find((row) => row.position_id === 'pos-operador-de-caixa');
      // O OPERADOR DE CAIXA tem 2 faltas em 2 motivos: aparece DUAS vezes aqui.
      expect(caixa?.linhas).toBe(2);
      // Mas a soma dos motivos dele continua sendo 2 — igual às faltas.
      expect(caixa?.soma).toBe(2);
    });

    it('somar faltas na view de motivos é IMPOSSÍVEL: a coluna não existe lá', async () => {
      await asSuperuser(db);

      const { rows } = await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public'
            and table_name = 'quadro_v_conference_item_reasons'
            and column_name in ('absence_quantity', 'day_off_quantity')`,
      );

      // A view de motivos foi desenhada SEM as colunas de falta e folga.
      // Não é convenção nem comentário: o dado não está lá para ser somado.
      expect(rows).toHaveLength(0);

      await asUser(db, USERS.supervisor.id);
      await expect(
        db.query(
          `select sum(absence_quantity) from public.quadro_v_conference_item_reasons
            where reference_date = $1`,
          [REFERENCE_DATE],
        ),
      ).rejects.toThrow(/absence_quantity.*does not exist|column .* does not exist/i);
    });

    it('a view de itens é a única com as colunas de falta e folga', async () => {
      await asSuperuser(db);

      const { rows } = await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public'
            and table_name = 'quadro_v_conference_items'
            and column_name in ('absence_quantity', 'day_off_quantity')
          order by column_name`,
      );

      expect(rows.map((row) => row.column_name)).toEqual([
        'absence_quantity',
        'day_off_quantity',
      ]);
    });

    it('a soma dos motivos fecha com as faltas', async () => {
      await asUser(db, USERS.supervisor.id);

      const { rows } = await db.query(
        `select sum(reason_quantity)::int as total
           from public.quadro_v_conference_item_reasons where reference_date = $1`,
        [REFERENCE_DATE],
      );

      expect(rows[0].total).toBe(3);
    });

    it('a observação da função chega na view', async () => {
      await asUser(db, USERS.supervisor.id);
      const { rows } = await db.query(ITEMS_SELECT, [REFERENCE_DATE]);

      const padaria = rows.find(
        (row) => row.position_id === 'pos-atendente-alimentos-padaria',
      );
      expect(padaria?.item_observation).toBe('Associada apresentou atestado.');
    });
  });

  // TESTE 8 no banco real
  describe('Responsável pelo envio vem do banco', () => {
    it('submitted_by aponta para o perfil do gerente que enviou', async () => {
      await asUser(db, USERS.supervisor.id);

      const { rows } = await db.query(
        `select c.submitted_by, p.name
           from public.quadro_daily_conferences c
           join public.quadro_profiles p on p.id = c.submitted_by
          where c.reference_date = $1`,
        [REFERENCE_DATE],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].submitted_by).toBe(USERS.manager.id);
      expect(rows[0].name).toBe(USERS.manager.name);
    });

    it('o supervisor consegue ler o perfil do gerente (o embed funciona para ele)', async () => {
      await asUser(db, USERS.supervisor.id);
      const { rows } = await db.query('select id, name from public.quadro_profiles where id = $1', [
        USERS.manager.id,
      ]);
      expect(rows).toHaveLength(1);
    });

    it('existem DUAS FKs para quadro_profiles — por isso o embed precisa do hint', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        `select con.conname
           from pg_constraint con
           join pg_class src on src.oid = con.conrelid
           join pg_class tgt on tgt.oid = con.confrelid
          where con.contype = 'f'
            and src.relname = 'quadro_daily_conferences'
            and tgt.relname = 'quadro_profiles'
          order by con.conname`,
      );

      expect(rows.map((row) => row.conname)).toEqual([
        'quadro_daily_conferences_created_by_fkey',
        'quadro_daily_conferences_submitted_by_fkey',
      ]);
    });
  });

  // TESTE 14
  describe('MANAGER não ganha acesso à rede', () => {
    it('continua enxergando só a própria loja em quadro_stores', async () => {
      await asUser(db, USERS.manager.id);
      const { rows } = await db.query('select id from public.quadro_stores');

      expect(rows.map((row) => row.id)).toEqual([TEST_STORE]);
    });

    it('não enxerga conferência de outra loja', async () => {
      // O gerente da loja 999 não pode ver a conferência da 124.
      await asUser(db, USERS.otherManager.id);
      const { rows } = await db.query(
        'select id from public.quadro_daily_conferences where reference_date = $1',
        [REFERENCE_DATE],
      );

      expect(rows).toHaveLength(0);
    });

    it('a view de itens também é filtrada para o gerente', async () => {
      await asUser(db, USERS.otherManager.id);
      const { rows } = await db.query(ITEMS_SELECT, [REFERENCE_DATE]);

      expect(rows).toHaveLength(0);
    });

    it('a view de motivos também é filtrada para o gerente', async () => {
      await asUser(db, USERS.otherManager.id);
      const { rows } = await db.query(REASONS_SELECT, [REFERENCE_DATE]);

      expect(rows).toHaveLength(0);
    });

    it('o gerente da própria loja vê a SUA conferência — e só ela', async () => {
      await asUser(db, USERS.manager.id);
      const { rows } = await db.query(ITEMS_SELECT, [REFERENCE_DATE]);

      expect(rows.length).toBe(3);
      expect(new Set(rows.map((row) => row.store_id))).toEqual(new Set([TEST_STORE]));
    });

    it('o gerente não lê o perfil de outros usuários', async () => {
      await asUser(db, USERS.manager.id);
      const { rows } = await db.query('select id from public.quadro_profiles');

      expect(rows.map((row) => row.id)).toEqual([USERS.manager.id]);
    });
  });

  describe('Sem perfil e sem token não se lê nada', () => {
    it('usuário autenticado sem perfil não enxerga a rede', async () => {
      await asUser(db, USERS.orphan.id);

      const lojas = await db.query('select id from public.quadro_stores');
      const itens = await db.query(ITEMS_SELECT, [REFERENCE_DATE]);

      expect(lojas.rows).toHaveLength(0);
      expect(itens.rows).toHaveLength(0);
    });

    it('anon não lê as views', async () => {
      await asAnon(db);
      await expect(db.query(ITEMS_SELECT, [REFERENCE_DATE])).rejects.toThrow(/permission denied/i);
      await asSuperuser(db);
    });
  });

  describe('A tela é somente leitura — o banco garante', () => {
    it('supervisor não consegue alterar a conferência de uma loja', async () => {
      await asUser(db, USERS.supervisor.id);

      // A RLS não expõe a linha para UPDATE: o comando roda, mas não alcança
      // nenhuma linha. Silencioso e seguro — nada é alterado.
      const { rowCount } = await db.query(
        `update public.quadro_daily_conferences set status = 'DRAFT' where reference_date = $1`,
        [REFERENCE_DATE],
      );
      expect(rowCount).toBe(0);

      await asSuperuser(db);
      const { rows } = await db.query(
        'select status from public.quadro_daily_conferences where reference_date = $1',
        [REFERENCE_DATE],
      );
      expect(rows[0].status).toBe('SUBMITTED');
    });

    it('supervisor não consegue apagar itens da conferência', async () => {
      await asUser(db, USERS.supervisor.id);

      const { rowCount } = await db.query(
        `delete from public.quadro_daily_items
          where conference_id in (
            select id from public.quadro_daily_conferences where reference_date = $1
          )`,
        [REFERENCE_DATE],
      );
      // A RLS não expõe a linha para DELETE: nada é apagado.
      expect(rowCount).toBe(0);

      await asSuperuser(db);
      const restantes = await db.query(ITEMS_SELECT, [REFERENCE_DATE]);
      expect(restantes.rows).toHaveLength(3);
    });
  });

  // TESTE 2 no banco real
  describe('Lojas pendentes saem do cruzamento com quadro_stores', () => {
    it('a loja sem conferência na data não aparece em daily_conferences', async () => {
      await asUser(db, USERS.supervisor.id);

      const lojas = await db.query('select id from public.quadro_stores where active');
      const conferencias = await db.query(
        'select store_id from public.quadro_daily_conferences where reference_date = $1',
        [REFERENCE_DATE],
      );

      const comConferencia = new Set(conferencias.rows.map((row) => row.store_id));
      const pendentes = lojas.rows
        .map((row) => row.id as string)
        .filter((id) => !comConferencia.has(id));

      // É exatamente o cruzamento que buildNetworkRows faz no frontend.
      expect(pendentes).toContain(OTHER_STORE);
      expect(pendentes).not.toContain(TEST_STORE);
    });

    it('em uma data sem nenhuma conferência, todas as lojas ficam pendentes', async () => {
      await asUser(db, USERS.supervisor.id);

      const conferencias = await db.query(
        'select store_id from public.quadro_daily_conferences where reference_date = $1',
        ['2026-03-09'],
      );
      expect(conferencias.rows).toHaveLength(0);
    });
  });
});
