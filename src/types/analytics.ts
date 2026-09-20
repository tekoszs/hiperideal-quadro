import type { ConferenceStatus } from '@/types/domain';
import type { NetworkStoreRef } from '@/types/network';

/**
 * Tipos da VISÃO DA REDE (fase 3B) — dashboard analítico do supervisor.
 *
 * Tudo aqui é SOMENTE LEITURA. Nada nesta fase escreve no banco.
 */

/* =========================================================================
 * Período
 * ====================================================================== */

export type PeriodKind = 'DAY' | 'LAST_7' | 'LAST_30' | 'MONTH' | 'CUSTOM';

/** Intervalo fechado de datas ISO (`YYYY-MM-DD`), início e fim inclusive. */
export interface DateRange {
  start: string;
  end: string;
}

/**
 * Período resolvido: o intervalo analisado e o intervalo de comparação.
 *
 * `comparison` é null quando não há como comparar (personalizado que já começa
 * no primeiro dia com dados, por exemplo). Nunca se inventa um 0% para
 * preencher o espaço.
 */
export interface ResolvedPeriod {
  kind: PeriodKind;
  range: DateRange;
  comparison: DateRange | null;
  /** Quantidade de dias do intervalo analisado (inclusive nas duas pontas). */
  days: number;
}

/* =========================================================================
 * Linhas cruas do banco
 * ====================================================================== */

/** `quadro_daily_conferences` no intervalo. */
export interface RangeConferenceRow {
  id: string;
  storeId: string;
  referenceDate: string;
  status: ConferenceStatus;
  submittedAt: string | null;
}

/**
 * `quadro_v_conference_items` — conferência × função × dia.
 * FONTE ÚNICA de faltas e folgas.
 */
export interface RangeItemRow {
  conferenceId: string;
  storeId: string;
  storeName: string;
  referenceDate: string;
  positionId: string;
  positionName: string;
  functionGroup: string;
  sector: string | null;
  absenceQuantity: number;
  dayOffQuantity: number;
  /**
   * Observação do lançamento, quando houve.
   *
   * Entra no pacote do período (fase 4.2) para o detalhe da loja poder mostrar
   * "por que faltou" sem uma segunda ida ao banco por loja — que seria N+1
   * exatamente onde o pedido proíbe. É quase sempre `null`, então custa pouco.
   */
  observation: string | null;
}

/**
 * `quadro_v_conference_item_reasons` — conferência × função × motivo.
 *
 * Sem `absenceQuantity`, igual à fase 3A: a view repete a função uma vez por
 * motivo, e o campo nem existe no banco nem no tipo. Somar falta por aqui não
 * compila e, no PostgreSQL, dá erro de coluna inexistente.
 */
export interface RangeReasonRow {
  conferenceId: string;
  storeId: string;
  referenceDate: string;
  positionId: string;
  reasonId: string;
  reasonName: string;
  reasonQuantity: number;
  /** Observação daquele motivo, quando houve. */
  observation: string | null;
}

/** Pacote cru de um intervalo, como o adaptador entrega. */
export interface NetworkRangeData {
  stores: NetworkStoreRef[];
  /** Conferências de [comparisonStart .. end]. */
  conferences: RangeConferenceRow[];
  /** Itens de [comparisonStart .. end] — o anterior serve só para comparar. */
  items: RangeItemRow[];
  /** Motivos SOMENTE do período analisado. */
  reasons: RangeReasonRow[];
}

/* =========================================================================
 * Filtros da tela
 * ====================================================================== */

export interface AnalyticsFilters {
  /**
   * null = todos os distritos acessíveis ao perfil.
   *
   * ESTE FILTRO NÃO AUTORIZA NADA. Ele apenas recorta o que a RLS já entregou:
   * um gerente distrital recebe do banco somente as lojas do distrito dele, e
   * escolher outro distrito aqui não faria surgir uma única linha a mais.
   */
  districtId: string | null;
  /** null = todas as lojas acessíveis ao perfil. */
  storeId: string | null;
  /** null = todos os grupos de função. */
  functionGroup: string | null;
}

/** Uma opção do seletor de distrito, derivada das lojas acessíveis. */
export interface DistrictOption {
  id: string;
  /** Nome legível. Cai para o id quando o distrito não está no catálogo. */
  name: string;
  /** Responsável — informativo, nunca regra de acesso. */
  managerName: string | null;
  /** Quantas lojas acessíveis pertencem a ele. */
  storeCount: number;
}

/* =========================================================================
 * Métricas
 * ====================================================================== */

/**
 * Variação contra o período anterior.
 *
 * `percent` é null quando não há base (anterior sem falta ou sem conferência).
 * A tela mostra "Sem base para comparação" — nunca 0%.
 */
export interface Delta {
  current: number;
  previous: number;
  /** Variação percentual, ou null quando não há base. */
  percent: number | null;
  hasBase: boolean;
}

/** Cobertura das conferências no período. */
export interface Coverage {
  /** Lojas ativas × dias do período. */
  expected: number;
  /** Conferências com status SUBMITTED no período — o dado oficial. */
  submitted: number;
  /**
   * Conferências que existem mas ainda NÃO foram enviadas (DRAFT/REOPENED).
   *
   * Contam como pendência e nunca como número analítico. Ficam separadas para
   * a tela poder dizer "2 estão em preenchimento" em vez de deixar parecer que
   * ninguém começou.
   */
  inProgress: number;
  /** `expected - submitted`, nunca negativo. */
  pending: number;
  /** `submitted / expected`, ou null quando `expected` é 0. */
  rate: number | null;
}

export interface HeadlineMetrics {
  totalAbsences: number;
  totalDayOffs: number;
  /** Lojas distintas com pelo menos 1 falta no período. */
  storesWithAbsence: number;
  /** Faltas / dias do período. null quando o período tem 0 dias. */
  absencesPerDay: number | null;
  coverage: Coverage;
  absencesDelta: Delta;
  dayOffsDelta: Delta;
}

/** Uma linha de qualquer ranking. */
export interface RankingEntry {
  key: string;
  label: string;
  absences: number;
  dayOffs: number;
  /** Percentual sobre o total aplicável do ranking. null quando o total é 0. */
  share: number | null;
}

export interface StoreRankingEntry extends RankingEntry {
  storeId: string;
  storeCode: string;
  /** Datas distintas em que a loja teve falta. */
  daysWithAbsence: number;
  /** `absences / daysWithAbsence`. null quando não houve dia com falta. */
  averagePerDayWithAbsence: number | null;
}

export interface PositionRankingEntry extends RankingEntry {
  positionId: string;
  functionGroup: string;
  sector: string | null;
  /** Lojas distintas afetadas. */
  storesAffected: number;
}

/** Grupo de função, com o detalhamento das funções que o compõem. */
export interface FunctionGroupEntry extends RankingEntry {
  functionGroup: string;
  storesAffected: number;
  /** As funções detalhadas do grupo — os registros seguem separados no banco. */
  positions: PositionRankingEntry[];
}

export interface SectorEntry extends RankingEntry {
  sector: string;
  storesAffected: number;
}

/**
 * Ranking de setores + o que ficou de fora.
 *
 * `absencesWithoutSector` existe para os números fecharem: funções sem setor
 * não ganham um setor inventado, mas também não somem da conta.
 */
export interface SectorRanking {
  entries: SectorEntry[];
  /** Faltas de funções cujo `sector` é null. */
  absencesWithoutSector: number;
  /** Denominador dos percentuais: só as faltas de funções COM setor. */
  applicableTotal: number;
}

export interface ReasonEntry {
  reasonId: string;
  reasonName: string;
  quantity: number;
  /** Sobre o total de `reason_quantity`. null quando o total é 0. */
  share: number | null;
}

/**
 * Estado de cobertura de um dia — o que separa "zero de verdade" de
 * "ninguém informou".
 *
 *   NO_DATA  nenhuma conferência ENVIADA. `absences: 0` aqui significa
 *            ausência de informação, não ausência de falta.
 *   PARTIAL  parte das lojas enviou. Os números valem, mas são incompletos.
 *   COMPLETE todas as lojas esperadas enviaram. Aqui um 0 é um zero apurado.
 */
export type DayCoverageState = 'NO_DATA' | 'PARTIAL' | 'COMPLETE';

/**
 * Um ponto da evolução diária.
 *
 * Todo dia do período vira um ponto, inclusive os sem conferência — pular os
 * vazios faria o gráfico emendar uma semana com buraco como se fosse contínua.
 * Mas um dia sem conferência NÃO é desenhado como barra zero: `state` diz o
 * que aconteceu e a tela representa cada caso de um jeito.
 */
export interface DailyPoint {
  date: string;
  /** Só de conferências ENVIADAS. */
  absences: number;
  /** Só de conferências ENVIADAS. */
  dayOffs: number;
  /** Conferências ENVIADAS naquele dia. */
  submitted: number;
  /**
   * Conferências esperadas no dia = lojas consideradas.
   * Respeita o filtro: com uma loja selecionada, é 1.
   */
  expected: number;
  /** `submitted / expected`, ou null quando `expected` é 0. */
  coverage: number | null;
  state: DayCoverageState;
}

export interface WeekdayPoint {
  /** 0 = domingo ... 6 = sábado (igual a `Date.getDay()`). */
  weekday: number;
  label: string;
  absences: number;
  /** Quantos dias daquele dia da semana existem no período — a amostra. */
  sampleDays: number;
}

/** Regras de atenção. Determinísticas e nomeadas — sem score oculto. */
export type AttentionRule =
  /** Conferências que não chegaram no período. */
  | 'PENDING_CONFERENCES'
  /** Faltas em 3 ou mais dias seguidos. */
  | 'CONSECUTIVE_DAYS'
  /** Alta relevante contra o período anterior. */
  | 'SHARP_INCREASE'
  /** Maior volume de faltas da rede no período. */
  | 'HIGHEST_VOLUME';

export interface StoreAttention {
  storeId: string;
  storeName: string;
  rule: AttentionRule;
  /** Frase pronta, já explicando o motivo em números. */
  message: string;
}

export interface PositionAttention {
  positionId: string;
  positionName: string;
  absences: number;
  storesAffected: number;
  message: string;
}

/** Tudo que a tela precisa, já calculado. */
/**
 * FASE 4.5 — uma falta ENVIADA que ainda espera o motivo definitivo.
 *
 * O supervisor VÊ, e não resolve: quem sabe por que o associado faltou é a
 * loja. O indicador existe para o supervisor saber onde cobrar o documento,
 * não para ele escolher um motivo no lugar do gerente.
 */
export interface NetworkPendingJustification {
  storeId: string;
  storeName: string;
  districtId: string | null;
  referenceDate: string;
  positionId: string;
  positionName: string;
  quantity: number;
  /** Dias corridos desde a data da falta. */
  waitingDays: number;
}

export interface NetworkAnalytics {
  period: ResolvedPeriod;
  headline: HeadlineMetrics;
  storeRanking: StoreRankingEntry[];
  positionRanking: PositionRankingEntry[];
  functionGroups: FunctionGroupEntry[];
  sectors: SectorRanking;
  reasons: ReasonEntry[];
  daily: DailyPoint[];
  weekdays: WeekdayPoint[];
  storeAttention: StoreAttention[];
  positionAttention: PositionAttention[];
  /** Faltas enviadas aguardando justificativa, mais antiga primeiro (fase 4.5). */
  pendingJustifications: NetworkPendingJustification[];
  /**
   * Lojas que alimentam o SELETOR DE LOJA: as acessíveis ao perfil, já
   * recortadas pelo distrito escolhido — e por nada mais. Não aplica o filtro
   * de loja, senão o próprio seletor ficaria com uma opção só depois da
   * primeira escolha.
   */
  stores: NetworkStoreRef[];
  /**
   * Distritos que alimentam o SELETOR DE DISTRITO.
   *
   * Sai das lojas que o perfil realmente enxerga: quem só recebe as lojas de um
   * distrito vê um distrito. Nada aqui é fixo — não existe "34", "20" ou "14"
   * escrito no código.
   */
  districts: DistrictOption[];
  /**
   * Lojas efetivamente consideradas nos números — depois de distrito E loja.
   *
   * É o denominador honesto de "lojas com falta" e o mesmo que multiplica os
   * dias em `coverage.expected`. Com uma loja escolhida vale 1; usar o total da
   * rede aí faria "1 de 34" para uma análise que olhou 1 loja.
   */
  storesConsidered: number;
  /** Lojas sem distrito definido entre as acessíveis. Normalmente 0. */
  storesWithoutDistrict: number;
  /** Grupos de função presentes nos dados — alimenta o filtro secundário. */
  availableGroups: string[];
  /** True quando não há nenhuma conferência no período analisado. */
  isEmpty: boolean;
}

/* =========================================================================
 * FOCO — o que o supervisor clicou (fase 4.2)
 * ====================================================================== */

/**
 * O recorte que o drawer está mostrando.
 *
 * Existe UM tipo para os três recortes — função, grupo e setor — porque a
 * pergunta é sempre a mesma: "isto aconteceu ONDE, e por quê". Um drawer por
 * ranking seriam três telas quase idênticas para manter em sincronia.
 *
 * A loja tem drawer próprio (`StoreAnalysis`): a pergunta lá é outra — "o que
 * aconteceu nesta loja, dia a dia".
 */
export type AnalyticsFocus =
  | { kind: 'POSITION'; positionId: string }
  | { kind: 'GROUP'; functionGroup: string }
  | { kind: 'SECTOR'; sector: string };

/** Uma loja dentro do foco: quanto, em quantos dias, e quando foi a última. */
export interface FocusStoreEntry {
  storeId: string;
  storeCode: string;
  storeName: string;
  absences: number;
  dayOffs: number;
  /** Datas distintas em que houve falta nesta loja, dentro do foco. */
  daysWithAbsence: number;
  /** Data ISO da ocorrência mais recente. null quando não houve falta. */
  lastOccurrence: string | null;
}

/** Tudo que o drawer de foco mostra. Calculado sem nova ida ao banco. */
export interface FocusAnalysis {
  focus: AnalyticsFocus;
  /** "ATENDENTE ALIMENTOS - PADARIA", "REPOSITOR", "PADARIA". */
  title: string;
  /** Linha de contexto: o grupo da função, o setor, etc. */
  subtitle: string | null;
  totalAbsences: number;
  totalDayOffs: number;
  /** Lojas com pelo menos 1 falta — o denominador honesto de "lojas impactadas". */
  storesAffected: number;
  /** Ordenadas por faltas (desc) e, no empate, pela ocorrência mais recente. */
  stores: FocusStoreEntry[];
  /**
   * Funções dentro do foco. Vazio quando o foco JÁ é uma função — repetir a
   * própria função como sua única "função dentro" não informaria nada.
   */
  positions: PositionRankingEntry[];
  /** Só de `reason_quantity`, e só de conferências ENVIADAS. */
  reasons: ReasonEntry[];
  /** True quando o foco não teve nenhuma falta no período. */
  isEmpty: boolean;
}

/* =========================================================================
 * O dia a dia de uma loja
 * ====================================================================== */

/** Uma função com ocorrência num dia, com motivos e observação. */
export interface StoreDayOccurrence {
  positionId: string;
  positionName: string;
  functionGroup: string;
  sector: string | null;
  absences: number;
  dayOffs: number;
  observation: string | null;
  reasons: Array<{
    reasonId: string;
    reasonName: string;
    quantity: number;
    observation: string | null;
  }>;
}

/**
 * Um dia da loja, com TODAS as funções que tiveram ocorrência.
 *
 * "Todas" é o ponto: quem abre a loja a partir de uma função precisa ver o que
 * mais aconteceu naquele dia. Uma padeira faltando sozinha é uma coisa; três
 * funções faltando no mesmo dia é outra.
 */
export interface StoreDay {
  date: string;
  status: ConferenceStatus;
  absences: number;
  dayOffs: number;
  occurrences: StoreDayOccurrence[];
}

/** Análise de UMA loja, para o drawer aberto pelo ranking. */
export interface StoreAnalysis {
  storeId: string;
  storeName: string;
  storeCode: string;
  totalAbsences: number;
  totalDayOffs: number;
  daysWithAbsence: number;
  positions: PositionRankingEntry[];
  reasons: ReasonEntry[];
  daily: DailyPoint[];
  /**
   * Conferências da loja no período, para o link com a tela Conferências.
   *
   * `absences` e `dayOffs` são `null` quando a conferência não foi enviada:
   * não existe número oficial ali, e um zero pareceria apurado.
   */
  conferences: Array<{
    referenceDate: string;
    status: ConferenceStatus;
    absences: number | null;
    dayOffs: number | null;
  }>;
  /**
   * Dia a dia com ocorrência: datas, quantidades, motivos e observações.
   *
   * Sai dos dados JÁ CARREGADOS do período — abrir a loja não dispara consulta
   * nenhuma. Só dias com ocorrência entram: listar 30 dias vazios enterraria os
   * 3 que interessam.
   */
  days: StoreDay[];
  /**
   * Função que trouxe o usuário até aqui, quando ele veio de um foco.
   *
   * Serve só para destacar visualmente a linha correspondente. Não filtra nada:
   * o objetivo do detalhe é justamente mostrar o que MAIS aconteceu no dia.
   */
  highlightPositionId: string | null;
}
