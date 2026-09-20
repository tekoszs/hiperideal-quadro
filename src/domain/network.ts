import type {
  DetailScope,
  NetworkDayData,
  NetworkDaySummary,
  NetworkDetail,
  NetworkDetailItem,
  NetworkFilter,
  NetworkItemRow,
  NetworkReasonRow,
  NetworkRow,
} from '@/types/network';
import { matchesSearch } from '@/utils/text';
import { sum } from '@/utils/number';

/**
 * Regras puras da área CONFERÊNCIAS do supervisor.
 *
 * Nada aqui conhece Supabase, React ou localStorage: recebe as linhas cruas do
 * dia e devolve o que a tela mostra. É o que torna cada regra testável sem
 * banco e sem navegador.
 */

/* =========================================================================
 * Totais por conferência — a regra que não pode ser quebrada
 * ====================================================================== */

interface ConferenceTotals {
  totalAbsences: number;
  totalDayOffs: number;
  impactedPositions: number;
}

/**
 * Soma faltas e folgas de UMA conferência.
 *
 * A entrada é `NetworkItemRow[]` — linhas de `quadro_v_conference_items`, onde
 * cada função aparece uma única vez. É de propósito que esta função não aceite
 * `NetworkReasonRow[]`: aquele tipo nem sequer tem `absenceQuantity`, então
 * somar faltas pela view de motivos não compila.
 *
 * O caso que isso protege: 3 faltas divididas em 2 motivos. Na view de motivos
 * a função aparece 2 vezes; somando ali o total sairia 6. Aqui sai 3.
 */
export function totalsFromItems(items: NetworkItemRow[]): ConferenceTotals {
  return {
    totalAbsences: sum(items.map((item) => item.absenceQuantity)),
    totalDayOffs: sum(items.map((item) => item.dayOffQuantity)),
    impactedPositions: items.filter(
      (item) => item.absenceQuantity > 0 || item.dayOffQuantity > 0,
    ).length,
  };
}

/** Distribuição por motivo. É PARA ISSO que a view de motivos serve. */
export function reasonTotals(reasons: NetworkReasonRow[]): Map<string, number> {
  const porMotivo = new Map<string, number>();
  for (const reason of reasons) {
    porMotivo.set(reason.reasonId, (porMotivo.get(reason.reasonId) ?? 0) + reason.reasonQuantity);
  }
  return porMotivo;
}

/* =========================================================================
 * Montagem da lista do dia
 * ====================================================================== */

function groupItemsByConference(items: NetworkItemRow[]): Map<string, NetworkItemRow[]> {
  const porConferencia = new Map<string, NetworkItemRow[]>();
  for (const item of items) {
    const atual = porConferencia.get(item.conferenceId);
    if (atual) atual.push(item);
    else porConferencia.set(item.conferenceId, [item]);
  }
  return porConferencia;
}

/**
 * Monta uma linha por LOJA — não por conferência.
 *
 * Parte de `stores` (todas as lojas cadastradas) e cruza com as conferências
 * da data. Loja sem conferência vira `PENDING`. Se partisse das conferências,
 * a tela só mostraria quem enviou, e quem não enviou — o que o supervisor mais
 * precisa ver — desapareceria da lista.
 */
export function buildNetworkRows(data: NetworkDayData): NetworkRow[] {
  const conferenciaPorLoja = new Map(data.conferences.map((c) => [c.storeId, c]));
  const itensPorConferencia = groupItemsByConference(data.items);

  return data.stores.map((store) => {
    const conferencia = conferenciaPorLoja.get(store.id);

    if (!conferencia) {
      return {
        storeId: store.id,
        storeCode: store.code,
        storeName: store.name,
        districtId: store.districtId,
        status: 'PENDING',
        conferenceId: null,
        totalAbsences: 0,
        totalDayOffs: 0,
        impactedPositions: 0,
        submittedAt: null,
        submittedByName: null,
      };
    }

    const totais = totalsFromItems(itensPorConferencia.get(conferencia.id) ?? []);

    return {
      storeId: store.id,
      storeCode: store.code,
      storeName: store.name,
      districtId: store.districtId,
      status: conferencia.status,
      conferenceId: conferencia.id,
      ...totais,
      submittedAt: conferencia.submittedAt,
      submittedByName: conferencia.submittedByName,
    };
  });
}

/** Cards do topo. `stores` vem de `quadro_stores` — nada é inventado. */
export function summarizeNetworkDay(rows: NetworkRow[]): NetworkDaySummary {
  return {
    stores: rows.length,
    submitted: rows.filter((row) => row.status === 'SUBMITTED').length,
    // Pendente para o supervisor = tudo que ainda não chegou enviado:
    // loja sem conferência, rascunho em andamento e conferência reaberta.
    pending: rows.filter((row) => row.status !== 'SUBMITTED').length,
    totalAbsences: sum(rows.map((row) => row.totalAbsences)),
    totalDayOffs: sum(rows.map((row) => row.totalDayOffs)),
  };
}

/* =========================================================================
 * Ordenação e filtros
 * ====================================================================== */

/** Peso de atenção: quanto menor, mais alto na lista. */
function attentionRank(row: NetworkRow): number {
  if (row.status === 'PENDING') return 0;
  if (row.status === 'DRAFT') return 1;
  if (row.status === 'REOPENED') return 2;
  return 3; // SUBMITTED
}

/**
 * Ordem padrão: primeiro o que exige atenção.
 *
 *   1. quem não enviou (PENDENTE, depois em preenchimento e reaberta);
 *   2. entre as enviadas, quem tem mais faltas;
 *   3. desempate por nome, para a lista não dançar entre recarregamentos.
 */
export function sortNetworkRows(rows: NetworkRow[]): NetworkRow[] {
  return [...rows].sort((a, b) => {
    const porAtencao = attentionRank(a) - attentionRank(b);
    if (porAtencao !== 0) return porAtencao;

    const porFaltas = b.totalAbsences - a.totalAbsences;
    if (porFaltas !== 0) return porFaltas;

    return a.storeName.localeCompare(b.storeName, 'pt-BR');
  });
}

export function applyNetworkFilter(rows: NetworkRow[], filter: NetworkFilter): NetworkRow[] {
  switch (filter) {
    case 'SUBMITTED':
      return rows.filter((row) => row.status === 'SUBMITTED');
    case 'PENDING':
      return rows.filter((row) => row.status !== 'SUBMITTED');
    case 'WITH_ABSENCES':
      return rows.filter((row) => row.totalAbsences > 0);
    case 'NO_ABSENCES':
      return rows.filter((row) => row.totalAbsences === 0);
    case 'ALL':
    default:
      return rows;
  }
}

/** Busca por nome ou código da loja, sem acento e sem diferenciar maiúscula. */
export function searchNetworkRows(rows: NetworkRow[], query: string): NetworkRow[] {
  if (query.trim() === '') return rows;
  return rows.filter((row) => matchesSearch(`${row.storeName} ${row.storeCode}`, query));
}

/**
 * Recorta a lista pelo DISTRITO escolhido.
 *
 * Recorte de apresentação, como na Visão da Rede: as linhas já vieram da RLS.
 * Escolher um distrito que o perfil não enxerga devolve lista vazia — nunca
 * lojas novas.
 *
 * `null` no distrito da loja é "sem distrito definido": aparece em "Todos" e
 * sai quando um distrito específico é escolhido.
 */
export function applyDistrictFilter(
  rows: NetworkRow[],
  districtId: string | null,
): NetworkRow[] {
  if (!districtId) return rows;
  return rows.filter((row) => row.districtId === districtId);
}

/** Distrito + filtro + busca + ordenação, na ordem em que a tela precisa. */
export function selectNetworkRows(
  rows: NetworkRow[],
  options: { filter: NetworkFilter; search: string; districtId?: string | null },
): NetworkRow[] {
  const noDistrito = applyDistrictFilter(rows, options.districtId ?? null);
  return sortNetworkRows(
    searchNetworkRows(applyNetworkFilter(noDistrito, options.filter), options.search),
  );
}

/* =========================================================================
 * Detalhamento de uma loja
 * ====================================================================== */

function groupReasonsByPosition(
  reasons: NetworkReasonRow[],
  conferenceId: string,
): Map<string, NetworkReasonRow[]> {
  const porFuncao = new Map<string, NetworkReasonRow[]>();
  for (const reason of reasons) {
    if (reason.conferenceId !== conferenceId) continue;
    const atual = porFuncao.get(reason.positionId);
    if (atual) atual.push(reason);
    else porFuncao.set(reason.positionId, [reason]);
  }
  return porFuncao;
}

/**
 * Detalhamento de uma loja na data.
 *
 * Os TOTAIS vêm dos itens; os MOTIVOS vêm da view de motivos. As duas fontes
 * se encontram só aqui, já agregadas — nunca antes, que é onde a duplicação
 * acontecia na view antiga.
 */
export function buildNetworkDetail(
  data: NetworkDayData,
  storeId: string,
  referenceDate: string,
): NetworkDetail | null {
  const store = data.stores.find((candidate) => candidate.id === storeId);
  if (!store) return null;

  const conferencia = data.conferences.find((candidate) => candidate.storeId === storeId);

  const base = {
    storeId: store.id,
    storeCode: store.code,
    storeName: store.name,
    referenceDate,
  };

  if (!conferencia) {
    return {
      ...base,
      status: 'PENDING',
      submittedAt: null,
      submittedByName: null,
      totalAbsences: 0,
      totalDayOffs: 0,
      impactedPositions: 0,
      items: [],
    };
  }

  const itens = data.items.filter((item) => item.conferenceId === conferencia.id);
  const motivosPorFuncao = groupReasonsByPosition(data.reasons, conferencia.id);

  const items: NetworkDetailItem[] = itens
    .map((item) => ({
      positionId: item.positionId,
      positionName: item.positionName,
      functionGroup: item.functionGroup,
      sector: item.sector,
      absenceQuantity: item.absenceQuantity,
      dayOffQuantity: item.dayOffQuantity,
      observation: item.observation,
      reasons: (motivosPorFuncao.get(item.positionId) ?? [])
        .filter((reason) => reason.reasonQuantity > 0)
        .map((reason) => ({
          reasonId: reason.reasonId,
          reasonName: reason.reasonName,
          quantity: reason.reasonQuantity,
          observation: reason.observation,
        }))
        .sort((a, b) => b.quantity - a.quantity || a.reasonName.localeCompare(b.reasonName, 'pt-BR')),
    }))
    .sort((a, b) => a.positionName.localeCompare(b.positionName, 'pt-BR'));

  return {
    ...base,
    status: conferencia.status,
    submittedAt: conferencia.submittedAt,
    submittedByName: conferencia.submittedByName,
    ...totalsFromItems(itens),
    items,
  };
}

/** Alternador "Ocorrências | Todas as funções" do detalhamento. */
export function scopeDetailItems(
  items: NetworkDetailItem[],
  scope: DetailScope,
): NetworkDetailItem[] {
  if (scope === 'ALL') return items;
  return items.filter((item) => item.absenceQuantity > 0 || item.dayOffQuantity > 0);
}
