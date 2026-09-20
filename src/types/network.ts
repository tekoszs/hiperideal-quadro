import type { ConferenceStatus } from '@/types/domain';

/**
 * Tipos da área CONFERÊNCIAS do supervisor (fase 3A).
 *
 * Tudo aqui é SOMENTE LEITURA. O supervisor não cria, não edita e não reabre
 * conferência nesta fase — as regras do gerente ficam intactas.
 */

/**
 * Situação da loja na data escolhida.
 *
 * `PENDING` NÃO é um status do banco: é a ausência de conferência para aquela
 * loja naquela data. Por isso a lista precisa partir de `quadro_stores` e
 * cruzar com `quadro_daily_conferences` — quem parte da conferência só enxerga
 * quem enviou, e loja que não enviou é exatamente o que o supervisor procura.
 */
export type NetworkStatus = ConferenceStatus | 'PENDING';

/* -------------------------------------------------------------------------
 * Linhas cruas, como saem do banco.
 * Existem em três formatos separados DE PROPÓSITO — ver o comentário de
 * `NetworkReasonRow`.
 * ---------------------------------------------------------------------- */

/** Uma linha de `quadro_daily_conferences` na data, com quem enviou. */
export interface NetworkConferenceRow {
  id: string;
  storeId: string;
  referenceDate: string;
  status: ConferenceStatus;
  submittedAt: string | null;
  submittedBy: string | null;
  /** Nome vindo de `quadro_profiles` pelo embed — nunca do navegador. */
  submittedByName: string | null;
  updatedAt: string | null;
}

/**
 * Uma linha de `quadro_v_conference_items`: conferência × função.
 *
 * É A ÚNICA fonte de faltas e folgas. Uma função aparece aqui UMA vez,
 * independentemente de quantos motivos tenha.
 */
export interface NetworkItemRow {
  conferenceId: string;
  storeId: string;
  positionId: string;
  positionName: string;
  functionGroup: string;
  sector: string | null;
  absenceQuantity: number;
  dayOffQuantity: number;
  observation: string | null;
}

/**
 * Uma linha de `quadro_v_conference_item_reasons`: conferência × função × motivo.
 *
 * REPARE: este tipo NÃO tem `absenceQuantity`, e isso é intencional.
 *
 * A view repete a função uma vez por motivo. Somar faltas a partir daqui
 * multiplicaria o total — 3 faltas divididas em 2 motivos virariam 6. Deixando
 * o campo fora do tipo, somar faltas por engano nesta fonte não compila.
 * O TypeScript passa a garantir a regra, em vez de um comentário pedindo.
 */
export interface NetworkReasonRow {
  conferenceId: string;
  positionId: string;
  reasonId: string;
  reasonName: string;
  /** Quantidade DAQUELE motivo. A soma dos motivos fecha com as faltas. */
  reasonQuantity: number;
  observation: string | null;
}

/** Pacote cru de um dia inteiro da rede, como o adaptador entrega. */
export interface NetworkDayData {
  stores: NetworkStoreRef[];
  conferences: NetworkConferenceRow[];
  items: NetworkItemRow[];
  reasons: NetworkReasonRow[];
}

/**
 * Loja como a lista precisa: vem sempre de `quadro_stores`.
 *
 * `districtId` vem do BANCO (`quadro_stores.district_id`), nunca da lista do
 * frontend e nunca da URL. Ele serve para AGRUPAR o que a RLS já liberou — se
 * o perfil não enxerga a loja, ela não chega aqui para ser agrupada.
 *
 * É `null` quando a loja ainda não foi ligada a um distrito. Loja sem distrito
 * não some da rede: aparece em "Todos os distritos" e fica de fora só quando um
 * distrito específico está selecionado.
 */
export interface NetworkStoreRef {
  id: string;
  code: string;
  name: string;
  districtId: string | null;
}

/* -------------------------------------------------------------------------
 * Modelo já montado, pronto para a tela.
 * ---------------------------------------------------------------------- */

/** Uma linha da lista de conferências do dia. Sempre uma loja. */
export interface NetworkRow {
  storeId: string;
  storeCode: string;
  storeName: string;
  /** Distrito da loja, vindo de `quadro_stores`. Null quando não definido. */
  districtId: string | null;
  status: NetworkStatus;
  /** null quando a loja não abriu conferência na data (PENDING). */
  conferenceId: string | null;
  totalAbsences: number;
  totalDayOffs: number;
  impactedPositions: number;
  submittedAt: string | null;
  submittedByName: string | null;
}

/** Cards do topo: LOJAS · ENVIARAM · PENDENTES · FALTAS · FOLGAS. */
export interface NetworkDaySummary {
  stores: number;
  submitted: number;
  pending: number;
  totalAbsences: number;
  totalDayOffs: number;
}

/** Motivo lançado em uma função, já com o nome legível. */
export interface NetworkDetailReason {
  reasonId: string;
  reasonName: string;
  quantity: number;
  observation: string | null;
}

/** Uma função dentro do detalhamento da loja. */
export interface NetworkDetailItem {
  positionId: string;
  positionName: string;
  functionGroup: string;
  sector: string | null;
  absenceQuantity: number;
  dayOffQuantity: number;
  observation: string | null;
  reasons: NetworkDetailReason[];
}

/** Detalhamento completo de uma loja na data. */
export interface NetworkDetail {
  storeId: string;
  storeCode: string;
  storeName: string;
  referenceDate: string;
  status: NetworkStatus;
  submittedAt: string | null;
  submittedByName: string | null;
  totalAbsences: number;
  totalDayOffs: number;
  impactedPositions: number;
  items: NetworkDetailItem[];
}

/** Filtros da barra superior. Poucos de propósito nesta fase. */
export type NetworkFilter = 'ALL' | 'SUBMITTED' | 'PENDING' | 'WITH_ABSENCES' | 'NO_ABSENCES';

/** Alternador do detalhamento: só ocorrências ou o quadro inteiro. */
export type DetailScope = 'OCCURRENCES' | 'ALL';
