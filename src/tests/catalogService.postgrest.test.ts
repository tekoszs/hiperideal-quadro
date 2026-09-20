import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POSITIONS, STORE_STAFFING } from '@/data/catalog';

/**
 * REGRESSÃO — erro real encontrado no Supabase/PostgREST:
 *
 *   Cannot read properties of undefined (reading 'active')
 *
 * Causa: o `.select()` pedia o relacionamento como `quadro_positions (...)`,
 * sem alias. O PostgREST devolve o aninhado na propriedade com o NOME DA
 * TABELA, então `row.positions` era `undefined`. O filtro antigo era
 * `position !== null && position.active` — e `undefined !== null` é `true`,
 * então o `undefined` passava e estourava no `.active`.
 *
 * Estes testes NÃO fixam a resposta esperada na mão: eles simulam o
 * comportamento do PostgREST (a chave do aninhado é o alias, ou o nome da
 * tabela quando não há alias). Se alguém remover o alias do select, o teste
 * quebra sozinho — que foi exatamente o que os testes antigos não pegaram.
 */

const supabaseMock = vi.hoisted(() => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => supabaseMock);

const { getSupabaseClient } = supabaseMock;

const STORE_ID = 'store-124';

/** Linha do banco, em snake_case, como o PostgREST devolve. */
function positionRow(position: (typeof POSITIONS)[number]) {
  return {
    id: position.id,
    name: position.name,
    function_group: position.functionGroup,
    sector: position.sector,
    active: position.active,
    display_order: position.displayOrder,
  };
}

/**
 * Cliente falso que imita a REGRA de nomeação do PostgREST:
 * a chave do relacionamento aninhado é o alias, e o nome da tabela quando
 * não existe alias. É isso que reproduz o defeito de produção.
 */
function makeFakePostgrest(options: { shape?: 'object' | 'array' | 'null' } = {}) {
  const shape = options.shape ?? 'object';
  let selectUsed = '';
  const filtros: Array<[string, unknown]> = [];

  const client = {
    from() {
      const builder: Record<string, unknown> = {};
      builder.select = (select: string) => {
        selectUsed = select;
        return builder;
      };
      builder.eq = (coluna: string, valor: unknown) => {
        filtros.push([coluna, valor]);
        return builder;
      };
      builder.is = () => {
        const match = /(?:(\w+)\s*:\s*)?(quadro_\w+)\s*\(/.exec(selectUsed);
        // Nome da propriedade: alias se houver, senão o nome real da tabela.
        const key = match?.[1] ?? match?.[2] ?? 'quadro_positions';

        const autorizadas = new Set(
          STORE_STAFFING.filter((s) => s.storeId === STORE_ID && s.effectiveTo === null).map(
            (s) => s.positionId,
          ),
        );

        const data = POSITIONS.filter((p) => autorizadas.has(p.id)).map((position) => {
          const row = positionRow(position);
          return {
            position_id: position.id,
            [key]: shape === 'null' ? null : shape === 'array' ? [row] : row,
          };
        });

        return Promise.resolve({ data, error: null });
      };
      return builder;
    },
  };

  return { client, getSelect: () => selectUsed, getFiltros: () => filtros };
}

describe('catalogService — resposta real do PostgREST', () => {
  beforeEach(() => {
    getSupabaseClient.mockReset();
  });

  it('o select pede o relacionamento COM alias explícito', async () => {
    const { client, getSelect } = makeFakePostgrest();
    getSupabaseClient.mockReturnValue(client);

    const { listPositionsByStore } = await import('@/services/catalogService');
    await listPositionsByStore(STORE_ID);

    expect(getSelect()).toContain('positions:quadro_positions');
  });

  it('carrega as 25 funções quando o aninhado vem como OBJETO', async () => {
    const { client } = makeFakePostgrest({ shape: 'object' });
    getSupabaseClient.mockReturnValue(client);

    const { listPositionsByStore } = await import('@/services/catalogService');
    const positions = await listPositionsByStore(STORE_ID);

    expect(positions).toHaveLength(25);
    expect(positions[0].name).toBe('ACOUGUEIRO');
  });

  it('carrega as 25 funções quando o aninhado vem como ARRAY', async () => {
    const { client } = makeFakePostgrest({ shape: 'array' });
    getSupabaseClient.mockReturnValue(client);

    const { listPositionsByStore } = await import('@/services/catalogService');
    const positions = await listPositionsByStore(STORE_ID);

    expect(positions).toHaveLength(25);
  });

  it('aninhado null não provoca erro em tempo de execução', async () => {
    const { client } = makeFakePostgrest({ shape: 'null' });
    getSupabaseClient.mockReturnValue(client);

    const { listPositionsByStore } = await import('@/services/catalogService');
    await expect(listPositionsByStore(STORE_ID)).resolves.toEqual([]);
  });

  /**
   * FASE 4.1 — a loja pedida é a loja consultada.
   *
   * A consulta acontece no banco, então os testes de integração provam o DADO;
   * este prova o CÓDIGO. Se alguém fixasse `store-124` no filtro — por descuido
   * ou copiando de um exemplo —, todas as 34 lojas passariam a mostrar as
   * funções da 124 e nenhum teste de banco perceberia, porque o banco estaria
   * respondendo corretamente à pergunta errada.
   */
  it('consulta a loja que recebeu, não uma loja fixa', async () => {
    const { client, getFiltros } = makeFakePostgrest();
    getSupabaseClient.mockReturnValue(client);

    const { listPositionsByStore } = await import('@/services/catalogService');
    await listPositionsByStore('store-307');

    expect(getFiltros()).toContainEqual(['store_id', 'store-307']);
    expect(getFiltros().some(([, valor]) => valor === 'store-124')).toBe(false);
  });

  it('mantém REPOSITOR, ATENDENTE ALIMENTOS e AUX. DE COZINHA separados por setor', async () => {
    const { client } = makeFakePostgrest();
    getSupabaseClient.mockReturnValue(client);

    const { listPositionsByStore, buildPositionGroups } = await import(
      '@/services/catalogService'
    );
    const positions = await listPositionsByStore(STORE_ID);

    const porGrupo = (grupo: string) => positions.filter((p) => p.functionGroup === grupo);

    expect(porGrupo('REPOSITOR')).toHaveLength(4);
    expect(porGrupo('ATENDENTE ALIMENTOS')).toHaveLength(3);
    expect(porGrupo('AUX. DE COZINHA')).toHaveLength(2);

    // Cada uma é um registro próprio: nada foi fundido no caminho do banco.
    expect(new Set(positions.map((p) => p.id)).size).toBe(25);
    expect(porGrupo('REPOSITOR').map((p) => p.sector).sort()).toEqual([
      'BAZAR',
      'FRIOS',
      'HORTI',
      'MERCEARIA',
    ]);

    // E o agrupamento visual continua com exatamente 3 cabeçalhos.
    const comCabecalho = buildPositionGroups(positions).filter((g) => g.groupLabel !== null);
    expect(comCabecalho.map((g) => g.groupLabel).sort()).toEqual([
      'ATENDENTE ALIMENTOS',
      'AUX. DE COZINHA',
      'REPOSITOR',
    ]);
  });

  it('respeita a ordem da planilha (display_order)', async () => {
    const { client } = makeFakePostgrest();
    getSupabaseClient.mockReturnValue(client);

    const { listPositionsByStore } = await import('@/services/catalogService');
    const positions = await listPositionsByStore(STORE_ID);

    const ordem = positions.map((p) => p.displayOrder);
    expect(ordem).toEqual([...ordem].sort((a, b) => a - b));
  });
});

describe('normalizePositionRows — defensiva contra undefined, não só null', () => {
  it('undefined no relacionamento não estoura (era o erro de produção)', async () => {
    const { normalizePositionRows } = await import('@/services/catalogService');
    // Formato EXATO do bug: a chave veio com o nome da tabela, não com o alias.
    const rows = [{ position_id: 'pos-acougueiro', quadro_positions: { active: true } }];
    expect(() => normalizePositionRows(rows)).not.toThrow();
    expect(normalizePositionRows(rows)).toEqual([]);
  });

  it('null, undefined e ausência do campo são todos ignorados', async () => {
    const { normalizePositionRows } = await import('@/services/catalogService');
    expect(
      normalizePositionRows([{ positions: null }, { positions: undefined }, {}]),
    ).toEqual([]);
  });

  it('array com buraco não estoura', async () => {
    const { normalizePositionRows } = await import('@/services/catalogService');
    expect(normalizePositionRows([{ positions: [null, undefined] }])).toEqual([]);
  });

  it('entrada que não é array (null do PostgREST em erro) devolve lista vazia', async () => {
    const { normalizePositionRows } = await import('@/services/catalogService');
    expect(normalizePositionRows(null)).toEqual([]);
    expect(normalizePositionRows(undefined)).toEqual([]);
  });

  it('função inativa é descartada, e só por active === true', async () => {
    const { normalizePositionRows } = await import('@/services/catalogService');
    const base = {
      id: 'pos-x',
      name: 'X',
      function_group: 'X',
      sector: null,
      active: true,
      display_order: 1,
    };

    expect(normalizePositionRows([{ positions: { ...base, active: false } }])).toEqual([]);
    expect(normalizePositionRows([{ positions: base }])).toHaveLength(1);
  });

  it('converte snake_case do banco para camelCase do domínio', async () => {
    const { normalizePositionRows } = await import('@/services/catalogService');
    const [position] = normalizePositionRows([
      {
        positions: {
          id: 'pos-repositor-horti',
          name: 'REPOSITOR - HORTI',
          function_group: 'REPOSITOR',
          sector: 'HORTI',
          active: true,
          display_order: 22,
        },
      },
    ]);

    expect(position).toEqual({
      id: 'pos-repositor-horti',
      name: 'REPOSITOR - HORTI',
      functionGroup: 'REPOSITOR',
      sector: 'HORTI',
      active: true,
      displayOrder: 22,
    });
  });
});
