/**
 * RLS e identidade — testes de INTEGRAÇÃO contra PostgreSQL real.
 *
 * Rodam apenas com DATABASE_URL definida; sem ela a suíte é PULADA.
 *
 *   DATABASE_URL=postgres://usuario:senha@localhost:5432/hiperideal npm test
 *
 * O banco precisa ter, nesta ordem:
 *   supabase/local/00_auth_shim.sql   (só em PostgreSQL local)
 *   supabase/schema.sql
 *   supabase/seed.sql
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  OTHER_STORE,
  TEST_STORE,
  USERS,
  asAnon,
  daysAgo,
  asSuperuser,
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
 * Data relativa, nunca fixa: desde a fase 4.5 a RPC de envio recusa hoje e o
 * futuro, e uma data fixa quebraria a suíte no dia em que ela virasse "hoje".
 */
const DATE = daysAgo(2);
const PADARIA = 'pos-atendente-alimentos-padaria';
const CAIXA = 'pos-operador-de-caixa';
const ATESTADO = 'reason-atestado-medico';
const INJUSTIFICADA = 'reason-falta-injustificada';

const suite = DATABASE_URL ? describe : describe.skip;

suite('RLS, perfis e identidade', () => {
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
  });

  // -------------------------------------------------------------------------
  describe('1. Usuário não autenticado', () => {
    it('não lê nenhuma tabela protegida', async () => {
      await asAnon(db);

      for (const table of [
        'quadro_stores',
        'quadro_positions',
        'quadro_daily_conferences',
        'quadro_daily_items',
        'quadro_profiles',
        'quadro_audit_logs',
      ]) {
        await expect(db.query(`select * from public.${table}`)).rejects.toThrow(
          /permission denied/i,
        );
      }
    });

    it('não chama as RPCs', async () => {
      await asAnon(db);
      await expect(
        db.query('select public.quadro_rpc_save_daily_conference_draft($1, $2::date, $3::jsonb)', [
          TEST_STORE,
          DATE,
          '[]',
        ]),
      ).rejects.toThrow(/permission denied/i);
    });

    it('usuário autenticado SEM perfil não enxerga nada', async () => {
      await asUser(db, USERS.orphan.id);

      const stores = await db.query('select * from public.quadro_stores');
      expect(stores.rows).toHaveLength(0);

      const reasons = await db.query('select * from public.quadro_absence_reasons');
      expect(reasons.rows).toHaveLength(0);

      await expect(
        saveDraft(db, TEST_STORE, DATE, rpcItems([{ positionId: PADARIA }])),
      ).rejects.toThrow(/Sem permissão/i);
    });
  });

  // -------------------------------------------------------------------------
  describe('2 e 3. Gerente e isolamento entre lojas', () => {
    it('lê a própria loja e NÃO enxerga a outra', async () => {
      await asUser(db, USERS.manager.id);

      const { rows } = await db.query('select id from public.quadro_stores order by id');
      expect(rows.map((row) => row.id)).toEqual([TEST_STORE]);
      expect(rows.map((row) => row.id)).not.toContain(OTHER_STORE);
    });

    it('lê as 25 funções do quadro da própria loja', async () => {
      await asUser(db, USERS.manager.id);
      const { rows } = await db.query('select count(*)::int as total from public.quadro_positions');
      expect(rows[0].total).toBe(25);
    });

    it('não lê conferência de outra loja', async () => {
      await asUser(db, USERS.otherManager.id);
      await saveDraft(db, OTHER_STORE, DATE, rpcItems([{ positionId: CAIXA, dayOff: 2 }]));

      await asUser(db, USERS.manager.id);
      const { rows } = await db.query(
        'select id from public.quadro_daily_conferences where store_id = $1',
        [OTHER_STORE],
      );
      expect(rows).toHaveLength(0);
    });

    it('não lê os ITENS de conferência de outra loja', async () => {
      await asUser(db, USERS.otherManager.id);
      const id = await saveDraft(
        db,
        OTHER_STORE,
        DATE,
        rpcItems([{ positionId: CAIXA, dayOff: 2 }]),
      );

      await asUser(db, USERS.manager.id);
      const items = await db.query(
        'select * from public.quadro_daily_items where conference_id = $1',
        [id],
      );
      expect(items.rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('4 e 5. Gerente não escreve em outra loja', () => {
    it('não salva rascunho de outra loja', async () => {
      await asUser(db, USERS.manager.id);
      await expect(
        saveDraft(db, OTHER_STORE, DATE, rpcItems([{ positionId: CAIXA, dayOff: 1 }])),
      ).rejects.toThrow(/Sem permissão para lançar conferência/i);
    });

    it('não envia conferência de outra loja', async () => {
      await asUser(db, USERS.otherManager.id);
      const id = await saveDraft(
        db,
        OTHER_STORE,
        DATE,
        rpcItems([{ positionId: CAIXA, dayOff: 1 }]),
      );

      await asUser(db, USERS.manager.id);
      await expect(submitConference(db, id)).rejects.toThrow(
        /não encontrada|Sem permissão para enviar/i,
      );
    });

    it('não insere linha em daily_conferences direto, fora da RPC', async () => {
      await asUser(db, USERS.manager.id);
      await expect(
        db.query(
          `insert into public.quadro_daily_conferences (store_id, reference_date, status, created_by)
           values ($1, $2::date, 'DRAFT', $3)`,
          [OTHER_STORE, DATE, USERS.manager.id],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  // -------------------------------------------------------------------------
  describe('6. Supervisor', () => {
    it('lê as duas lojas e as conferências de ambas', async () => {
      await asUser(db, USERS.manager.id);
      await saveDraft(db, TEST_STORE, DATE, rpcItems([{ positionId: PADARIA, dayOff: 1 }]));
      await asUser(db, USERS.otherManager.id);
      await saveDraft(db, OTHER_STORE, DATE, rpcItems([{ positionId: CAIXA, dayOff: 2 }]));

      // O supervisor de escopo ALL enxerga TODAS as lojas ativas. A contagem
      // vem do banco: desde a fase 4 a rede tem 34 lojas, e fixar "2" aqui
      // faria o teste falhar toda vez que a rede crescesse.
      await asSuperuser(db);
      const ativas = await db.query(
        'select id from public.quadro_stores where active order by id',
      );

      await asUser(db, USERS.supervisor.id);
      const stores = await db.query(
        'select id from public.quadro_stores where active order by id',
      );
      expect(stores.rows.map((row) => row.id)).toEqual(ativas.rows.map((row) => row.id));
      // E as duas lojas deste teste estão entre elas.
      expect(stores.rows.map((row) => row.id)).toEqual(
        expect.arrayContaining([TEST_STORE, OTHER_STORE]),
      );

      const conferences = await db.query('select store_id from public.quadro_daily_conferences');
      expect(conferences.rows).toHaveLength(2);
    });

    it('NÃO escreve conferência (perfil elevado não dá escrita)', async () => {
      await asUser(db, USERS.supervisor.id);
      await expect(
        saveDraft(db, TEST_STORE, DATE, rpcItems([{ positionId: PADARIA, dayOff: 1 }])),
      ).rejects.toThrow(/Sem permissão para lançar conferência/i);
    });

    it('admin também lê a rede e também não escreve conferência', async () => {
      await asUser(db, USERS.admin.id);
      const stores = await db.query('select id from public.quadro_stores');
      expect(stores.rows.length).toBeGreaterThanOrEqual(2);

      await expect(
        saveDraft(db, TEST_STORE, DATE, rpcItems([{ positionId: PADARIA, dayOff: 1 }])),
      ).rejects.toThrow(/Sem permissão/i);
    });
  });

  // -------------------------------------------------------------------------
  describe('7 e 8. Gerente não altera os próprios privilégios', () => {
    it('não muda a própria role', async () => {
      await asUser(db, USERS.manager.id);
      await expect(
        db.query("update public.quadro_profiles set role = 'ADMIN' where id = $1", [USERS.manager.id]),
      ).rejects.toThrow(/Alteração de perfil \(role\) não permitida/i);
    });

    it('não muda o próprio store_id', async () => {
      await asUser(db, USERS.manager.id);
      await expect(
        db.query('update public.quadro_profiles set store_id = $1 where id = $2', [
          OTHER_STORE,
          USERS.manager.id,
        ]),
      ).rejects.toThrow(/Alteração de loja do usuário não permitida/i);
    });

    it('não altera o perfil de outra pessoa', async () => {
      await asUser(db, USERS.manager.id);
      const { rowCount } = await db.query(
        "update public.quadro_profiles set name = 'invadido' where id = $1",
        [USERS.supervisor.id],
      );
      expect(rowCount).toBe(0);
    });

    it('pode corrigir o próprio nome', async () => {
      await asUser(db, USERS.manager.id);
      const { rowCount } = await db.query(
        'update public.quadro_profiles set name = $1 where id = $2',
        ['Gerente 124', USERS.manager.id],
      );
      expect(rowCount).toBe(1);
    });

    it('não enxerga o perfil dos outros; supervisor enxerga', async () => {
      await asUser(db, USERS.manager.id);
      const asManager = await db.query('select id from public.quadro_profiles');
      expect(asManager.rows.map((row) => row.id)).toEqual([USERS.manager.id]);

      await asUser(db, USERS.supervisor.id);
      const asSupervisor = await db.query('select id from public.quadro_profiles');
      expect(asSupervisor.rows.length).toBeGreaterThanOrEqual(4);
    });
  });

  // -------------------------------------------------------------------------
  describe('9. created_by vem de auth.uid()', () => {
    it('grava o usuário autenticado, não um valor do payload', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(
        db,
        TEST_STORE,
        DATE,
        rpcItems([{ positionId: PADARIA, absence: 1, reasons: [{ reasonId: ATESTADO, quantity: 1 }] }]),
      );

      const { rows } = await db.query(
        'select created_by from public.quadro_daily_conferences where id = $1',
        [id],
      );
      expect(rows[0].created_by).toBe(USERS.manager.id);
    });

    it('submitted_by também vem do usuário autenticado', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(
        db,
        TEST_STORE,
        DATE,
        rpcItems([{ positionId: PADARIA, absence: 1, reasons: [{ reasonId: ATESTADO, quantity: 1 }] }]),
      );
      const result = await submitConference(db, id);

      expect(result.submitted_by).toBe(USERS.manager.id);
      expect(result.created_by).toBe(USERS.manager.id);
    });

    it('não é possível forjar created_by de outro usuário', async () => {
      await asUser(db, USERS.manager.id);
      await expect(
        db.query(
          `insert into public.quadro_daily_conferences (store_id, reference_date, status, created_by)
           values ($1, $2::date, 'DRAFT', $3)`,
          [TEST_STORE, DATE, USERS.supervisor.id],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  // -------------------------------------------------------------------------
  describe('10 e 11. Auditoria', () => {
    it('registra DRAFT_SAVED e SUBMITTED com o usuário real', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(
        db,
        TEST_STORE,
        DATE,
        rpcItems([
          { positionId: PADARIA, absence: 1, reasons: [{ reasonId: ATESTADO, quantity: 1 }] },
          { positionId: CAIXA, dayOff: 2 },
        ]),
      );
      await submitConference(db, id);

      await asUser(db, USERS.supervisor.id);
      const { rows } = await db.query(
        `select action, user_id, store_id, metadata
           from public.quadro_audit_logs
          where entity_id = $1
          order by created_at`,
        [id],
      );

      const actions = rows.map((row) => row.action);
      expect(actions).toContain('CONFERENCE_DRAFT_SAVED');
      expect(actions).toContain('CONFERENCE_SUBMITTED');
      expect(rows.every((row) => row.user_id === USERS.manager.id)).toBe(true);
      expect(rows.every((row) => row.store_id === TEST_STORE)).toBe(true);

      const submitted = rows.find((row) => row.action === 'CONFERENCE_SUBMITTED');
      expect(submitted.metadata).toMatchObject({
        total_absences: 1,
        total_day_offs: 2,
        impacted_positions: 2,
      });
    });

    it('não aceita log em nome de outro usuário', async () => {
      await asUser(db, USERS.manager.id);
      await expect(
        db.query(
          `insert into public.quadro_audit_logs (user_id, action, entity, entity_id)
           values ($1, 'FORJADO', 'quadro_daily_conferences', 'x')`,
          [USERS.supervisor.id],
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('não aceita UPDATE nem DELETE, nem do superusuário', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(
        db,
        TEST_STORE,
        DATE,
        rpcItems([{ positionId: PADARIA, absence: 1, reasons: [{ reasonId: ATESTADO, quantity: 1 }] }]),
      );

      await expect(
        db.query("update public.quadro_audit_logs set action = 'ALTERADO' where entity_id = $1", [id]),
      ).rejects.toThrow(/append-only|permission denied/i);

      // Superusuário ignora RLS, mas NÃO ignora gatilho.
      await asSuperuser(db);
      await expect(
        db.query('delete from public.quadro_audit_logs where entity_id = $1', [id]),
      ).rejects.toThrow(/append-only/i);
    });

    it('gerente não lê a auditoria global', async () => {
      await asUser(db, USERS.manager.id);
      await saveDraft(db, TEST_STORE, DATE, rpcItems([{ positionId: PADARIA, dayOff: 1 }]));

      const { rows } = await db.query('select * from public.quadro_audit_logs');
      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('12 e 13. Imutabilidade continua valendo com RLS ligada', () => {
    it('SUBMITTED continua imutável para o gerente', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(
        db,
        TEST_STORE,
        DATE,
        rpcItems([{ positionId: PADARIA, absence: 1, reasons: [{ reasonId: ATESTADO, quantity: 1 }] }]),
      );
      await submitConference(db, id);

      // A política de UPDATE já filtra a linha enviada: 0 linhas afetadas.
      const update = await db.query(
        'update public.quadro_daily_items set absence_quantity = 99 where conference_id = $1',
        [id],
      );
      expect(update.rowCount).toBe(0);

      await expect(submitConference(db, id)).rejects.toThrow(/já enviada/i);
      await expect(
        saveDraft(db, TEST_STORE, DATE, rpcItems([{ positionId: PADARIA }])),
      ).rejects.toThrow(/já enviada/i);
    });

    it('motivos de conferência enviada continuam imutáveis', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(
        db,
        TEST_STORE,
        DATE,
        rpcItems([{ positionId: PADARIA, absence: 1, reasons: [{ reasonId: ATESTADO, quantity: 1 }] }]),
      );
      await submitConference(db, id);

      const update = await db.query(
        `update public.quadro_daily_item_reasons set quantity = 99
          where daily_item_id in (select id from public.quadro_daily_items where conference_id = $1)`,
        [id],
      );
      expect(update.rowCount).toBe(0);

      // E o gatilho barra mesmo quem ignora RLS.
      await asSuperuser(db);
      await expect(
        db.query(
          `update public.quadro_daily_item_reasons set quantity = 99
            where daily_item_id in (select id from public.quadro_daily_items where conference_id = $1)`,
          [id],
        ),
      ).rejects.toThrow(/bloquead/i);
    });
  });

  // -------------------------------------------------------------------------
  describe('14. Views analíticas não duplicam faltas', () => {
    it('3 faltas em 2 motivos continuam somando 3, não 6', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(
        db,
        TEST_STORE,
        DATE,
        rpcItems([
          {
            positionId: CAIXA,
            absence: 3,
            dayOff: 1,
            reasons: [
              { reasonId: ATESTADO, quantity: 2 },
              { reasonId: INJUSTIFICADA, quantity: 1 },
            ],
          },
        ]),
      );
      await submitConference(db, id);

      const porFuncao = await db.query(
        `select sum(absence_quantity)::int as faltas, sum(day_off_quantity)::int as folgas
           from public.quadro_v_conference_items where conference_id = $1`,
        [id],
      );
      expect(porFuncao.rows[0].faltas).toBe(3);
      expect(porFuncao.rows[0].folgas).toBe(1);

      const porMotivo = await db.query(
        `select count(*)::int as linhas, sum(reason_quantity)::int as motivos
           from public.quadro_v_conference_item_reasons where conference_id = $1`,
        [id],
      );
      // 2 linhas de motivo para a MESMA função — é exatamente o caso que
      // duplicaria o total na view antiga.
      expect(porMotivo.rows[0].linhas).toBe(2);
      expect(porMotivo.rows[0].motivos).toBe(3);

      // A soma dos motivos bate com a soma das faltas.
      expect(porMotivo.rows[0].motivos).toBe(porFuncao.rows[0].faltas);
    });

    it('a view antiga (que duplicava faltas) não existe no namespace quadro_', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        `select viewname from pg_views
          where schemaname = 'public' and viewname = 'quadro_v_daily_occurrences'`,
      );
      expect(rows).toHaveLength(0);

      // Uma view homônima SEM prefixo pode existir e pertencer a outro
      // sistema (Organico) — não é nossa e não pode ser removida por nós.
    });

    it('as views deste sistema usam o prefixo quadro_', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        `select viewname from pg_views
          where schemaname = 'public'
            and viewname in ('quadro_v_conference_items', 'quadro_v_conference_item_reasons')`,
      );
      expect(rows.map((r) => r.viewname).sort()).toEqual([
        'quadro_v_conference_item_reasons',
        'quadro_v_conference_items',
      ]);
    });

    it('as views respeitam a RLS (security_invoker)', async () => {
      await asUser(db, USERS.otherManager.id);
      await saveDraft(db, OTHER_STORE, DATE, rpcItems([{ positionId: CAIXA, dayOff: 5 }]));

      await asUser(db, USERS.manager.id);
      const { rows } = await db.query(
        'select count(*)::int as total from public.quadro_v_conference_items where store_id = $1',
        [OTHER_STORE],
      );
      expect(rows[0].total).toBe(0);

      await asSuperuser(db);
      const invoker = await db.query(
        `select c.relname, c.reloptions
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'v'
            and c.relname ~ '^quadro_'`,
      );
      for (const view of invoker.rows) {
        expect((view.reloptions ?? []).join(',')).toContain('security_invoker=true');
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('15. Funções e setores continuam separados', () => {
    it('REPOSITOR permanece em 4 registros distintos por setor', async () => {
      await asUser(db, USERS.manager.id);
      const { rows } = await db.query(
        `select name, sector from public.quadro_positions
          where function_group = 'REPOSITOR' order by sector`,
      );
      expect(rows.map((row) => row.sector)).toEqual(['BAZAR', 'FRIOS', 'HORTI', 'MERCEARIA']);
      expect(new Set(rows.map((row) => row.name)).size).toBe(4);
    });

    it('ATENDENTE ALIMENTOS e AUX. DE COZINHA seguem separados', async () => {
      await asUser(db, USERS.manager.id);
      const atendentes = await db.query(
        "select sector from public.quadro_positions where function_group = 'ATENDENTE ALIMENTOS' order by sector",
      );
      expect(atendentes.rows.map((row) => row.sector)).toEqual([
        'FATIADOS',
        'FRUTAS',
        'PADARIA',
      ]);

      const cozinha = await db.query(
        "select sector from public.quadro_positions where function_group = 'AUX. DE COZINHA' order by sector",
      );
      expect(cozinha.rows.map((row) => row.sector)).toEqual(['GALETERIA', 'REFEITÓRIO']);
    });
  });

  // -------------------------------------------------------------------------
  describe('Auditoria das funções SECURITY DEFINER', () => {
    it('todas têm search_path fixo e não são executáveis por anon', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        `select p.proname,
                p.proconfig,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon_pode
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef
            and p.proname ~ '^quadro_'
          order by p.proname`,
      );

      expect(rows.length).toBeGreaterThan(0);
      for (const fn of rows) {
        expect(
          (fn.proconfig ?? []).some((cfg: string) => cfg.startsWith('search_path=')),
          `${fn.proname} sem search_path fixo`,
        ).toBe(true);
        expect(fn.anon_pode, `${fn.proname} executável por anon`).toBe(false);
      }
    });

    it('as RPCs NÃO são security definer (continuam sujeitas à RLS)', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        `select proname, prosecdef from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname ~ '^quadro_rpc_'`,
      );
      // A lista é fechada: cada RPC nova obriga a decidir conscientemente se
      // ela pode rodar com os privilégios de quem chama. A da fase 4.5 pode —
      // ela abre a porta estreita de `quadro.reason_resolution` só DEPOIS de
      // conferir permissão, e continua sujeita às políticas.
      expect(rows.map((row) => row.proname as string).sort()).toEqual([
        'quadro_rpc_resolve_pending_absence_reason',
        'quadro_rpc_save_daily_conference_draft',
        'quadro_rpc_submit_daily_conference',
      ]);
      expect(rows.every((row) => row.prosecdef === false)).toBe(true);
    });
  });
});
