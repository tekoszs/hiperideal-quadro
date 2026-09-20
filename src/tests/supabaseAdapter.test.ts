import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAdapter } from '@/services/storage/SupabaseAdapter';
import {
  setAbsenceQuantity,
  setDayOffQuantity,
  setReasonObservation,
  setReasonQuantity,
} from '@/domain/conferenceFactory';
import {
  POSITION_CAIXA,
  POSITION_PADARIA,
  REASON_ATESTADO,
  REASON_OUTROS,
  makeDraft,
} from './fixtures';

interface Call {
  kind: 'rpc' | 'from';
  name: string;
  args?: unknown;
}

const CONFERENCE_UUID = '11111111-1111-1111-1111-111111111111';

/**
 * Cliente Supabase falso: registra tudo que o adaptador chama.
 * Serve para provar o CONTRATO — que nenhuma escrita direta em tabela
 * acontece e que o envio passa pela RPC.
 */
function makeFakeClient(options: { statusAfterSubmit?: string; rpcError?: string } = {}) {
  const calls: Call[] = [];
  let submitted = false;

  const conferenceRow = () => ({
    id: CONFERENCE_UUID,
    store_id: 'store-124',
    reference_date: '2026-09-05',
    status: submitted ? (options.statusAfterSubmit ?? 'SUBMITTED') : 'DRAFT',
    created_by: 'gerente-teste',
    created_at: '2026-09-06T10:00:00.000Z',
    updated_at: '2026-09-06T10:00:00.000Z',
    submitted_at: submitted ? '2026-09-06T10:05:00.000Z' : null,
    daily_items: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        position_id: POSITION_PADARIA,
        absence_quantity: 1,
        day_off_quantity: 0,
        observation: null,
        daily_item_reasons: [
          {
            id: '33333333-3333-3333-3333-333333333333',
            reason_id: REASON_ATESTADO,
            quantity: 1,
            observation: null,
          },
        ],
      },
    ],
  });

  const client = {
    rpc(name: string, args: unknown) {
      calls.push({ kind: 'rpc', name, args });
      if (options.rpcError && name === 'quadro_rpc_submit_daily_conference') {
        return Promise.resolve({ data: null, error: { message: options.rpcError } });
      }
      if (name === 'quadro_rpc_submit_daily_conference') submitted = true;
      return Promise.resolve({ data: CONFERENCE_UUID, error: null });
    },
    from(table: string) {
      calls.push({ kind: 'from', name: table });
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.order = chain;
      builder.limit = chain;
      builder.gte = (column: string, value: string) => {
        calls.push({ kind: 'from', name: `gte:${column}`, args: value });
        return builder;
      };
      builder.lte = (column: string, value: string) => {
        calls.push({ kind: 'from', name: `lte:${column}`, args: value });
        return builder;
      };
      builder.insert = () => Promise.resolve({ data: null, error: null });
      builder.maybeSingle = () => Promise.resolve({ data: conferenceRow(), error: null });
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

function buildFilledConference() {
  let conference = makeDraft();
  conference = { ...conference, id: CONFERENCE_UUID };
  conference = setAbsenceQuantity(conference, POSITION_PADARIA, 1);
  conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);
  conference = setAbsenceQuantity(conference, POSITION_CAIXA, 1);
  conference = setReasonQuantity(conference, POSITION_CAIXA, REASON_OUTROS, 1);
  conference = setReasonObservation(conference, POSITION_CAIXA, REASON_OUTROS, 'Convocação judicial');
  conference = setDayOffQuantity(conference, POSITION_CAIXA, 2);
  return conference;
}

describe('SupabaseAdapter — contrato de escrita', () => {
  it('salva rascunho pela RPC, sem upsert direto em tabela', async () => {
    const { client, calls } = makeFakeClient();
    const adapter = new SupabaseAdapter(client);

    await adapter.saveConference(buildFilledConference());

    const rpcs = calls.filter((call) => call.kind === 'rpc').map((call) => call.name);
    expect(rpcs).toEqual(['quadro_rpc_save_daily_conference_draft']);

    // A única tabela tocada é a leitura de recarga.
    const tables = calls.filter((call) => call.kind === 'from').map((call) => call.name);
    expect(tables).toEqual(['quadro_daily_conferences']);
    expect(tables).not.toContain('quadro_daily_items');
    expect(tables).not.toContain('quadro_daily_item_reasons');
  });

  it('envia o payload em snake_case, sem ids do cliente e sem motivo zerado', async () => {
    const { client, calls } = makeFakeClient();
    const adapter = new SupabaseAdapter(client);

    await adapter.saveConference(buildFilledConference());

    const args = calls.find((call) => call.kind === 'rpc')?.args as {
      p_store_id: string;
      p_reference_date: string;
      p_items: Array<Record<string, unknown>>;
    };

    expect(args.p_store_id).toBe('store-124');
    expect(args.p_reference_date).toBe('2026-09-05');

    const padaria = args.p_items.find((item) => item.position_id === POSITION_PADARIA);
    expect(padaria).toMatchObject({ absence_quantity: 1, day_off_quantity: 0 });
    // Nenhum id gerado no cliente vai para o banco.
    expect(padaria).not.toHaveProperty('id');

    const reasons = padaria?.reasons as Array<Record<string, unknown>>;
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatchObject({ reason_id: REASON_ATESTADO, quantity: 1 });
    expect(reasons[0]).not.toHaveProperty('id');

    // Funções sem ocorrência viajam zeradas, sem motivos.
    const semOcorrencia = args.p_items.filter(
      (item) => item.absence_quantity === 0 && item.day_off_quantity === 0,
    );
    expect(semOcorrencia.every((item) => (item.reasons as unknown[]).length === 0)).toBe(true);
  });

  it('nunca manda status SUBMITTED pelo caminho de rascunho', async () => {
    const { client, calls } = makeFakeClient();
    const adapter = new SupabaseAdapter(client);

    await adapter.saveConference({
      ...buildFilledConference(),
      status: 'SUBMITTED',
      submittedAt: '2026-09-06T10:00:00.000Z',
    });

    const payload = JSON.stringify(calls.filter((call) => call.kind === 'rpc'));
    expect(payload).not.toContain('SUBMITTED');
    expect(payload).not.toContain('submitted_at');
  });

  it('envio salva o rascunho antes e só então chama a RPC de envio, nessa ordem', async () => {
    const { client, calls } = makeFakeClient();
    const adapter = new SupabaseAdapter(client);

    const result = await adapter.submitConference(buildFilledConference());

    const rpcs = calls.filter((call) => call.kind === 'rpc').map((call) => call.name);
    expect(rpcs).toEqual([
      'quadro_rpc_save_daily_conference_draft',
      'quadro_rpc_submit_daily_conference',
    ]);

    const submitArgs = calls.find(
      (call) => call.name === 'quadro_rpc_submit_daily_conference',
    )?.args as { p_conference_id: string };
    // Usa o id que veio do BANCO, não o id local.
    expect(submitArgs.p_conference_id).toBe(CONFERENCE_UUID);

    expect(result.status).toBe('SUBMITTED');
    expect(result.submittedAt).not.toBeNull();
  });

  it('erro na RPC de envio vira exceção e não confirma envio', async () => {
    const { client } = makeFakeClient({ rpcError: 'Função X: informe o motivo das 3 falta(s).' });
    const adapter = new SupabaseAdapter(client);

    await expect(adapter.submitConference(buildFilledConference())).rejects.toThrow(
      /informe o motivo/,
    );
  });

  it('recusa se o banco não confirmar o status SUBMITTED', async () => {
    const { client } = makeFakeClient({ statusAfterSubmit: 'DRAFT' });
    const adapter = new SupabaseAdapter(client);

    await expect(adapter.submitConference(buildFilledConference())).rejects.toThrow(
      /não confirmou o envio/,
    );
  });

  it('consulta o mês inteiro por loja e intervalo de referência', async () => {
    const { client, calls } = makeFakeClient();
    const adapter = new SupabaseAdapter(client);

    await adapter.listConferences('store-124', 62, {
      start: '2026-09-01',
      end: '2026-09-30',
    });

    expect(calls).toContainEqual({ kind: 'from', name: 'gte:reference_date', args: '2026-09-01' });
    expect(calls).toContainEqual({ kind: 'from', name: 'lte:reference_date', args: '2026-09-30' });
  });
});

/**
 * REGRESSÃO — mesmo defeito do catalogService, aqui MUDO.
 *
 * O select aninhado usava `quadro_daily_items (...)` sem alias, e o `toDomain`
 * lia `row.daily_items`. Como havia `?? []`, nada estourava: a conferência
 * voltava com ZERO itens e o gerente veria a tela em branco sem nenhum erro.
 *
 * O cliente falso abaixo imita a REGRA do PostgREST — a chave do aninhado é o
 * alias, ou o nome da tabela quando não há alias. Se o alias sumir do select,
 * estes testes quebram sozinhos.
 */
function makePostgrestClient() {
  let selectUsed = '';

  const item = {
    id: '22222222-2222-2222-2222-222222222222',
    position_id: POSITION_PADARIA,
    absence_quantity: 3,
    day_off_quantity: 1,
    observation: null,
  };
  const reason = {
    id: '33333333-3333-3333-3333-333333333333',
    reason_id: REASON_ATESTADO,
    quantity: 3,
    observation: null,
  };

  /** Chave que o PostgREST usaria para cada relacionamento do select. */
  function chaves() {
    const encontrados = [...selectUsed.matchAll(/(?:(\w+)\s*:\s*)?(quadro_\w+)\s*\(/g)];
    const nivelItem = encontrados.find((m) => m[2] === 'quadro_daily_items');
    const nivelMotivo = encontrados.find((m) => m[2] === 'quadro_daily_item_reasons');
    return {
      itens: nivelItem?.[1] ?? nivelItem?.[2] ?? 'quadro_daily_items',
      motivos: nivelMotivo?.[1] ?? nivelMotivo?.[2] ?? 'quadro_daily_item_reasons',
    };
  }

  const row = () => {
    const { itens, motivos } = chaves();
    return {
      id: CONFERENCE_UUID,
      store_id: 'store-124',
      reference_date: '2026-09-05',
      status: 'DRAFT',
      created_by: 'gerente-teste',
      submitted_by: null,
      created_at: '2026-09-06T10:00:00.000Z',
      updated_at: '2026-09-06T10:00:00.000Z',
      submitted_at: null,
      [itens]: [{ ...item, [motivos]: [reason] }],
    };
  };

  const client = {
    rpc: () => Promise.resolve({ data: CONFERENCE_UUID, error: null }),
    from() {
      const builder: Record<string, unknown> = {};
      builder.select = (select: string) => {
        selectUsed = select;
        return builder;
      };
      builder.eq = () => builder;
      builder.order = () => builder;
      builder.limit = () => Promise.resolve({ data: [row()], error: null });
      builder.maybeSingle = () => Promise.resolve({ data: row(), error: null });
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, getSelect: () => selectUsed };
}

describe('SupabaseAdapter — leitura do PostgREST', () => {
  it('o select aninhado usa alias explícito nos dois níveis', async () => {
    const { client, getSelect } = makePostgrestClient();
    await new SupabaseAdapter(client).getConference('store-124', '2026-09-05');

    expect(getSelect()).toContain('daily_items:quadro_daily_items');
    expect(getSelect()).toContain('daily_item_reasons:quadro_daily_item_reasons');
  });

  it('a conferência volta COM os itens e os motivos (não vazia)', async () => {
    const { client } = makePostgrestClient();
    const conference = await new SupabaseAdapter(client).getConference(
      'store-124',
      '2026-09-05',
    );

    expect(conference?.items).toHaveLength(1);
    expect(conference?.items[0]).toMatchObject({
      positionId: POSITION_PADARIA,
      absenceQuantity: 3,
      dayOffQuantity: 1,
    });
    expect(conference?.items[0].reasons).toHaveLength(1);
    expect(conference?.items[0].reasons[0]).toMatchObject({
      reasonId: REASON_ATESTADO,
      quantity: 3,
    });
  });

  it('o histórico também traz os itens', async () => {
    const { client } = makePostgrestClient();
    const historico = await new SupabaseAdapter(client).listConferences('store-124');

    expect(historico).toHaveLength(1);
    expect(historico[0].items[0].reasons[0].quantity).toBe(3);
  });

  it('aninhado ausente, null ou objeto único não estoura', async () => {
    const base: Record<string, unknown> = {
      id: CONFERENCE_UUID,
      store_id: 'store-124',
      reference_date: '2026-09-05',
      status: 'DRAFT',
      created_by: 'gerente-teste',
      submitted_by: null,
      created_at: '2026-09-06T10:00:00.000Z',
      updated_at: '2026-09-06T10:00:00.000Z',
      submitted_at: null,
      daily_items: null,
    };

    const adapter = new SupabaseAdapter({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: base, error: null }) }),
          }),
        }),
      }),
    } as unknown as SupabaseClient);

    await expect(adapter.getConference('store-124', '2026-09-05')).resolves.toMatchObject({
      items: [],
    });

    // Objeto único no lugar do array (relacionamento inferido como 1:1).
    base.daily_items = {
      id: '22222222-2222-2222-2222-222222222222',
      position_id: POSITION_PADARIA,
      absence_quantity: 1,
      day_off_quantity: 0,
      observation: null,
      daily_item_reasons: { id: 'r', reason_id: REASON_ATESTADO, quantity: 1, observation: null },
    };
    const unico = await adapter.getConference('store-124', '2026-09-05');
    expect(unico?.items).toHaveLength(1);
    expect(unico?.items[0].reasons).toHaveLength(1);

    // Campo simplesmente ausente.
    delete base.daily_items;
    await expect(adapter.getConference('store-124', '2026-09-05')).resolves.toMatchObject({
      items: [],
    });
  });
});

describe('Ids gerados no cliente', () => {
  it('são UUID válido (colunas uuid no PostgreSQL recusavam o formato antigo)', () => {
    const conference = makeDraft();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    expect(conference.id).toMatch(uuid);
    expect(conference.items.every((item) => uuid.test(item.id))).toBe(true);

    const comMotivo = setReasonQuantity(
      setAbsenceQuantity(conference, POSITION_PADARIA, 1),
      POSITION_PADARIA,
      REASON_ATESTADO,
      1,
    );
    const item = comMotivo.items.find((candidate) => candidate.positionId === POSITION_PADARIA);
    expect(item?.reasons[0].id).toMatch(uuid);
  });

  it('não se repetem', () => {
    const ids = new Set(makeDraft().items.map((item) => item.id));
    expect(ids.size).toBe(4);
  });
});
