/**
 * FASE 4.5 — PRÉ-REGISTRO E JUSTIFICATIVA PENDENTE, contra PostgreSQL REAL.
 *
 * Rodam apenas com DATABASE_URL definida; sem ela a suíte é PULADA.
 *
 * POR QUE ESTES TESTES PRECISAM DE BANCO
 * --------------------------------------
 * Tudo o que esta fase promete é uma promessa de SERVIDOR:
 *
 *   • "hoje não pode ser enviado" — auditado nesta fase e encontrado APENAS no
 *     frontend. Uma chamada por curl com token de gerente enviava conferência
 *     de amanhã, e ela entrava nos números oficiais;
 *   • "resolver justificativa não reabre a conferência" — quem garante é o
 *     gatilho, e gatilho não existe em jsdom;
 *   • "duas resoluções simultâneas não consomem a mesma unidade" — quem
 *     garante é `select ... for update`, e concorrência não existe num
 *     navegador só;
 *   • "a autorização de motivo não autoriza mudar status" — separação de
 *     privilégios que só se prova mexendo nas GUCs de verdade.
 *
 * As datas são RELATIVAS à DATA OPERACIONAL, nunca fixas: uma data fixa
 * transformaria o teste numa bomba-relógio de calendário — passaria hoje e
 * falharia no dia em que ela virasse "hoje".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { REFERENCE_WINDOW_DAYS } from '@/domain/referenceWindow';
import {
  TEST_STORE,
  USERS,
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

const CAIXA = 'pos-operador-de-caixa';
const ATESTADO = 'reason-atestado-medico';
const INJUSTIFICADA = 'reason-falta-injustificada';
const OUTROS = 'reason-outros';
const AGUARDANDO = 'reason-aguardando-justificativa';

/**
 * Fusos escolhidos para atravessar a meia-noite nos DOIS sentidos: Kiritimati
 * (UTC+14) e Tokyo já estão no dia seguinte quando a Bahia ainda não virou;
 * Adak (UTC-10) fica para trás. Entre eles cabe qualquer aparelho ou cabeçalho.
 */
const FUSOS = ['UTC', 'Pacific/Kiritimati', 'America/Adak', 'Asia/Tokyo'];

const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Tira COMENTÁRIOS do SQL — de linha (`--`) e de bloco.
 *
 * Existe porque um teste que procura um comando proibido no texto cru reprova a
 * migration pelo comentário que EXPLICA por que aquele comando não está lá. O
 * que se verifica é o que o banco vai executar, não o que o autor escreveu para
 * o revisor ler.
 */
function semComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

suite('Pré-registro e justificativa pendente (PostgreSQL real)', () => {
  let db: Client;

  /**
   * As datas saem da DATA OPERACIONAL do banco, não de `current_date`.
   *
   * `current_date` segue o TimeZone da sessão — que é exatamente a brecha que
   * esta fase fechou. Um teste que se calibrasse por ele estaria medindo a
   * configuração da conexão, não a regra da operação.
   */
  let HOJE: string;
  let ONTEM: string;
  let ANTEONTEM: string;
  let AMANHA: string;

  beforeAll(async () => {
    db = await connect(DATABASE_URL as string);
    await seedTestUsers(db);
    await asSuperuser(db);
    const { rows } = await db.query(
      `select public.quadro_business_date()::text        as hoje,
              (public.quadro_business_date() - 1)::text  as ontem,
              (public.quadro_business_date() - 2)::text  as anteontem,
              (public.quadro_business_date() + 1)::text  as amanha`,
    );
    ({ hoje: HOJE, ontem: ONTEM, anteontem: ANTEONTEM, amanha: AMANHA } = rows[0]);
  });

  afterAll(async () => {
    if (db) {
      await asSuperuser(db);
      await db.end();
    }
  });

  beforeEach(async () => {
    await resetConferences(db);
    // Garante o gerente ativo — um teste de segurança o desativa de propósito.
    // Quem religa é o ADMIN, pelo caminho legítimo: o gatilho de privilégios
    // recusa `active` vindo de qualquer outro, inclusive do superusuário.
    await asUser(db, USERS.admin.id);
    await db.query('update public.quadro_profiles set active = true where id = $1', [
      USERS.manager.id,
    ]);
    await asSuperuser(db);
  });

  /** Uma função com N faltas, todas aguardando justificativa. */
  const aguardando = (quantidade: number, positionId = CAIXA) =>
    rpcItems([
      {
        positionId,
        absence: quantidade,
        reasons: [{ reasonId: AGUARDANDO, quantity: quantidade }],
      },
    ]);

  /** O id do item (função) de uma conferência. */
  async function itemId(conferenceId: string, positionId = CAIXA): Promise<string> {
    const { rows } = await db.query(
      'select id from public.quadro_daily_items where conference_id = $1 and position_id = $2',
      [conferenceId, positionId],
    );
    return rows[0].id as string;
  }

  /** Faltas, folgas e motivos de um item — o retrato que não pode mudar. */
  async function retrato(id: string) {
    const { rows } = await db.query(
      `select di.absence_quantity, di.day_off_quantity, di.position_id,
              dc.status::text as status, dc.store_id, dc.reference_date::text as reference_date,
              coalesce(
                jsonb_object_agg(dir.reason_id, dir.quantity)
                  filter (where dir.reason_id is not null),
                '{}'::jsonb
              ) as motivos
         from public.quadro_daily_items di
         join public.quadro_daily_conferences dc on dc.id = di.conference_id
         left join public.quadro_daily_item_reasons dir on dir.daily_item_id = di.id
        where di.id = $1
        group by di.id, dc.id`,
      [id],
    );
    return rows[0] as {
      absence_quantity: number;
      day_off_quantity: number;
      position_id: string;
      status: string;
      store_id: string;
      reference_date: string;
      motivos: Record<string, number>;
    };
  }

  const resolver = (
    client: Client,
    id: string,
    toReasonId: string,
    quantity: number,
    observation: string | null = null,
  ) =>
    client.query(
      'select public.quadro_rpc_resolve_pending_absence_reason($1::uuid, $2, $3, $4) as id',
      [id, toReasonId, quantity, observation],
    );

  /* =====================================================================
   * 31) A proteção de data, DENTRO da RPC
   * ================================================================== */

  describe('31. Data: a regra é do servidor, não da tela', () => {
    it('A. rascunho de ONTEM é permitido', async () => {
      await asUser(db, USERS.manager.id);
      await expect(saveDraft(db, TEST_STORE, ONTEM, aguardando(1))).resolves.toBeTruthy();
    });

    it('B. rascunho de HOJE é permitido — é o pré-registro', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(db, TEST_STORE, HOJE, aguardando(1));

      await asSuperuser(db);
      const { rows } = await db.query(
        'select status::text as status, reference_date::text as data from public.quadro_daily_conferences where id = $1',
        [id],
      );
      // Nenhum status novo no banco: pré-registro é DRAFT.
      expect(rows[0]).toEqual({ status: 'DRAFT', data: HOJE });
    });

    it('C. rascunho de AMANHÃ é recusado pela RPC', async () => {
      await asUser(db, USERS.manager.id);
      await expect(saveDraft(db, TEST_STORE, AMANHA, aguardando(1))).rejects.toThrow(
        /futuro/i,
      );

      await asSuperuser(db);
      const { rows } = await db.query(
        'select count(*)::int as total from public.quadro_daily_conferences where reference_date = $1::date',
        [AMANHA],
      );
      expect(rows[0].total).toBe(0);
    });

    it('D. envio de ONTEM é permitido', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(db, TEST_STORE, ONTEM, aguardando(1));
      const enviada = await submitConference(db, id);
      expect(enviada.status).toBe('SUBMITTED');
    });

    it('E. envio de HOJE é recusado — o dia ainda não terminou', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(db, TEST_STORE, HOJE, aguardando(1));

      await expect(submitConference(db, id)).rejects.toThrow(/ainda não terminou/i);

      await asSuperuser(db);
      const { rows } = await db.query(
        'select status::text as status from public.quadro_daily_conferences where id = $1',
        [id],
      );
      expect(rows[0].status).toBe('DRAFT');
    });

    /**
     * F+G) A chamada DIRETA à RPC, sem passar por tela nenhuma.
     *
     * É exatamente o que um `curl` com token de gerente faria — e era isso que
     * passava antes desta fase.
     */
    it('F+G. nem futuro nem hoje passam por chamada direta à RPC', async () => {
      await asUser(db, USERS.manager.id);

      // Futuro: barrado já na gravação, então nem existe conferência para enviar.
      await expect(
        db.query(
          'select public.quadro_rpc_save_daily_conference_draft($1, $2::date, $3::jsonb)',
          [TEST_STORE, AMANHA, JSON.stringify(aguardando(1))],
        ),
      ).rejects.toThrow(/futuro/i);

      // Hoje: grava, mas o envio direto é recusado.
      const hoje = await saveDraft(db, TEST_STORE, HOJE, aguardando(1));
      await expect(
        db.query('select public.quadro_rpc_submit_daily_conference($1::uuid)', [hoje]),
      ).rejects.toThrow(/ainda não terminou/i);
    });

    /* ===================================================================
     * O FUSO DA SESSÃO NÃO PODE MOVER A REGRA
     *
     * `current_date` segue o TimeZone da sessão, e o PostgREST deixa o cliente
     * escolher esse fuso pelo cabeçalho `Prefer: timezone=...`. Enquanto as
     * RPCs usavam `current_date`, quem chamava a API escolhia que dia era hoje
     * — e as duas regras desta fase caíam com um cabeçalho HTTP.
     *
     * Isto foi explorado de verdade antes da correção, com o gerente legítimo:
     * de Kiritimati (UTC+14) o rascunho de amanhã gravou e a conferência de
     * hoje foi ENVIADA. Estes testes são o que impede a volta.
     * ================================================================ */

    it.each(FUSOS)('a data operacional não se move em %s', async (fuso) => {
      await asSuperuser(db);
      await db.query(`set time zone '${fuso}'`);
      try {
        const { rows } = await db.query(
          'select public.quadro_business_date()::text as operacional',
        );
        expect(rows[0].operacional).toBe(HOJE);
      } finally {
        await db.query('reset time zone');
      }
    });

    it.each(FUSOS)('nem o fuso %s permite ENVIAR a conferência de hoje', async (fuso) => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(db, TEST_STORE, HOJE, aguardando(1));

      await db.query(`set time zone '${fuso}'`);
      try {
        await expect(submitConference(db, id)).rejects.toThrow(/ainda não terminou/i);
      } finally {
        await db.query('reset time zone');
      }

      await asSuperuser(db);
      const { rows } = await db.query(
        'select status::text as status from public.quadro_daily_conferences where id = $1',
        [id],
      );
      expect(rows[0].status).toBe('DRAFT');
    });

    it.each(FUSOS)('nem o fuso %s permite GRAVAR o dia seguinte', async (fuso) => {
      await asUser(db, USERS.manager.id);
      await db.query(`set time zone '${fuso}'`);
      try {
        await expect(saveDraft(db, TEST_STORE, AMANHA, aguardando(1))).rejects.toThrow(
          /futuro/i,
        );
      } finally {
        await db.query('reset time zone');
      }

      await asSuperuser(db);
      const { rows } = await db.query(
        'select count(*)::int as total from public.quadro_daily_conferences where reference_date = $1::date',
        [AMANHA],
      );
      expect(rows[0].total).toBe(0);
    });

    /**
     * O ATAQUE ORIGINAL, ponta a ponta.
     *
     * Em Kiritimati o `current_date` da sessão é o DIA SEGUINTE ao da Bahia —
     * é essa diferença que abria as duas portas. Aqui a diferença existe, está
     * medida, e mesmo assim nada passa.
     */
    it('de UTC+14 o current_date adianta um dia, e ainda assim nada passa', async () => {
      await asUser(db, USERS.manager.id);
      const preRegistro = await saveDraft(db, TEST_STORE, HOJE, aguardando(1));

      await db.query("set time zone 'Pacific/Kiritimati'");
      try {
        const { rows } = await db.query(
          `select current_date::text as sessao,
                  public.quadro_business_date()::text as operacional`,
        );
        // A brecha EXISTE — o que mudou é que a regra deixou de olhar para ela.
        expect(rows[0].sessao).not.toBe(rows[0].operacional);
        expect(rows[0].operacional).toBe(HOJE);

        await expect(submitConference(db, preRegistro)).rejects.toThrow(
          /ainda não terminou/i,
        );
        await expect(saveDraft(db, TEST_STORE, AMANHA, aguardando(1))).rejects.toThrow(
          /futuro/i,
        );
      } finally {
        await db.query('reset time zone');
      }
    });

    it('e ONTEM continua podendo ser enviado, em qualquer fuso', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(db, TEST_STORE, ONTEM, aguardando(1));

      await db.query("set time zone 'Pacific/Kiritimati'");
      try {
        await expect(submitConference(db, id)).resolves.toMatchObject({
          status: 'SUBMITTED',
        });
      } finally {
        await db.query('reset time zone');
      }
    });

    /**
     * A regra não pode nem MENCIONAR `current_date`: o guard tem de sair da
     * data operacional. Este teste lê o código das RPCs, sem os comentários.
     */
    it('as RPCs usam a data operacional e não current_date', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        `select proname,
                regexp_replace(prosrc, '--[^' || chr(10) || ']*', '', 'g') as codigo
           from pg_proc
          where proname in ('quadro_rpc_save_daily_conference_draft',
                            'quadro_rpc_submit_daily_conference')`,
      );

      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(String(row.codigo), row.proname).toContain('quadro_business_date');
        expect(String(row.codigo), row.proname).not.toContain('current_date');
      }
    });

    /**
     * O fuso GLOBAL do banco não foi tocado — ele é compartilhado com o
     * Organico, e mexer nele para resolver um problema nosso seria mudar o
     * comportamento de outro sistema.
     */
    it('a correção não mexeu no fuso do banco', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        'select current_setting($1) as fuso',
        ['TimeZone'],
      );
      // Seja qual for, a regra não depende dele — provado nos testes acima.
      expect(typeof rows[0].fuso).toBe('string');

      const migration = await import('node:fs').then((fs) =>
        fs.readFileSync('supabase/migrations/0018_pending_reason_resolution.sql', 'utf8'),
      );

      // O QUE SE MEDE É O CÓDIGO, NÃO A PROSA. A 0018 EXPLICA, num comentário,
      // que não faz `alter database ... set timezone` — e um teste ingênuo
      // reprovaria a migration justamente pela frase que promete o contrário do
      // que ele procura. Foi o mesmo tropeço que o self-check da própria
      // migration já tinha corrigido; aqui ele se repetiu, e a lição é a mesma:
      // um guard que lê comentário está medindo o que o autor DISSE, não o que
      // o banco vai EXECUTAR.
      const codigo = semComentarios(migration);
      expect(codigo).not.toMatch(/alter\s+database[^;]*timezone/i);
      expect(codigo).not.toMatch(/set\s+time\s+zone/i);
      expect(codigo).not.toMatch(/set\s+timezone\s*(=|to)/i);

      // E o comentário que enganou o teste ingênuo continua lá, de propósito:
      // quem for aplicar a migration precisa ler POR QUE o fuso global fica
      // como está.
      expect(migration).toMatch(/alter\s+database/i);
    });

    /**
     * A REGRA NÃO É DE CALENDÁRIO. Fim de semana, feriado e dia útil passam
     * pelo mesmo caminho: o que decide é a data operacional, e nada no SQL
     * menciona sábado ou domingo.
     */
    it('a regra é a data, não o dia da semana', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        `select proname, prosrc from pg_proc
          where proname in ('quadro_rpc_save_daily_conference_draft',
                            'quadro_rpc_submit_daily_conference')`,
      );

      expect(rows).toHaveLength(2);
      for (const row of rows) {
        // O CÓDIGO, sem os comentários: a prosa pode citar sábado ao explicar
        // por que ele NÃO é caso especial.
        const codigo = semComentarios(String(row.prosrc));

        // Os construtores reais de dia da semana no PostgreSQL. Procurar só
        // "dow" solto era frouxo demais — casava dentro de `window`, e foi o
        // que este teste acusou quando a janela ganhou `v_window_start`.
        expect(codigo, row.proname).not.toMatch(/\b(iso)?dow\b/i);
        expect(codigo, row.proname).not.toMatch(/extract\s*\(\s*(iso)?dow\b/i);
        expect(codigo, row.proname).not.toMatch(/date_part\s*\(\s*'(iso)?dow'/i);
        expect(codigo, row.proname).not.toMatch(/to_char\s*\([^)]*'(d|dy|day|id)'/i);
        expect(codigo, row.proname).not.toMatch(/\b(sábado|domingo|weekend|saturday|sunday)\b/i);
      }
    });
  });

  /* =====================================================================
   * 31b) O PISO DA JANELA — o outro lado da mesma dívida
   *
   * A data operacional fechou o teto (hoje e o futuro). O piso estava aberto:
   * a tela mostrava 7 dias, mas a RPC aceitava qualquer data passada. Uma
   * chamada direta com o token legítimo do gerente gravava e ENVIAVA a
   * conferência de três meses atrás — e um envio antigo não é sujeira, é
   * NÚMERO OFICIAL retroativo entrando na Visão da Rede.
   * ================================================================== */

  describe('31b. A janela tem piso, e ele é do servidor', () => {
    /** O dia D-n, calculado pelo BANCO a partir da data operacional. */
    async function diaMenos(n: number): Promise<string> {
      const { rows } = await db.query(
        'select (public.quadro_business_date() - $1::integer)::text as dia',
        [n],
      );
      return rows[0].dia as string;
    }

    it('o banco e a tela usam o MESMO tamanho de janela', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        'select public.quadro_reference_window_days() as dias',
      );
      // Se alguém mexer só num lado, este teste é quem conta.
      expect(rows[0].dias).toBe(REFERENCE_WINDOW_DAYS);
      expect(rows[0].dias).toBe(7);
    });

    /* --- GRAVAR: [D-7, D] ------------------------------------------- */

    // D-7 é a BORDA DE DENTRO. É o caso que um `<` trocado por `<=` quebraria,
    // e o único jeito de saber que a janela tem mesmo 7 dias e não 6.
    it.each([7, 6, 1, 0])('GRAVAR D-%i é permitido', async (n) => {
      await asUser(db, USERS.manager.id);
      const dia = await diaMenos(n);
      await expect(saveDraft(db, TEST_STORE, dia, aguardando(1))).resolves.toBeTruthy();
    });

    // D-8 é a BORDA DE FORA — o primeiro dia que a tela nunca ofereceu.
    it.each([8, 9, 30, 120])('GRAVAR D-%i é bloqueado: fora da janela', async (n) => {
      await asUser(db, USERS.manager.id);
      const dia = await diaMenos(n);
      await expect(saveDraft(db, TEST_STORE, dia, aguardando(1))).rejects.toThrow(
        /fora da janela/i,
      );
    });

    it('GRAVAR D+1 continua bloqueado, e por OUTRO motivo', async () => {
      await asUser(db, USERS.manager.id);
      // As duas pontas recusam, mas a mensagem tem de dizer QUAL delas: "no
      // futuro" e "fora da janela" mandam o gerente para lados diferentes.
      await expect(saveDraft(db, TEST_STORE, AMANHA, aguardando(1))).rejects.toThrow(
        /no futuro/i,
      );
    });

    it('nada de D-8 sobra no banco depois da recusa', async () => {
      await asUser(db, USERS.manager.id);
      const dia = await diaMenos(8);
      await expect(saveDraft(db, TEST_STORE, dia, aguardando(1))).rejects.toThrow();

      await asSuperuser(db);
      const { rows } = await db.query(
        'select count(*)::int as total from public.quadro_daily_conferences where reference_date = $1',
        [dia],
      );
      expect(rows[0].total).toBe(0);
    });

    /* --- ENVIAR: [D-7, D-1] ----------------------------------------- */

    it.each([7, 6, 1])('ENVIAR D-%i é permitido', async (n) => {
      await asUser(db, USERS.manager.id);
      const dia = await diaMenos(n);
      const conferencia = await saveDraft(db, TEST_STORE, dia, aguardando(1));
      await expect(submitConference(db, conferencia)).resolves.toBeTruthy();
    });

    it('ENVIAR D-0 (hoje) continua bloqueado: o dia não terminou', async () => {
      await asUser(db, USERS.manager.id);
      const conferencia = await saveDraft(db, TEST_STORE, HOJE, aguardando(1));
      await expect(submitConference(db, conferencia)).rejects.toThrow(
        /ainda não terminou/i,
      );
    });

    /**
     * D-8 NÃO PODE SER ENVIADO — e provar isso exige um rascunho que a RPC não
     * deixa criar. O rascunho entra pelo SUPERUSUÁRIO, direto na tabela: é a
     * única forma de simular uma conferência antiga que já existisse no banco,
     * e é o cenário que importa de verdade — um registro velho não vira número
     * oficial só porque alguém achou o id dele.
     */
    /** Um DRAFT antigo plantado direto na tabela, sem passar pela RPC. */
    async function rascunhoAntigo(n: number): Promise<{ id: string; dia: string }> {
      await asSuperuser(db);
      const dia = await diaMenos(n);
      const { rows } = await db.query(
        `insert into public.quadro_daily_conferences
           (store_id, reference_date, status, created_by)
         values ($1, $2, 'DRAFT', $3) returning id`,
        [TEST_STORE, dia, USERS.manager.id],
      );
      const id = rows[0].id as string;
      await db.query(
        `insert into public.quadro_daily_items
           (conference_id, position_id, absence_quantity, day_off_quantity)
         values ($1, $2, 0, 0)`,
        [id, CAIXA],
      );
      return { id, dia };
    }

    // D-8 é a borda; D-60 é o caso que motivou a regra — "a conferência de dois
    // meses atrás" entrando como número oficial retroativo.
    it.each([8, 9, 60])(
      'ENVIAR D-%i é bloqueado mesmo com o rascunho já existindo',
      async (n) => {
        const { id } = await rascunhoAntigo(n);

        await asUser(db, USERS.manager.id);
        await expect(submitConference(db, id)).rejects.toThrow(/fora da janela/i);

        // E continua DRAFT: a recusa não deixou meio-envio para trás.
        await asSuperuser(db);
        const { rows } = await db.query(
          'select status::text as status, submitted_at from public.quadro_daily_conferences where id = $1',
          [id],
        );
        expect(rows[0].status).toBe('DRAFT');
        expect(rows[0].submitted_at).toBeNull();
      },
    );

    /**
     * A CONTRAPROVA DO PLANTIO. Se o rascunho plantado à mão fosse recusado por
     * algum outro motivo — item faltando, loja errada, status impossível —, os
     * testes acima passariam sem provar nada sobre a janela. Este planta D-7
     * pelo MESMO caminho e mostra que ele envia.
     */
    it('o mesmo rascunho plantado em D-7 ENVIA — quem recusa é a janela', async () => {
      const { id } = await rascunhoAntigo(7);

      await asUser(db, USERS.manager.id);
      await expect(submitConference(db, id)).resolves.toBeTruthy();

      await asSuperuser(db);
      const { rows } = await db.query(
        'select status::text as status from public.quadro_daily_conferences where id = $1',
        [id],
      );
      expect(rows[0].status).toBe('SUBMITTED');
    });

    /**
     * E o REOPENED, que é o outro caminho até o envio: reabrir uma conferência
     * antiga não pode ser a porta dos fundos da janela.
     */
    it('nem REOPENED faz um D-8 antigo voltar a ser enviável', async () => {
      const { id } = await rascunhoAntigo(8);

      // A mudança de status passa pela porta estreita — nem o superusuário
      // altera `status` sem a GUC, e isso é o gatilho da 0007 funcionando. Abro
      // e fecho aqui para montar o cenário pelo caminho legítimo.
      await asSuperuser(db);
      await db.query("select set_config('quadro.status_change','on',false)");
      await db.query(
        "update public.quadro_daily_conferences set status = 'REOPENED' where id = $1",
        [id],
      );
      await db.query("select set_config('quadro.status_change','off',false)");

      await asUser(db, USERS.manager.id);
      await expect(submitConference(db, id)).rejects.toThrow(/fora da janela/i);
    });

    /* --- O piso é da Bahia, não da sessão --------------------------- */

    /**
     * A JANELA NÃO PODE ANDAR COM O FUSO. Se andasse, UTC+14 abriria um dia a
     * mais no fundo — e seria o mesmo buraco de antes, entrando pela outra
     * ponta.
     */
    it.each(FUSOS)('em %s o piso continua sendo o da Bahia', async (fuso) => {
      await asUser(db, USERS.manager.id);
      await db.query(`set time zone '${fuso}'`);

      const { rows } = await db.query(
        `select (public.quadro_business_date()
                 - public.quadro_reference_window_days())::text as piso,
                (current_date - public.quadro_reference_window_days())::text as piso_da_sessao`,
      );

      const dia8 = await diaMenos(8);
      await expect(saveDraft(db, TEST_STORE, dia8, aguardando(1))).rejects.toThrow(
        /fora da janela/i,
      );

      const dia7 = await diaMenos(7);
      await expect(saveDraft(db, TEST_STORE, dia7, aguardando(1))).resolves.toBeTruthy();

      await db.query('reset time zone');

      // O piso da sessão pode diferir do operacional; o que manda é o segundo.
      expect(typeof rows[0].piso_da_sessao).toBe('string');
      expect(rows[0].piso).toBe(await diaMenos(7));
    });

    /**
     * O TESTE DE BYPASS, como pedido: token legítimo de gerente, chamada direta
     * à RPC, `reference_date = D-8`. Nem cria rascunho, nem envia.
     */
    it('BYPASS: o gerente legítimo não alcança D-8 por chamada direta', async () => {
      await asUser(db, USERS.manager.id);
      const dia = await diaMenos(8);

      await expect(saveDraft(db, TEST_STORE, dia, aguardando(1))).rejects.toThrow(
        /fora da janela/i,
      );

      await asSuperuser(db);
      const { rows } = await db.query(
        `select count(*)::int as total
           from public.quadro_daily_conferences
          where store_id = $1 and reference_date = $2`,
        [TEST_STORE, dia],
      );
      expect(rows[0].total).toBe(0);
    });

    it('as duas RPCs comparam o piso, e leem a janela de UMA função só', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        `select proname,
                regexp_replace(prosrc, '--[^' || chr(10) || ']*', '', 'g') as codigo
           from pg_proc
          where proname in ('quadro_rpc_save_daily_conference_draft',
                            'quadro_rpc_submit_daily_conference')`,
      );

      expect(rows).toHaveLength(2);
      for (const row of rows) {
        const codigo = String(row.codigo);
        expect(codigo, row.proname).toContain('quadro_reference_window_days');
        expect(codigo, row.proname).toContain('< v_window_start');
        // O número solto no corpo é o que faria banco e tela divergirem.
        expect(codigo, row.proname).not.toMatch(/v_business_date\s*-\s*7\b/);
      }
    });
  });

  /* =====================================================================
   * 32 e 33) Aguardando justificativa numa conferência enviada
   * ================================================================== */

  describe('32-33. A conferência ENVIADA aceita justificativa pendente', () => {
    it('1 falta + 1 aguardando fecha a soma e pode ser enviada', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(db, TEST_STORE, ONTEM, aguardando(1));
      const enviada = await submitConference(db, id);

      expect(enviada.status).toBe('SUBMITTED');
      const foto = await retrato(await itemId(id));
      expect(foto.absence_quantity).toBe(1);
      expect(foto.motivos).toEqual({ [AGUARDANDO]: 1 });
    });

    it('2 faltas + 1 atestado + 1 aguardando também fecha', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(
        db,
        TEST_STORE,
        ONTEM,
        rpcItems([
          {
            positionId: CAIXA,
            absence: 2,
            reasons: [
              { reasonId: ATESTADO, quantity: 1 },
              { reasonId: AGUARDANDO, quantity: 1 },
            ],
          },
        ]),
      );

      await expect(submitConference(db, id)).resolves.toMatchObject({ status: 'SUBMITTED' });
    });

    it('"Aguardando justificativa" NÃO exige observação', async () => {
      await asUser(db, USERS.manager.id);
      // Nenhuma observação em lugar nenhum, e o envio passa.
      const id = await saveDraft(db, TEST_STORE, ONTEM, aguardando(3));
      await expect(submitConference(db, id)).resolves.toMatchObject({ status: 'SUBMITTED' });
    });

    /**
     * A FALTA É OFICIAL, mesmo sem motivo definitivo. Ela aconteceu — esconder
     * do supervisor por causa de um documento que não chegou seria falsear o
     * número para proteger a papelada.
     */
    it('a falta aguardando entra nos números oficiais e no ranking de motivos', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(db, TEST_STORE, ONTEM, aguardando(2));
      await submitConference(db, id);

      await asUser(db, USERS.supervisor.id);

      const faltas = await db.query(
        `select coalesce(sum(absence_quantity), 0)::int as total
           from public.quadro_v_conference_items
          where store_id = $1 and reference_date = $2::date and status = 'SUBMITTED'`,
        [TEST_STORE, ONTEM],
      );
      expect(faltas.rows[0].total).toBe(2);

      const motivos = await db.query(
        `select reason_id, reason_quantity
           from public.quadro_v_conference_item_reasons
          where store_id = $1 and reference_date = $2::date`,
        [TEST_STORE, ONTEM],
      );
      expect(motivos.rows).toEqual([{ reason_id: AGUARDANDO, reason_quantity: 2 }]);
    });

    /** O pré-registro de hoje continua FORA dos números oficiais. */
    it('o pré-registro de hoje NÃO entra nos números oficiais', async () => {
      await asUser(db, USERS.manager.id);
      await saveDraft(db, TEST_STORE, HOJE, aguardando(9));

      await asUser(db, USERS.supervisor.id);
      const { rows } = await db.query(
        `select coalesce(sum(absence_quantity), 0)::int as total
           from public.quadro_v_conference_items
          where store_id = $1 and reference_date = $2::date and status = 'SUBMITTED'`,
        [TEST_STORE, HOJE],
      );
      expect(rows[0].total).toBe(0);
    });
  });

  /* =====================================================================
   * 34) A resolução preserva tudo o que não é o motivo
   * ================================================================== */

  describe('34. Resolver não muda o total de faltas', () => {
    async function enviadaComPendencia(faltas = 2, pendentes = 1) {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(
        db,
        TEST_STORE,
        ONTEM,
        rpcItems([
          {
            positionId: CAIXA,
            absence: faltas,
            dayOff: 3,
            reasons: [
              ...(faltas - pendentes > 0
                ? [{ reasonId: ATESTADO, quantity: faltas - pendentes }]
                : []),
              { reasonId: AGUARDANDO, quantity: pendentes },
            ],
          },
        ]),
      );
      await submitConference(db, id);
      return { conferenceId: id, item: await itemId(id) };
    }

    it('o exemplo do enunciado: 2 faltas, atestado 1 + aguardando 1 -> atestado 2', async () => {
      const { item } = await enviadaComPendencia(2, 1);
      const antes = await retrato(item);

      await asUser(db, USERS.manager.id);
      await resolver(db, item, ATESTADO, 1);

      const depois = await retrato(item);

      // O que MUDOU: só o motivo.
      expect(antes.motivos).toEqual({ [ATESTADO]: 1, [AGUARDANDO]: 1 });
      expect(depois.motivos).toEqual({ [ATESTADO]: 2 });

      // O que NÃO mudou: tudo o mais.
      expect(depois.absence_quantity).toBe(antes.absence_quantity);
      expect(depois.day_off_quantity).toBe(antes.day_off_quantity);
      expect(depois.position_id).toBe(antes.position_id);
      expect(depois.store_id).toBe(antes.store_id);
      expect(depois.reference_date).toBe(antes.reference_date);
      expect(depois.status).toBe('SUBMITTED');
    });

    it.each([ATESTADO, INJUSTIFICADA, 'reason-declaracao-comparecimento', 'reason-licenca'])(
      'resolve para %s preservando o total',
      async (destino) => {
        const { item } = await enviadaComPendencia(1, 1);

        await asUser(db, USERS.manager.id);
        await resolver(db, item, destino, 1);

        const depois = await retrato(item);
        expect(depois.motivos).toEqual({ [destino]: 1 });
        expect(depois.absence_quantity).toBe(1);
        expect(depois.status).toBe('SUBMITTED');
      },
    );

    it('destino "Outros" continua exigindo observação', async () => {
      const { item } = await enviadaComPendencia(1, 1);
      await asUser(db, USERS.manager.id);

      await expect(resolver(db, item, OUTROS, 1)).rejects.toThrow(/exige observação/i);
      await expect(
        resolver(db, item, OUTROS, 1, 'Motivo apurado com o RH'),
      ).resolves.toBeTruthy();

      const depois = await retrato(item);
      expect(depois.motivos).toEqual({ [OUTROS]: 1 });
    });

    it('resolve PARCIALMENTE: 3 pendentes, resolve 1, sobram 2', async () => {
      const { item } = await enviadaComPendencia(3, 3);
      await asUser(db, USERS.manager.id);

      await resolver(db, item, ATESTADO, 1);

      const depois = await retrato(item);
      expect(depois.motivos).toEqual({ [ATESTADO]: 1, [AGUARDANDO]: 2 });
      expect(depois.absence_quantity).toBe(3);
    });

    it('não resolve mais do que está pendente', async () => {
      const { item } = await enviadaComPendencia(2, 1);
      await asUser(db, USERS.manager.id);

      await expect(resolver(db, item, ATESTADO, 2)).rejects.toThrow(/Só há 1 falta/i);
      expect((await retrato(item)).motivos).toEqual({ [ATESTADO]: 1, [AGUARDANDO]: 1 });
    });

    it('não resolve quantidade zero nem negativa', async () => {
      const { item } = await enviadaComPendencia(1, 1);
      await asUser(db, USERS.manager.id);

      await expect(resolver(db, item, ATESTADO, 0)).rejects.toThrow(/maior que zero/i);
      await expect(resolver(db, item, ATESTADO, -1)).rejects.toThrow(/maior que zero/i);
    });

    it('o destino não pode ser o próprio "Aguardando justificativa"', async () => {
      const { item } = await enviadaComPendencia(1, 1);
      await asUser(db, USERS.manager.id);

      await expect(resolver(db, item, AGUARDANDO, 1)).rejects.toThrow(/não pode ser/i);
    });

    it('não resolve o que não está pendente', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(
        db,
        TEST_STORE,
        ONTEM,
        rpcItems([
          { positionId: CAIXA, absence: 1, reasons: [{ reasonId: ATESTADO, quantity: 1 }] },
        ]),
      );
      await submitConference(db, id);

      await expect(resolver(db, await itemId(id), INJUSTIFICADA, 1)).rejects.toThrow(
        /Não há falta aguardando/i,
      );
    });

    it('rascunho não tem o que resolver — o gerente troca o motivo e salva', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(db, TEST_STORE, ONTEM, aguardando(1));

      await expect(resolver(db, await itemId(id), ATESTADO, 1)).rejects.toThrow(
        /só existe para conferência enviada/i,
      );
    });
  });

  /* =====================================================================
   * 35) Segurança
   * ================================================================== */

  describe('35. Só o gerente ativo da própria loja resolve', () => {
    async function pendenciaDaLojaDeTeste() {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(db, TEST_STORE, ONTEM, aguardando(1));
      await submitConference(db, id);
      return itemId(id);
    }

    it('SUPERVISOR não resolve — ele vê e cobra', async () => {
      const item = await pendenciaDaLojaDeTeste();
      await asUser(db, USERS.supervisor.id);

      await expect(resolver(db, item, ATESTADO, 1)).rejects.toThrow(/Sem permissão/i);
      // E o dado continua intacto.
      expect((await retrato(item)).motivos).toEqual({ [AGUARDANDO]: 1 });
    });

    it('ADMIN não ganha o direito por ser admin', async () => {
      const item = await pendenciaDaLojaDeTeste();
      await asUser(db, USERS.admin.id);

      await expect(resolver(db, item, ATESTADO, 1)).rejects.toThrow(/Sem permissão/i);
    });

    /**
     * O gerente de outra loja nem ENXERGA a linha — a RLS a esconde antes. A
     * mensagem é "não encontrado", e é melhor assim: confirmar a existência de
     * um lançamento de loja alheia já é vazar informação.
     */
    it('gerente de OUTRA loja não chega no lançamento', async () => {
      const item = await pendenciaDaLojaDeTeste();
      await asUser(db, USERS.otherManager.id);

      await expect(resolver(db, item, ATESTADO, 1)).rejects.toThrow(/não encontrado/i);
    });

    /**
     * O perfil desligado perde o acesso NA HORA, e perde antes: a RLS de
     * leitura também exige `active`, então ele nem enxerga o lançamento — a
     * recusa vem como "não encontrado", não como "sem permissão".
     *
     * A ordem importa menos que o resultado: ele não resolve, e o dado fica
     * intacto. Por isso o teste cobra as duas coisas, não a frase exata.
     */
    it('gerente INATIVO é recusado', async () => {
      const item = await pendenciaDaLojaDeTeste();

      // Desativação pelo caminho legítimo: só o ADMIN desliga um perfil.
      await asUser(db, USERS.admin.id);
      await db.query('update public.quadro_profiles set active = false where id = $1', [
        USERS.manager.id,
      ]);

      await asUser(db, USERS.manager.id);
      await expect(resolver(db, item, ATESTADO, 1)).rejects.toThrow(
        /não encontrado|Sem permissão/i,
      );

      await asSuperuser(db);
      expect((await retrato(item)).motivos).toEqual({ [AGUARDANDO]: 1 });
    });

    it('a auditoria registra quem resolveu, e é auth.uid()', async () => {
      const item = await pendenciaDaLojaDeTeste();
      await asUser(db, USERS.manager.id);
      await resolver(db, item, ATESTADO, 1, 'Atestado entregue');

      const { rows } = await db.query(
        `select store_id, reference_date::text as reference_date, position_id, quantity,
                from_reason_id, to_reason_id, changed_by, observation
           from public.quadro_absence_reason_resolutions
          where conference_item_id = $1`,
        [item],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        store_id: TEST_STORE,
        reference_date: ONTEM,
        position_id: CAIXA,
        quantity: 1,
        from_reason_id: AGUARDANDO,
        to_reason_id: ATESTADO,
        changed_by: USERS.manager.id,
        observation: 'Atestado entregue',
      });
    });

    it('a trilha de resolução é append-only, mesmo para superusuário', async () => {
      const item = await pendenciaDaLojaDeTeste();
      await asUser(db, USERS.manager.id);
      await resolver(db, item, ATESTADO, 1);

      await asSuperuser(db);
      await expect(
        db.query('update public.quadro_absence_reason_resolutions set quantity = 99'),
      ).rejects.toThrow(/append-only/i);
      await expect(
        db.query('delete from public.quadro_absence_reason_resolutions'),
      ).rejects.toThrow(/append-only/i);
    });
  });

  /* =====================================================================
   * 36) O gatilho e a SEPARAÇÃO DE PRIVILÉGIOS
   * ================================================================== */

  describe('36. A porta é estreita e só a RPC tem a chave', () => {
    async function itemEnviadoComPendencia() {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(db, TEST_STORE, ONTEM, aguardando(1));
      await submitConference(db, id);
      return itemId(id);
    }

    it('UPDATE, INSERT e DELETE manuais em motivo de conferência ENVIADA são bloqueados', async () => {
      const item = await itemEnviadoComPendencia();
      // Superusuário IGNORA a RLS: o que barra aqui é o gatilho, não a política.
      await asSuperuser(db);

      await expect(
        db.query('update public.quadro_daily_item_reasons set quantity = 9 where daily_item_id = $1', [item]),
      ).rejects.toThrow(/motivos bloqueados/i);

      await expect(
        db.query(
          'insert into public.quadro_daily_item_reasons (daily_item_id, reason_id, quantity) values ($1, $2, 1)',
          [item, INJUSTIFICADA],
        ),
      ).rejects.toThrow(/motivos bloqueados/i);

      await expect(
        db.query('delete from public.quadro_daily_item_reasons where daily_item_id = $1', [item]),
      ).rejects.toThrow(/motivos bloqueados/i);
    });

    /**
     * A SEPARAÇÃO QUE JUSTIFICA A GUC NOVA.
     *
     * Se a resolução reaproveitasse `quadro.status_change`, todo ajuste de
     * motivo rodaria com permissão de mexer no status — e um bug na RPC de
     * resolução poderia reabrir uma conferência enviada.
     */
    it('quadro.status_change NÃO libera motivo', async () => {
      const item = await itemEnviadoComPendencia();
      await asSuperuser(db);

      await db.query("select set_config('quadro.status_change', 'on', false)");
      await expect(
        db.query('update public.quadro_daily_item_reasons set quantity = 9 where daily_item_id = $1', [item]),
      ).rejects.toThrow(/motivos bloqueados/i);
      await db.query("select set_config('quadro.status_change', 'off', false)");
    });

    it('quadro.reason_resolution NÃO libera mudança de status', async () => {
      const item = await itemEnviadoComPendencia();
      await asSuperuser(db);

      const { rows } = await db.query(
        'select conference_id from public.quadro_daily_items where id = $1',
        [item],
      );

      await db.query("select set_config('quadro.reason_resolution', 'on', false)");
      await expect(
        db.query("update public.quadro_daily_conferences set status = 'DRAFT' where id = $1", [
          rows[0].conference_id,
        ]),
      ).rejects.toThrow(/edição bloqueada/i);
      await db.query("select set_config('quadro.reason_resolution', 'off', false)");
    });

    it('depois da RPC o gatilho volta ao normal — a autorização não fica pendurada', async () => {
      const item = await itemEnviadoComPendencia();

      await asUser(db, USERS.manager.id);
      await resolver(db, item, ATESTADO, 1);

      // Mesma conexão, logo depois: a GUC é local à transação da RPC.
      await asSuperuser(db);
      await expect(
        db.query('update public.quadro_daily_item_reasons set quantity = 9 where daily_item_id = $1', [item]),
      ).rejects.toThrow(/motivos bloqueados/i);
    });
  });

  /* =====================================================================
   * 36b) A TRILHA NÃO PODE SER FABRICADA
   *
   * Append-only tem DOIS lados. O gatilho impede ALTERAR o histórico; faltava
   * impedir que alguém o INVENTASSE. Com a policy antiga
   * (`changed_by = auth.uid() and quadro_can_write_store(store_id)`), o gerente
   * legítimo da própria loja fazia INSERT direto por PostgREST e criava uma
   * resolução que nunca aconteceu — com o nome dele, a data que quisesse e o
   * motivo que quisesse, sem nenhuma falta ter mudado de motivo.
   *
   * Uma trilha que aceita registro inventado é PIOR que nenhuma, porque parece
   * prova.
   * ================================================================== */

  describe('36b. A trilha de auditoria não aceita registro forjado', () => {
    /** Uma conferência ENVIADA de ontem com 1 falta aguardando justificativa. */
    async function itemEnviadoComPendencia() {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(db, TEST_STORE, ONTEM, aguardando(1));
      await submitConference(db, id);
      return itemId(id);
    }

    /** Um INSERT direto na trilha, como um cliente REST faria. */
    const forjar = (client: Client, changedBy: string, storeId = TEST_STORE) =>
      client.query(
        `insert into public.quadro_absence_reason_resolutions
           (conference_id, conference_item_id, store_id, reference_date, position_id,
            quantity, from_reason_id, to_reason_id, changed_by)
         values (gen_random_uuid(), gen_random_uuid(), $1, public.quadro_business_date(), $2,
                 1, $3, $4, $5)`,
        [storeId, CAIXA, AGUARDANDO, ATESTADO, changedBy],
      );

    const linhas = async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        'select count(*)::int as total from public.quadro_absence_reason_resolutions',
      );
      return rows[0].total as number;
    };

    // A) O caso que motivou a correção: quem TEM permissão de escrever na loja.
    it('A. o gerente da PRÓPRIA loja não grava direto na trilha', async () => {
      const antes = await linhas();
      await asUser(db, USERS.manager.id);

      await expect(forjar(db, USERS.manager.id)).rejects.toThrow(/row-level security/i);
      expect(await linhas()).toBe(antes);
    });

    it('B. o supervisor não grava direto na trilha', async () => {
      const antes = await linhas();
      await asUser(db, USERS.supervisor.id);
      await expect(forjar(db, USERS.supervisor.id)).rejects.toThrow(/row-level security/i);
      expect(await linhas()).toBe(antes);
    });

    it('C. o admin não grava direto na trilha', async () => {
      const antes = await linhas();
      await asUser(db, USERS.admin.id);
      await expect(forjar(db, USERS.admin.id)).rejects.toThrow(/row-level security/i);
      expect(await linhas()).toBe(antes);
    });

    // F) A separação de privilégios, no sentido que faltava provar: quem pode
    // mexer em status NÃO pode forjar auditoria.
    it('F. quadro.status_change ligada não abre a porta da trilha', async () => {
      const antes = await linhas();
      await asUser(db, USERS.manager.id);
      await db.query("select set_config('quadro.status_change','on',false)");

      await expect(forjar(db, USERS.manager.id)).rejects.toThrow(/row-level security/i);

      await db.query("select set_config('quadro.status_change','off',false)");
      expect(await linhas()).toBe(antes);
    });

    // D) A contraprova. Sem ela, os testes acima poderiam estar passando porque
    // a trilha nunca aceita NADA — e a funcionalidade estaria quebrada.
    it('D. pela RPC a trilha É gravada, normalmente', async () => {
      const item = await itemEnviadoComPendencia();
      const antes = await linhas();

      await asUser(db, USERS.manager.id);
      await resolver(db, item, ATESTADO, 1);

      expect(await linhas()).toBe(antes + 1);

      const { rows } = await db.query(
        `select changed_by, store_id, quantity, from_reason_id, to_reason_id
           from public.quadro_absence_reason_resolutions
          where conference_item_id = $1`,
        [item],
      );
      expect(rows).toHaveLength(1);
      // A identidade é a de quem chamou, gravada pela RPC — nunca vinda do cliente.
      expect(rows[0].changed_by).toBe(USERS.manager.id);
      expect(rows[0].store_id).toBe(TEST_STORE);
      expect(rows[0].quantity).toBe(1);
      expect(rows[0].from_reason_id).toBe(AGUARDANDO);
      expect(rows[0].to_reason_id).toBe(ATESTADO);
    });

    // E) A porta fecha sozinha. `set_config(..., true)` é local à transação, e
    // a transação da RPC termina com ela.
    it('E. logo depois da RPC, o INSERT direto volta a ser recusado', async () => {
      const item = await itemEnviadoComPendencia();
      await asUser(db, USERS.manager.id);
      await resolver(db, item, ATESTADO, 1);

      const antes = await linhas();
      // MESMA conexão, logo em seguida — é aqui que uma GUC "pendurada"
      // apareceria.
      await asUser(db, USERS.manager.id);
      await expect(forjar(db, USERS.manager.id)).rejects.toThrow(/row-level security/i);
      expect(await linhas()).toBe(antes);
    });

    // G e H) O outro lado do append-only, que já existia e continua valendo —
    // agora provado na MESMA linha que a RPC criou, não numa inventada.
    it('G e H. a linha gravada pela RPC não aceita UPDATE nem DELETE', async () => {
      const item = await itemEnviadoComPendencia();
      await asUser(db, USERS.manager.id);
      await resolver(db, item, ATESTADO, 1);

      await asSuperuser(db);
      const { rows } = await db.query(
        'select id from public.quadro_absence_reason_resolutions where conference_item_id = $1',
        [item],
      );
      const id = rows[0].id as string;

      // Superusuário de propósito: o gatilho vale para quem IGNORA a RLS, que
      // é justamente quem a policy não alcança.
      await expect(
        db.query('update public.quadro_absence_reason_resolutions set quantity = 99 where id = $1', [id]),
      ).rejects.toThrow(/append-only/i);
      await expect(
        db.query('delete from public.quadro_absence_reason_resolutions where id = $1', [id]),
      ).rejects.toThrow(/append-only/i);

      // E nem com a autorização da resolução ligada: ela abre o INSERT, não o
      // resto.
      await db.query("select set_config('quadro.reason_resolution','on',false)");
      await expect(
        db.query('delete from public.quadro_absence_reason_resolutions where id = $1', [id]),
      ).rejects.toThrow(/append-only/i);
      await db.query("select set_config('quadro.reason_resolution','off',false)");

      const { rows: depois } = await db.query(
        'select quantity from public.quadro_absence_reason_resolutions where id = $1',
        [id],
      );
      expect(depois[0].quantity).toBe(1);
    });

    /**
     * O SELF-CHECK PRECISA SABER FALAR.
     *
     * `text[] || 'literal'` é ambíguo no PostgreSQL: ele tenta `array || array`
     * e morre com "malformed array literal". Os ramos do self-check que
     * concatenavam (`'... em ' || v_rpc`) funcionavam; os de literal nu, não —
     * e só apareceriam no dia em que uma verificação REPROVASSE, que é
     * exatamente o pior momento para o operador receber um erro de tipo em vez
     * do motivo.
     *
     * Passou despercebido porque um self-check que aprova nunca executa o ramo
     * de falha. Aqui os dois são exercitados.
     */
    it('o self-check reprova com a mensagem certa, não com erro de tipo', async () => {
      const fs = await import('node:fs');
      const migration = fs.readFileSync(
        'supabase/migrations/0018_pending_reason_resolution.sql',
        'utf8',
      );

      // 1. Nenhum literal nu sobrou. É forma de código, não prosa.
      const nus = semComentarios(migration)
        .split('\n')
        .filter((l) => /v_faltando := v_faltando \|\|\s*'[^']*'\s*;/.test(l));
      expect(nus, `sem ::text: ${nus.join(' | ')}`).toHaveLength(0);

      // 2. E o bloco de verdade, executado com uma pré-condição quebrada.
      const blocos = migration.match(/do \$\$[\s\S]*?\$\$;/g) ?? [];
      const selfCheck = blocos[blocos.length - 1];
      expect(selfCheck).toContain('Migration 0018 incompleta');

      await asSuperuser(db);
      await db.query('begin');
      try {
        // DESATIVAR, não apagar: o self-check exige o motivo `active`, e apagar
        // esbarraria na FK da própria trilha — que é ela fazendo o trabalho
        // dela. A transação é desfeita no `finally`.
        await db.query(
          "update public.quadro_absence_reasons set active = false where id = 'reason-aguardando-justificativa'",
        );
        await expect(db.query(selfCheck)).rejects.toThrow(
          /Migration 0018 incompleta: motivo reason-aguardando-justificativa/,
        );
      } finally {
        await db.query('rollback');
      }

      // E o motivo continua ativo para os testes seguintes.
      const { rows } = await db.query(
        `select active from public.quadro_absence_reasons
          where id = 'reason-aguardando-justificativa'`,
      );
      expect(rows[0].active).toBe(true);
    });

    it('a policy de INSERT exige a autorização da RESOLUÇÃO, e não a de status', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        `select with_check from pg_policies
          where schemaname = 'public'
            and tablename = 'quadro_absence_reason_resolutions'
            and policyname = 'quadro_reason_resolutions_insert'`,
      );

      expect(rows).toHaveLength(1);
      const expressao = String(rows[0].with_check);
      // A expressão que o BANCO guarda — não o texto da migration.
      expect(expressao).toContain('quadro_reason_resolution_is_authorized');
      expect(expressao).toContain('auth.uid()');
      expect(expressao).toContain('quadro_can_write_store');
      expect(expressao).not.toContain('status_change');
    });
  });

  /* =====================================================================
   * 37) Concorrência
   * ================================================================== */

  describe('37. Duas resoluções simultâneas não consomem a mesma unidade', () => {
    it('com 1 pendente, uma resolve e a outra falha — nunca fica negativo', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(db, TEST_STORE, ONTEM, aguardando(1));
      await submitConference(db, id);
      const item = await itemId(id);

      // Segunda conexão de verdade: concorrência não se simula numa só.
      const outra = await connect(DATABASE_URL as string);
      try {
        await asUser(outra, USERS.manager.id);

        // A primeira abre transação, resolve e SEGURA o lock.
        await db.query('begin');
        await resolver(db, item, ATESTADO, 1);

        // A segunda tenta a mesma unidade e fica esperando o lock.
        const segunda = resolver(outra, item, INJUSTIFICADA, 1);

        await db.query('commit');

        // Ao entrar, ela relê o saldo já consumido e recusa.
        await expect(segunda).rejects.toThrow(/Não há falta aguardando/i);

        const foto = await retrato(item);
        expect(foto.motivos).toEqual({ [ATESTADO]: 1 });
        expect(foto.absence_quantity).toBe(1);
        // Nem soma dobrada, nem quantidade negativa.
        expect(Object.values(foto.motivos).reduce((a, b) => a + b, 0)).toBe(1);
      } finally {
        await asSuperuser(outra);
        await outra.end();
      }
    });

    it('com 2 pendentes, as duas resolvem — uma unidade cada', async () => {
      await asUser(db, USERS.manager.id);
      const id = await saveDraft(db, TEST_STORE, ONTEM, aguardando(2));
      await submitConference(db, id);
      const item = await itemId(id);

      const outra = await connect(DATABASE_URL as string);
      try {
        await asUser(outra, USERS.manager.id);

        await db.query('begin');
        await resolver(db, item, ATESTADO, 1);
        const segunda = resolver(outra, item, INJUSTIFICADA, 1);
        await db.query('commit');
        await segunda;

        const foto = await retrato(item);
        expect(foto.motivos).toEqual({ [ATESTADO]: 1, [INJUSTIFICADA]: 1 });
        expect(foto.absence_quantity).toBe(2);
      } finally {
        await asSuperuser(outra);
        await outra.end();
      }
    });
  });

  /* =====================================================================
   * 38) A virada do dia
   * ================================================================== */

  describe('38. A virada do dia reusa o MESMO registro', () => {
    /**
     * O pré-registro de hoje é a conferência de hoje. Amanhã ele não é copiado,
     * migrado nem recriado: é a mesma linha, com o mesmo id, que passa a ser
     * "de ontem". Quem garante isso é `unique (store_id, reference_date)`.
     */
    it('gravar de novo a mesma data devolve o mesmo id, sem INSERT extra', async () => {
      await asUser(db, USERS.manager.id);

      // "Dia X": o pré-registro de hoje.
      const primeiro = await saveDraft(db, TEST_STORE, HOJE, aguardando(1));

      // "Dia X+1": a tela abre a MESMA data (que agora é ontem) e grava de novo.
      const segundo = await saveDraft(db, TEST_STORE, HOJE, aguardando(2));

      expect(segundo).toBe(primeiro);

      await asSuperuser(db);
      const { rows } = await db.query(
        `select count(*)::int as total, min(status::text) as status
           from public.quadro_daily_conferences
          where store_id = $1 and reference_date = $2::date`,
        [TEST_STORE, HOJE],
      );
      expect(rows[0]).toEqual({ total: 1, status: 'DRAFT' });
    });

    it('o pré-registro de hoje e a conferência de ontem são registros diferentes', async () => {
      await asUser(db, USERS.manager.id);
      const hoje = await saveDraft(db, TEST_STORE, HOJE, aguardando(1));
      const ontem = await saveDraft(db, TEST_STORE, ONTEM, aguardando(1));

      expect(hoje).not.toBe(ontem);

      // Enviar ontem não encosta no pré-registro de hoje.
      await submitConference(db, ontem);

      await asSuperuser(db);
      const { rows } = await db.query(
        `select reference_date::text as data, status::text as status
           from public.quadro_daily_conferences
          where store_id = $1 and reference_date = any($2::date[])
          order by reference_date`,
        [TEST_STORE, [ANTEONTEM, ONTEM, HOJE]],
      );
      expect(rows).toEqual([
        { data: ONTEM, status: 'SUBMITTED' },
        { data: HOJE, status: 'DRAFT' },
      ]);
    });
  });

  /* =====================================================================
   * A migration entregou o que prometeu
   * ================================================================== */

  describe('A migration 0018 instalou o que prometeu', () => {
    it('o motivo existe no banco, ativo e sem exigir observação', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        'select name, active, requires_observation from public.quadro_absence_reasons where id = $1',
        [AGUARDANDO],
      );
      expect(rows[0]).toEqual({
        name: 'Aguardando justificativa',
        active: true,
        requires_observation: false,
      });
    });

    it('a tabela de resoluções tem as colunas que a auditoria exige', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public'
            and table_name = 'quadro_absence_reason_resolutions'`,
      );
      const colunas = rows.map((r) => r.column_name as string);

      for (const exigida of [
        'id',
        'conference_id',
        'conference_item_id',
        'store_id',
        'reference_date',
        'position_id',
        'quantity',
        'from_reason_id',
        'to_reason_id',
        'changed_by',
        'changed_at',
        'observation',
      ]) {
        expect(colunas, `falta a coluna ${exigida}`).toContain(exigida);
      }
    });

    it('a RPC de resolução existe com a assinatura esperada', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        `select pg_get_function_identity_arguments(oid) as args
           from pg_proc where proname = 'quadro_rpc_resolve_pending_absence_reason'`,
      );
      expect(rows[0].args).toBe('p_conference_item_id uuid, p_to_reason_id text, p_quantity integer, p_observation text');
    });

    /** Coexistência: nada fora do prefixo `quadro_` foi criado nesta fase. */
    it('a fase 4.5 só criou objetos quadro_*', async () => {
      await asSuperuser(db);
      const { rows } = await db.query(
        `select tablename from pg_tables
          where schemaname = 'public' and tablename like '%reason_resolution%'`,
      );
      expect(rows.map((r) => r.tablename)).toEqual(['quadro_absence_reason_resolutions']);
    });
  });
});
