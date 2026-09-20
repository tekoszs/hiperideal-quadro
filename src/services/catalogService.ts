import { POSITIONS, STORES, STORE_STAFFING } from '@/data/catalog';
import { getActiveReasons } from '@/data/absenceReasons';
import { getSupabaseClient } from '@/lib/supabaseClient';
import type { AbsenceReason, Position, Store } from '@/types/domain';

/**
 * Cadastros.
 *
 * DEMO     -> catálogo gerado de `docs/Quadrodia.xlsx` (src/data/catalog.ts).
 * SUPABASE -> lido do banco, já filtrado pela RLS: o gerente só recebe a
 *             própria loja e as funções do quadro dela.
 *
 * As telas não sabem de onde vem — chamam sempre estas funções.
 */

interface PositionRow {
  id: string;
  name: string;
  function_group: string;
  sector: string | null;
  active: boolean;
  display_order: number;
}

/**
 * SELECT das funções ligadas ao quadro da loja.
 *
 * O ALIAS `positions:quadro_positions` é OBRIGATÓRIO.
 *
 * Sem ele, o PostgREST devolve o relacionamento na propriedade com o nome
 * real da tabela (`row.quadro_positions`), e o código que lê `row.positions`
 * recebe `undefined` — foi exatamente o que quebrou a tela com
 * "Cannot read properties of undefined (reading 'active')".
 *
 * Com o alias, o nome da tabela no banco pode mudar sem que o mapeamento
 * do TypeScript precise mudar junto.
 */
const POSITIONS_SELECT = `
  position_id,
  positions:quadro_positions (
    id,
    name,
    function_group,
    sector,
    active,
    display_order
  )
`;

export async function getStoreById(storeId: string): Promise<Store | null> {
  const client = getSupabaseClient();

  if (!client) {
    return STORES.find((store) => store.id === storeId) ?? null;
  }

  const { data, error } = await client
    .from('quadro_stores')
    .select('id, code, name, active')
    .eq('id', storeId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar a loja: ${error.message}`);
  return data ? (data as Store) : null;
}

/** Loja do modo demo: a primeira do catálogo importado da planilha. */
export function getDemoStore(): Store | null {
  return STORES.find((store) => store.active) ?? null;
}

/** Linha crua do PostgREST: o relacionamento pode vir objeto, array ou faltar. */
interface StaffingRow {
  position_id?: string;
  positions?: PositionRow | PositionRow[] | null;
}

/**
 * Normaliza a resposta do PostgREST.
 *
 * Defensiva de propósito contra os três formatos que já apareceram:
 *  - objeto único (`positions: {...}`);
 *  - array (`positions: [{...}]`, quando a FK é inferida como 1:N);
 *  - ausente ou nulo (`undefined` / `null`), sem provocar erro em tempo de execução.
 */
export function normalizePositionRows(rows: unknown): Position[] {
  if (!Array.isArray(rows)) return [];

  return (rows as StaffingRow[])
    .flatMap((row) => {
      const relacionamento = row?.positions;
      if (relacionamento == null) return [];
      return Array.isArray(relacionamento) ? relacionamento : [relacionamento];
    })
    // `!= null` cobre null E undefined; `?.` protege item inválido dentro do array.
    .filter((position): position is PositionRow => position != null && position.active === true)
    .map((position) => ({
      id: position.id,
      name: position.name,
      functionGroup: position.function_group,
      sector: position.sector ?? null,
      active: position.active,
      displayOrder: position.display_order,
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Funções da loja, na ordem da planilha.
 * Cada linha da planilha continua sendo uma função separada — nada é fundido.
 */
export async function listPositionsByStore(storeId: string): Promise<Position[]> {
  const client = getSupabaseClient();

  if (!client) {
    const allowed = new Set(
      STORE_STAFFING.filter(
        (staffing) => staffing.storeId === storeId && staffing.effectiveTo === null,
      ).map((staffing) => staffing.positionId),
    );

    return POSITIONS.filter((position) => position.active && allowed.has(position.id)).sort(
      (a, b) => a.displayOrder - b.displayOrder,
    );
  }

  const { data, error } = await client
    .from('quadro_store_staffing')
    .select(POSITIONS_SELECT)
    .eq('store_id', storeId)
    .is('effective_to', null);

  if (error) throw new Error(`Falha ao carregar as funções: ${error.message}`);

  return normalizePositionRows(data);
}

export async function listAbsenceReasons(): Promise<AbsenceReason[]> {
  const client = getSupabaseClient();

  if (!client) return getActiveReasons();

  const { data, error } = await client
    .from('quadro_absence_reasons')
    .select('id, name, active, display_order, requires_observation')
    .eq('active', true)
    .order('display_order');

  if (error) throw new Error(`Falha ao carregar os motivos: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    active: row.active as boolean,
    displayOrder: row.display_order as number,
    requiresObservation: row.requires_observation as boolean,
  }));
}

/**
 * Agrupamento visual da lista.
 * Só cria cabeçalho de grupo quando o grupo tem mais de uma função
 * (ATENDENTE ALIMENTOS, AUX. DE COZINHA, REPOSITOR). As demais ficam soltas.
 */
export interface PositionGroup {
  key: string;
  /** Título do grupo; null quando a função é exibida solta. */
  groupLabel: string | null;
  positions: Position[];
}

export function buildPositionGroups(positions: Position[]): PositionGroup[] {
  const counts = new Map<string, number>();
  for (const position of positions) {
    counts.set(position.functionGroup, (counts.get(position.functionGroup) ?? 0) + 1);
  }

  const groups: PositionGroup[] = [];
  const groupIndex = new Map<string, PositionGroup>();

  for (const position of positions) {
    const isGrouped = (counts.get(position.functionGroup) ?? 0) > 1;

    if (!isGrouped) {
      groups.push({
        key: `single-${position.id}`,
        groupLabel: null,
        positions: [position],
      });
      continue;
    }

    const existing = groupIndex.get(position.functionGroup);
    if (existing) {
      existing.positions.push(position);
      continue;
    }

    const created: PositionGroup = {
      key: `group-${position.functionGroup}`,
      groupLabel: position.functionGroup,
      positions: [position],
    };
    groupIndex.set(position.functionGroup, created);
    groups.push(created);
  }

  return groups;
}
