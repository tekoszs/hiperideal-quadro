/**
 * FASE 4 — HIERARQUIA DE ACESSO, contra PostgreSQL REAL.
 *
 * Rodam apenas com DATABASE_URL definida; sem ela a suíte é PULADA.
 *
 *   DATABASE_URL=postgres://usuario:senha@localhost:5432/hiperideal npm test
 *
 * O banco precisa ter, nesta ordem:
 *   supabase/local/00_auth_shim.sql   (só em PostgreSQL local)
 *   supabase/schema.sql               (ou as migrations 0001..0016)
 *   supabase/seed.sql
 *
 * POR QUE ESTES TESTES EXISTEM
 * ----------------------------
 * O frontend tem filtros de distrito e de loja. Filtro de tela é conforto: ele
 * some se alguém abrir o DevTools. A pergunta que importa é outra — "o BANCO
 * entrega alguma linha a mais quando o navegador mente?" — e ela só pode ser
 * respondida aqui, com a RLS de verdade rodando.
 *
 * Por isso a segunda metade do arquivo são ATAQUES: Paulo tentando virar ALL,
 * trocar o próprio distrito, escrever conferência de loja alheia, apagar
 * conferência enviada. Todos precisam falhar NO BANCO.
 *
 * NENHUMA SENHA aparece aqui. Os usuários de teste existem apenas dentro do
 * banco de teste; os usuários reais nascem no painel do Supabase Auth com
 * senhas que o proprietário define.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  SCOPE_USERS,
  TEST_STORE,
  USERS,
  asAnon,
  asSuperuser,
  asUser,
  connect,
  countStoresOfDistrict,
  seedScopeUsers,
  seedTestUsers,
} from './dbHelpers';

const DATABASE_URL = process.env.DATABASE_URL;
const DATE = '2026-09-05';

/** Lojas conhecidas da rede oficial, usadas como sondas dos dois distritos. */
const LEPARC = 'store-307'; // Distrito 1
const PANAMBY = 'store-311'; // Distrito 2

const suite = DATABASE_URL ? describe : describe.skip;

suite('Escopo de acesso — RLS por distrito', () => {
  let db: Client;

  /** Contagens LIDAS do banco. Nada de 34, 20 ou 14 escritos no teste. */
  let totalAtivas = 0;
  let noDistrito1 = 0;
  let noDistrito2 = 0;

  beforeAll(async () => {
    db = await connect(DATABASE_URL as string);
    await seedTestUsers(db);
    await seedScopeUsers(db);

    await asSuperuser(db);
    const { rows } = await db.query(
      'select count(*)::int as total from public.quadro_stores where active',
    );
    totalAtivas = rows[0].total;
    noDistrito1 = await countStoresOfDistrict(db, 'district-1');
    noDistrito2 = await countStoresOfDistrict(db, 'district-2');
  });

  afterAll(async () => {
    if (db) {
      await asSuperuser(db);
      await db.end();
    }
  });

  /** Lojas que o usuário consegue LER — é o que a tela receberia. */
  async function lojasVisiveis(userId: string): Promise<string[]> {
    await asUser(db, userId);
    const { rows } = await db.query(
      'select id from public.quadro_stores where active order by code',
    );
    return rows.map((row) => row.id as string);
  }

  /**
   * Linhas lidas por uma consulta, ou `'RECUSADO'` quando o banco nem deixa
   * consultar.
   *
   * As duas respostas são aceitáveis e a diferença é de CAMADA: a RLS devolve
   * zero linhas, o GRANT recusa a tabela inteira. O GRANT é a recusa mais
   * forte — quem não tem permissão nem chega na política.
   */
  async function lerOuRecusar(sql: string, params: unknown[] = []): Promise<number | 'RECUSADO'> {
    try {
      const { rows } = await db.query(sql, params);
      return rows.length;
    } catch (cause) {
      const mensagem = cause instanceof Error ? cause.message : String(cause);
      if (/permission denied/i.test(mensagem)) return 'RECUSADO';
      throw cause;
    }
  }

  /** Executa e devolve a mensagem de erro, ou null se passou. */
  async function erroAoRodar(sql: string, params: unknown[] = []): Promise<string | null> {
    try {
      await db.query(sql, params);
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  }

  /* =======================================================================
   * O QUE CADA PERFIL ENXERGA
   * ==================================================================== */

  describe('Alcance de leitura', () => {
    // TESTE 1
    it('1. o gerente distrital do Distrito 1 vê exatamente as lojas do distrito dele', async () => {
      const lojas = await lojasVisiveis(SCOPE_USERS.paulo.id);
      expect(lojas).toHaveLength(noDistrito1);
    });

    // TESTE 2
    it('2. o gerente distrital do Distrito 2 vê exatamente as lojas do distrito dele', async () => {
      const lojas = await lojasVisiveis(SCOPE_USERS.ericson.id);
      expect(lojas).toHaveLength(noDistrito2);
    });

    // TESTE 3
    it('3. o gerente geral (escopo ALL) vê todas as lojas ativas', async () => {
      const lojas = await lojasVisiveis(SCOPE_USERS.roberval.id);
      expect(lojas).toHaveLength(totalAtivas);
    });

    // TESTE 4
    it('4. o administrador vê todas as lojas ativas', async () => {
      const lojas = await lojasVisiveis(SCOPE_USERS.jackson.id);
      expect(lojas).toHaveLength(totalAtivas);
    });

    // TESTE 5 — a regra do gerente de loja não mudou na fase 4.
    it('5. o gerente de loja continua vendo só a própria loja', async () => {
      const lojas = await lojasVisiveis(USERS.manager.id);
      expect(lojas).toEqual([TEST_STORE]);
    });

    // TESTE 6
    it('6. o Distrito 1 NÃO enxerga uma loja do Distrito 2', async () => {
      await asUser(db, SCOPE_USERS.paulo.id);
      const { rows } = await db.query('select id from public.quadro_stores where id = $1', [
        PANAMBY,
      ]);
      expect(rows).toHaveLength(0);
    });

    // TESTE 7
    it('7. o Distrito 2 NÃO enxerga uma loja do Distrito 1', async () => {
      await asUser(db, SCOPE_USERS.ericson.id);
      const { rows } = await db.query('select id from public.quadro_stores where id = $1', [
        LEPARC,
      ]);
      expect(rows).toHaveLength(0);
    });

    // TESTE 8 — a rede não tem buraco nem sobreposição.
    it('8. os dois distritos são disjuntos e, somados, dão a rede', async () => {
      const d1 = new Set(await lojasVisiveis(SCOPE_USERS.paulo.id));
      const d2 = await lojasVisiveis(SCOPE_USERS.ericson.id);

      expect(d2.some((id) => d1.has(id))).toBe(false);
      expect(d1.size + d2.length).toBe(noDistrito1 + noDistrito2);
    });

    // TESTE 9 — a função de escopo é a fonte única, e responde igual.
    it('9. `quadro_can_access_store` concorda com o que a RLS entrega', async () => {
      await asUser(db, SCOPE_USERS.paulo.id);
      const { rows } = await db.query(
        'select public.quadro_can_access_store($1) as dentro, public.quadro_can_access_store($2) as fora',
        [LEPARC, PANAMBY],
      );
      expect(rows[0].dentro).toBe(true);
      expect(rows[0].fora).toBe(false);
    });

    // TESTE 10 — perfis também respeitam o escopo.
    it('10. o gerente distrital não lê perfis de fora do distrito dele', async () => {
      await asUser(db, SCOPE_USERS.paulo.id);
      const { rows } = await db.query(
        'select id from public.quadro_profiles where id = $1',
        [SCOPE_USERS.ericson.id],
      );
      expect(rows).toHaveLength(0);

      // O próprio perfil ele lê — é como a tela sabe quem ele é.
      const proprio = await db.query('select id from public.quadro_profiles where id = $1', [
        SCOPE_USERS.paulo.id,
      ]);
      expect(proprio.rows).toHaveLength(1);
    });

    // TESTE 11
    it('11. visitante sem token não lê lojas nem distritos', async () => {
      await asAnon(db);

      // O banco recusa na camada do GRANT, antes mesmo da RLS: `anon` não tem
      // permissão nas tabelas. Zero linhas também passaria — as duas respostas
      // significam "não vê nada" —, mas a recusa é a mais forte das duas.
      expect(await lerOuRecusar('select id from public.quadro_stores')).toBe('RECUSADO');
      expect(await lerOuRecusar('select id from public.quadro_districts')).toBe('RECUSADO');
    });

    // TESTE 12
    it('12. usuário autenticado sem perfil não enxerga nada', async () => {
      await asUser(db, USERS.orphan.id);
      const lojas = await db.query('select id from public.quadro_stores');
      expect(lojas.rows).toHaveLength(0);
    });
  });

  /* =======================================================================
   * ATAQUES — o frontend mentindo, o banco recusando.
   * ==================================================================== */

  describe('Ataques ao escopo', () => {
    // TESTE 13
    it('13. ATAQUE: trocar o próprio distrito é recusado pelo banco', async () => {
      await asUser(db, SCOPE_USERS.paulo.id);
      const erro = await erroAoRodar(
        `update public.quadro_profiles set district_id = 'district-2' where id = $1`,
        [SCOPE_USERS.paulo.id],
      );

      expect(erro).toMatch(/distrito/i);

      // E o distrito continua o mesmo depois da tentativa.
      await asSuperuser(db);
      const { rows } = await db.query(
        'select district_id from public.quadro_profiles where id = $1',
        [SCOPE_USERS.paulo.id],
      );
      expect(rows[0].district_id).toBe('district-1');
    });

    // TESTE 14 — a escalada mais óbvia: virar "vejo tudo".
    it('14. ATAQUE: promover o próprio escopo para ALL é recusado', async () => {
      await asUser(db, SCOPE_USERS.paulo.id);
      const erro = await erroAoRodar(
        `update public.quadro_profiles set access_scope = 'ALL' where id = $1`,
        [SCOPE_USERS.paulo.id],
      );

      expect(erro).toMatch(/escopo/i);

      await asSuperuser(db);
      const { rows } = await db.query(
        'select access_scope from public.quadro_profiles where id = $1',
        [SCOPE_USERS.paulo.id],
      );
      expect(rows[0].access_scope).toBe('DISTRICT');
    });

    // TESTE 15
    it('15. ATAQUE: trocar o próprio papel é recusado', async () => {
      await asUser(db, SCOPE_USERS.paulo.id);
      const erro = await erroAoRodar(
        `update public.quadro_profiles set role = 'ADMIN' where id = $1`,
        [SCOPE_USERS.paulo.id],
      );
      expect(erro).not.toBeNull();
    });

    // TESTE 16
    it('16. ATAQUE: apontar o próprio perfil para uma loja é recusado', async () => {
      await asUser(db, SCOPE_USERS.paulo.id);
      const erro = await erroAoRodar(
        `update public.quadro_profiles set store_id = $2 where id = $1`,
        [SCOPE_USERS.paulo.id, PANAMBY],
      );
      expect(erro).not.toBeNull();
    });

    // TESTE 17 — depois do escopo, a escrita.
    //
    // Ler o distrito inteiro não dá direito de escrever nele. Quem escreve
    // conferência é o gerente da loja, e só na dele.
    it('17. ATAQUE: o gerente distrital não escreve conferência de loja nenhuma', async () => {
      await asUser(db, SCOPE_USERS.paulo.id);

      const podeEscrever = await db.query(
        'select public.quadro_can_write_store($1) as pode',
        [LEPARC],
      );
      expect(podeEscrever.rows[0].pode).toBe(false);

      const erro = await erroAoRodar(
        `insert into public.quadro_daily_conferences (store_id, reference_date, status, created_by)
         values ($1, $2::date, 'DRAFT', $3)`,
        [LEPARC, DATE, SCOPE_USERS.paulo.id],
      );
      expect(erro).not.toBeNull();
    });

    // TESTE 18
    it('18. ATAQUE: o administrador também não escreve conferência direto', async () => {
      await asUser(db, SCOPE_USERS.jackson.id);

      const podeEscrever = await db.query(
        'select public.quadro_can_write_store($1) as pode',
        [LEPARC],
      );
      expect(podeEscrever.rows[0].pode).toBe(false);

      const erro = await erroAoRodar(
        `insert into public.quadro_daily_conferences (store_id, reference_date, status, created_by)
         values ($1, $2::date, 'DRAFT', $3)`,
        [LEPARC, DATE, SCOPE_USERS.jackson.id],
      );
      expect(erro).not.toBeNull();
    });

    // TESTE 19 — a regra da fase 1, ainda de pé depois de mexer na RLS.
    it('19. ATAQUE: ninguém altera nem apaga conferência ENVIADA', async () => {
      // A conferência nasce pelo caminho legítimo: o gerente da própria loja.
      await asSuperuser(db);
      await db.query("select set_config('quadro.status_change', 'on', false)");
      await db.query(
        'delete from public.quadro_daily_conferences where store_id = $1 and reference_date = $2::date',
        [TEST_STORE, DATE],
      );
      await db.query("select set_config('quadro.status_change', 'off', false)");

      await asUser(db, USERS.manager.id);
      const criada = await db.query(
        'select public.quadro_rpc_save_daily_conference_draft($1, $2::date, $3::jsonb) as id',
        [
          TEST_STORE,
          DATE,
          JSON.stringify([
            {
              position_id: 'pos-operador-de-caixa',
              absence_quantity: 1,
              day_off_quantity: 0,
              observation: null,
              reasons: [{ reason_id: 'reason-falta-injustificada', quantity: 1, observation: null }],
            },
          ]),
        ],
      );
      const conferenceId = criada.rows[0].id as string;
      await db.query('select * from public.quadro_rpc_submit_daily_conference($1::uuid)', [
        conferenceId,
      ]);

      // Agora as tentativas, uma por perfil.
      // Duas recusas possíveis, ambas válidas: o GRANT nega a tabela, ou a RLS
      // não casa nenhuma linha. O que NÃO pode acontecer é a linha mudar.
      for (const usuario of [
        USERS.manager.id,
        SCOPE_USERS.paulo.id,
        SCOPE_USERS.roberval.id,
        SCOPE_USERS.jackson.id,
      ]) {
        await asUser(db, usuario);

        expect(
          await lerOuRecusar(
            `update public.quadro_daily_conferences set status = 'DRAFT' where id = $1 returning id`,
            [conferenceId],
          ),
          `usuário ${usuario} conseguiu ALTERAR uma enviada`,
        ).not.toBe(1);

        expect(
          await lerOuRecusar(
            'delete from public.quadro_daily_conferences where id = $1 returning id',
            [conferenceId],
          ),
          `usuário ${usuario} conseguiu APAGAR uma enviada`,
        ).not.toBe(1);
      }

      // E ela continua exatamente como foi enviada.
      await asSuperuser(db);
      const { rows } = await db.query(
        'select status from public.quadro_daily_conferences where id = $1',
        [conferenceId],
      );
      expect(rows[0].status).toBe('SUBMITTED');
    });

    // TESTE 20 — perfil desligado perde o acesso na hora, sem depender da tela.
    it('20. perfil inativo deixa de enxergar a rede — e só o ADMIN desliga', async () => {
      // Quem desativa é o ADMIN, pelo caminho legítimo. O gatilho de
      // privilégios recusa a mesma linha vinda de qualquer outro: a checagem
      // vale inclusive fora do PostgREST.
      await asUser(db, SCOPE_USERS.paulo.id);
      const tentativaDoPaulo = await erroAoRodar(
        'update public.quadro_profiles set active = false where id = $1',
        [SCOPE_USERS.paulo.id],
      );
      // Aceita com ou sem acento: o que o teste afirma e que a recusa e a de
      // ativacao, nao outra qualquer.
      expect(tentativaDoPaulo).toMatch(/ativa[cç][aã]o|desativa[cç][aã]o/i);

      await asUser(db, SCOPE_USERS.jackson.id);
      await db.query('update public.quadro_profiles set active = false where id = $1', [
        SCOPE_USERS.roberval.id,
      ]);

      try {
        await asUser(db, SCOPE_USERS.roberval.id);
        const { rows } = await db.query('select id from public.quadro_stores');
        expect(rows).toHaveLength(0);
      } finally {
        await asUser(db, SCOPE_USERS.jackson.id);
        await db.query('update public.quadro_profiles set active = true where id = $1', [
          SCOPE_USERS.roberval.id,
        ]);
        await asSuperuser(db);
      }
    });
  });
});
