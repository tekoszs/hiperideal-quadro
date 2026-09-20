/**
 * Testes de INTEGRAÇÃO contra um PostgreSQL real — regras da conferência.
 *
 * Rodam apenas quando DATABASE_URL está definida:
 *
 *   DATABASE_URL=postgres://usuario:senha@localhost:5432/hiperideal npm test
 *
 * Sem DATABASE_URL a suíte é PULADA (não é marcada como aprovada).
 * O banco precisa ter, nesta ordem:
 *   supabase/local/00_auth_shim.sql   (só em PostgreSQL local)
 *   supabase/schema.sql
 *   supabase/seed.sql
 *
 * Objetivo: provar que o payload que o SupabaseAdapter monta bate com o
 * contrato das RPCs — é onde adaptador e banco poderiam divergir em silêncio.
 * Aqui tudo roda como um GERENTE autenticado, como em produção.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import type { DailyItem } from '@/types/domain';
import {
  setAbsenceQuantity,
  setDayOffQuantity,
  setReasonObservation,
  setReasonQuantity,
} from '@/domain/conferenceFactory';
import {
  TEST_STORE,
  USERS,
  asSuperuser,
  asUser,
  connect,
  resetConferences,
  seedTestUsers,
  submitConference,
} from './dbHelpers';
import {
  POSITION_CAIXA,
  POSITION_PADARIA,
  REASON_ATESTADO,
  REASON_INJUSTIFICADA,
  REASON_OUTROS,
  makeDraft,
} from './fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const REFERENCE_DATE = '2026-09-05';

/**
 * Mesma transformação do SupabaseAdapter.toRpcItems.
 * Mantida em espelho de propósito: se o adaptador mudar e este teste não,
 * a divergência aparece aqui.
 */
function toRpcItems(items: DailyItem[]) {
  return items.map((item) => ({
    position_id: item.positionId,
    absence_quantity: item.absenceQuantity,
    day_off_quantity: item.dayOffQuantity,
    observation: item.observation,
    reasons: item.reasons
      .filter((reason) => reason.quantity > 0)
      .map((reason) => ({
        reason_id: reason.reasonId,
        quantity: reason.quantity,
        observation: reason.observation,
      })),
  }));
}

const suite = DATABASE_URL ? describe : describe.skip;

suite('Integração com PostgreSQL real — regras da conferência', () => {
  let db: Client;

  async function saveDraft(conference: ReturnType<typeof makeDraft>): Promise<string> {
    const { rows } = await db.query(
      'select public.quadro_rpc_save_daily_conference_draft($1, $2::date, $3::jsonb) as id',
      [conference.storeId, conference.referenceDate, JSON.stringify(toRpcItems(conference.items))],
    );
    return rows[0].id as string;
  }

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
    // Todos os testes abaixo rodam como o gerente da loja 124.
    await asUser(db, USERS.manager.id);
  });

  it('1. salvar rascunho grava conferência, itens e motivos', async () => {
    let conference = makeDraft(REFERENCE_DATE);
    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);
    conference = setDayOffQuantity(conference, POSITION_CAIXA, 6);

    const id = await saveDraft(conference);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const { rows } = await db.query(
      `select di.position_id, di.absence_quantity, di.day_off_quantity,
              coalesce(sum(dir.quantity), 0)::int as motivos
         from public.quadro_daily_items di
         left join public.quadro_daily_item_reasons dir on dir.daily_item_id = di.id
        where di.conference_id = $1
        group by di.position_id, di.absence_quantity, di.day_off_quantity
        order by di.position_id`,
      [id],
    );

    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.position_id === POSITION_PADARIA)).toMatchObject({
      absence_quantity: 1,
      motivos: 1,
    });
    expect(rows.find((row) => row.position_id === POSITION_CAIXA)).toMatchObject({
      absence_quantity: 0,
      day_off_quantity: 6,
    });
  });

  it('2. DRAFT pode ser alterado e reaproveita a mesma linha', async () => {
    let conference = makeDraft(REFERENCE_DATE);
    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);
    const first = await saveDraft(conference);

    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 3);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 3);
    const second = await saveDraft(conference);

    expect(second).toBe(first);
    const { rows } = await db.query(
      'select count(*)::int as total from public.quadro_daily_conferences where store_id = $1',
      [TEST_STORE],
    );
    expect(rows[0].total).toBe(1);
  });

  it('3. reeditar o rascunho não deixa motivo órfão', async () => {
    let conference = makeDraft(REFERENCE_DATE);
    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 2);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_INJUSTIFICADA, 1);
    const id = await saveDraft(conference);

    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 0);
    await saveDraft(conference);

    const { rows } = await db.query(
      `select count(*)::int as total
         from public.quadro_daily_item_reasons dir
         join public.quadro_daily_items di on di.id = dir.daily_item_id
        where di.conference_id = $1`,
      [id],
    );
    expect(rows[0].total).toBe(0);
  });

  it('4. envio válido passa para SUBMITTED com submitted_at', async () => {
    let conference = makeDraft(REFERENCE_DATE);
    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);
    conference = setDayOffQuantity(conference, POSITION_CAIXA, 2);

    const id = await saveDraft(conference);
    const result = await submitConference(db, id);

    expect(result.status).toBe('SUBMITTED');
    expect(result.submitted_at).not.toBeNull();
    expect(result.submitted_by).toBe(USERS.manager.id);
  });

  it('5. envio com falta sem motivo falha e não deixa estado parcial', async () => {
    let conference = makeDraft(REFERENCE_DATE);
    conference = setAbsenceQuantity(conference, POSITION_CAIXA, 3);
    const id = await saveDraft(conference);

    await expect(submitConference(db, id)).rejects.toThrow(/informe o motivo/i);

    const { rows } = await db.query(
      'select status, submitted_at from public.quadro_daily_conferences where id = $1',
      [id],
    );
    expect(rows[0].status).toBe('DRAFT');
    expect(rows[0].submitted_at).toBeNull();
  });

  it('6. soma dos motivos diferente das faltas falha', async () => {
    let conference = makeDraft(REFERENCE_DATE);
    conference = setAbsenceQuantity(conference, POSITION_CAIXA, 3);
    conference = setReasonQuantity(conference, POSITION_CAIXA, REASON_ATESTADO, 2);
    const id = await saveDraft(conference);

    await expect(submitConference(db, id)).rejects.toThrow(/2 de 3/);
  });

  it('7. motivo "Outros" sem observação falha; com observação passa', async () => {
    let conference = makeDraft(REFERENCE_DATE);
    conference = setAbsenceQuantity(conference, POSITION_CAIXA, 1);
    conference = setReasonQuantity(conference, POSITION_CAIXA, REASON_OUTROS, 1);
    let id = await saveDraft(conference);

    await expect(submitConference(db, id)).rejects.toThrow(/exige observa/i);

    conference = setReasonObservation(conference, POSITION_CAIXA, REASON_OUTROS, 'Convocação judicial');
    id = await saveDraft(conference);
    const result = await submitConference(db, id);
    expect(result.status).toBe('SUBMITTED');
  });

  it('8. daily_items é imutável depois do envio (gatilho, não só RLS)', async () => {
    let conference = makeDraft(REFERENCE_DATE);
    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);
    const id = await saveDraft(conference);
    await submitConference(db, id);

    await asSuperuser(db);
    await expect(
      db.query('update public.quadro_daily_items set absence_quantity = 99 where conference_id = $1', [id]),
    ).rejects.toThrow(/bloqueada/i);
    await expect(
      db.query('delete from public.quadro_daily_items where conference_id = $1', [id]),
    ).rejects.toThrow(/bloqueada/i);
  });

  it('9. daily_item_reasons é imutável depois do envio', async () => {
    let conference = makeDraft(REFERENCE_DATE);
    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);
    const id = await saveDraft(conference);
    await submitConference(db, id);

    await asSuperuser(db);
    await expect(
      db.query(
        `update public.quadro_daily_item_reasons set quantity = 99
          where daily_item_id in (select id from public.quadro_daily_items where conference_id = $1)`,
        [id],
      ),
    ).rejects.toThrow(/bloquead/i);
  });

  it('10. reenviar conferência já enviada falha', async () => {
    let conference = makeDraft(REFERENCE_DATE);
    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);
    const id = await saveDraft(conference);
    await submitConference(db, id);

    await expect(submitConference(db, id)).rejects.toThrow(/já enviada/i);
    await expect(saveDraft(conference)).rejects.toThrow(/já enviada|bloqueada/i);
  });

  it('11. não existem duas conferências da mesma loja/data', async () => {
    const conference = makeDraft(REFERENCE_DATE);
    await saveDraft(conference);
    await saveDraft({ ...conference, id: 'outro' });

    const { rows } = await db.query(
      'select count(*)::int as total from public.quadro_daily_conferences where store_id = $1 and reference_date = $2::date',
      [TEST_STORE, REFERENCE_DATE],
    );
    expect(rows[0].total).toBe(1);
  });

  it('12. cliente não consegue forjar status nem submitted_at', async () => {
    let conference = makeDraft(REFERENCE_DATE);
    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);
    const id = await saveDraft(conference);

    await expect(
      db.query(
        "update public.quadro_daily_conferences set status = 'SUBMITTED', submitted_at = now() where id = $1",
        [id],
      ),
    ).rejects.toThrow(/RPC|check constraint/i);

    await submitConference(db, id);

    // Como gerente, a política de UPDATE já não alcança a linha enviada.
    const update = await db.query(
      "update public.quadro_daily_conferences set status = 'DRAFT' where id = $1",
      [id],
    );
    expect(update.rowCount).toBe(0);

    // Mesmo ignorando RLS, o gatilho barra.
    await asSuperuser(db);
    await expect(
      db.query("update public.quadro_daily_conferences set status = 'DRAFT', submitted_at = null, submitted_by = null where id = $1", [id]),
    ).rejects.toThrow(/bloqueada/i);
  });

  it('13. envio sem itens persistidos falha', async () => {
    const conference = { ...makeDraft(REFERENCE_DATE), items: [] };
    const id = await saveDraft(conference);
    await expect(submitConference(db, id)).rejects.toThrow(/sem itens/i);
  });

  it('14. quantidade negativa é barrada pelo CHECK', async () => {
    const conference = makeDraft(REFERENCE_DATE);
    const id = await saveDraft(conference);

    await asSuperuser(db);
    await expect(
      db.query(
        'insert into public.quadro_daily_items (conference_id, position_id, absence_quantity) values ($1, $2, -1)',
        [id, 'pos-padeiro'],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('15. RLS continua ligada em todas as tabelas e sem política aberta', async () => {
    await asSuperuser(db);
    const semRls = await db.query(
      `select tablename from pg_tables
        where schemaname = 'public' and tablename ~ '^quadro_'
          and not rowsecurity`,
    );
    expect(semRls.rows.map((row) => row.tablename)).toEqual([]);

    const abertas = await db.query(
      `select policyname from pg_policies
        where schemaname = 'public' and tablename ~ '^quadro_'
          and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')`,
    );
    expect(abertas.rows.map((row) => row.policyname)).toEqual([]);
  });
});
