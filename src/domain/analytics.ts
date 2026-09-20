import type {
  AnalyticsFilters,
  Coverage,
  DailyPoint,
  DayCoverageState,
  DateRange,
  AnalyticsFocus,
  Delta,
  DistrictOption,
  FocusAnalysis,
  FocusStoreEntry,
  FunctionGroupEntry,
  HeadlineMetrics,
  NetworkAnalytics,
  NetworkRangeData,
  PositionAttention,
  PositionRankingEntry,
  RangeConferenceRow,
  RangeItemRow,
  RangeReasonRow,
  ReasonEntry,
  ReasonDetailEntry,
  ResolvedPeriod,
  SectorRanking,
  StoreAnalysis,
  StoreAttention,
  StoreDay,
  StoreDayOccurrence,
  StoreRankingEntry,
  WeekdayPoint,
  NetworkPendingJustification,
} from '@/types/analytics';
import type { NetworkStoreRef } from '@/types/network';
import { getDistrict } from '@/data/network';
import { PENDING_REASON_ID } from '@/data/absenceReasons';
import { waitingDaysSince } from '@/domain/pendingJustification';
import { eachDate, isWithin } from '@/domain/period';
import { businessNow, fromIsoDate } from '@/utils/date';
import { sum } from '@/utils/number';

/**
 * VISÃO DA REDE — todas as contas em um lugar só, sem React e sem Supabase.
 *
 * Regras que atravessam o arquivo inteiro:
 *
 *  1. FALTA E FOLGA SÓ SAEM DE `RangeItemRow` (view de itens), onde cada função
 *     aparece uma vez por dia. `RangeReasonRow` nem tem o campo — a view de
 *     motivos repete a função uma vez por motivo e somar falta ali dobraria o
 *     total. 3 faltas em 2 motivos continuam sendo 3.
 *
 *  2. NENHUMA DIVISÃO CRUA. Todo percentual e toda média passam por
 *     `safeDivide`, que devolve `null` em vez de NaN ou Infinity. A tela sabe
 *     mostrar "—"; ela não sabe mostrar NaN.
 *
 *  3. NADA DE IMPACTO SOBRE O QUADRO. `authorized_quantity` ainda pode ser
 *     NULL, então não existe "% do efetivo ausente" aqui. Sem denominador
 *     real, o número seria inventado.
 */

/* =========================================================================
 * Aritmética segura
 * ====================================================================== */

/** Divisão que nunca devolve NaN nem Infinity. */
export function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

/** Percentual de `part` sobre `total`, ou null quando não há base. */
export function share(part: number, total: number): number | null {
  const ratio = safeDivide(part, total);
  return ratio === null ? null : ratio * 100;
}

/**
 * Variação contra o período anterior.
 *
 * Sem base no anterior (zero falta), `percent` fica null e a tela escreve
 * "Sem base para comparação". Mostrar 0% ou 100% aqui seria inventar.
 */
export function buildDelta(current: number, previous: number): Delta {
  const hasBase = previous > 0;
  return {
    current,
    previous,
    percent: hasBase ? ((current - previous) / previous) * 100 : null,
    hasBase,
  };
}

/* =========================================================================
 * O QUE É DADO OFICIAL
 * ====================================================================== */

/**
 * Ids das conferências que podem virar número no dashboard.
 *
 * SÓ `SUBMITTED`. Rascunho e reaberta são conferências que ainda não chegaram:
 * contam como PENDÊNCIA na cobertura e aparecem na tela Conferências, que é
 * operacional — mas não são dado analítico.
 *
 * POR QUE ISSO EXISTE (defeito real, reproduzido no PostgreSQL):
 * as views `quadro_v_conference_items` e `quadro_v_conference_item_reasons`
 * NÃO filtram status. Uma conferência em rascunho ficava pendente na cobertura
 * e, ao mesmo tempo, tinha as faltas somadas no total, no ranking, nos motivos
 * e na comparação. Com 3 faltas enviadas e 10 em rascunho, o painel dizia 13.
 *
 * SEGUNDA CAMADA DE PROPÓSITO: o SupabaseAdapter já filtra `status` na
 * consulta, mas esta função refaz a checagem sobre `RangeConferenceRow[]`, que
 * é a fonte de verdade do status. Assim a regra vale igual no Supabase, no
 * modo demonstração, nos testes e em qualquer adaptador futuro — mesmo que um
 * deles esqueça o filtro.
 */
export function submittedConferenceIds(conferences: RangeConferenceRow[]): Set<string> {
  return new Set(
    conferences
      .filter((conference) => conference.status === 'SUBMITTED')
      .map((conference) => conference.id),
  );
}

/* =========================================================================
 * Filtros
 * ====================================================================== */

/**
 * Lojas que sobram depois dos filtros de DISTRITO e de LOJA.
 *
 * A entrada já vem recortada pela RLS: `stores` é o que o perfil enxerga, não a
 * rede inteira. Por isso este filtro é de APRESENTAÇÃO — Paulo escolhendo
 * "Distrito 2" não veria nada, porque nenhuma loja do distrito 2 chegou até
 * aqui. Nunca dá para ampliar acesso mexendo neste ponto.
 *
 * `districtId: null` na loja significa "sem distrito definido": ela conta em
 * "Todos os distritos" e sai de cena quando um distrito é escolhido.
 */
export function selectStores(
  stores: NetworkStoreRef[],
  filters: AnalyticsFilters,
): NetworkStoreRef[] {
  return stores.filter((store) => {
    if (filters.districtId && store.districtId !== filters.districtId) return false;
    if (filters.storeId && store.id !== filters.storeId) return false;
    return true;
  });
}

/**
 * Uma linha passa quando a loja dela está no escopo E o grupo bate.
 *
 * O escopo chega como CONJUNTO DE IDS já resolvido, e não como `districtId`,
 * porque as linhas de item e de motivo não trazem distrito: quem sabe a que
 * distrito uma loja pertence é `quadro_stores`. Resolver antes evita repetir a
 * busca do distrito em cada uma das milhares de linhas do período.
 */
function matchesFilters(
  row: { storeId: string; functionGroup: string },
  filters: AnalyticsFilters,
  scopeStoreIds: Set<string>,
) {
  if (!scopeStoreIds.has(row.storeId)) return false;
  if (filters.functionGroup && row.functionGroup !== filters.functionGroup) return false;
  return true;
}

/**
 * Itens do intervalo, filtrados por loja, grupo de função e — o principal —
 * pelo conjunto de conferências ENVIADAS.
 *
 * `official` é obrigatório: quem chama precisa dizer explicitamente quais
 * conferências valem. Deixar opcional convidaria a esquecer.
 */
export function selectItems(
  items: RangeItemRow[],
  range: DateRange,
  filters: AnalyticsFilters,
  official: Set<string>,
  scopeStoreIds: Set<string>,
): RangeItemRow[] {
  return items.filter(
    (item) =>
      official.has(item.conferenceId) &&
      isWithin(range, item.referenceDate) &&
      matchesFilters(item, filters, scopeStoreIds),
  );
}

/**
 * Motivos do intervalo, filtrados por loja e pelas conferências ENVIADAS.
 *
 * O filtro de GRUPO precisa da função, que a view de motivos traz por
 * `positionId` — por isso recebe o conjunto de funções já filtradas.
 */
export function selectReasons(
  reasons: RangeReasonRow[],
  range: DateRange,
  filters: AnalyticsFilters,
  allowedPositions: Set<string>,
  official: Set<string>,
  scopeStoreIds: Set<string>,
): RangeReasonRow[] {
  return reasons.filter((reason) => {
    if (!official.has(reason.conferenceId)) return false;
    if (!isWithin(range, reason.referenceDate)) return false;
    if (!scopeStoreIds.has(reason.storeId)) return false;
    if (filters.functionGroup && !allowedPositions.has(reason.positionId)) return false;
    return true;
  });
}

/**
 * Conferências do intervalo, restritas às lojas do escopo.
 *
 * Passou a exigir que a loja esteja no escopo — antes só olhava o filtro de
 * loja. A diferença aparece numa loja DESATIVADA que já tinha enviado: o
 * denominador da cobertura (`lojas ativas × dias`) nunca a contou, então
 * somá-la no numerador dava cobertura acima de 100%.
 */
function selectConferences(
  conferences: RangeConferenceRow[],
  range: DateRange,
  scopeStoreIds: Set<string>,
): RangeConferenceRow[] {
  return conferences.filter(
    (conference) =>
      isWithin(range, conference.referenceDate) && scopeStoreIds.has(conference.storeId),
  );
}

/* =========================================================================
 * Cobertura
 * ====================================================================== */

/**
 * Cobertura = conferências enviadas ÷ conferências esperadas.
 *
 * Esperadas = lojas ativas × dias do período. Como o período termina em D-1,
 * o dia de hoje nunca entra na conta e nunca vira pendência.
 *
 * Só `SUBMITTED` conta como entregue. Rascunho e reaberta são conferências que
 * ainda não chegaram — é o mesmo critério da tela Conferências, para os dois
 * números nunca se contradizerem.
 *
 * LIMITE CONHECIDO: `quadro_stores` não guarda data de cadastro, então uma loja
 * nova é cobrada desde o primeiro dia do período. Com histórico curto isso
 * derruba a cobertura sem que ninguém tenha errado.
 */
export function buildCoverage(
  conferences: RangeConferenceRow[],
  storeCount: number,
  days: number,
): Coverage {
  const expected = Math.max(0, storeCount * days);
  const submitted = conferences.filter((conference) => conference.status === 'SUBMITTED').length;
  const inProgress = conferences.filter((conference) => conference.status !== 'SUBMITTED').length;

  return {
    expected,
    submitted,
    inProgress,
    pending: Math.max(0, expected - submitted),
    rate: safeDivide(submitted, expected),
  };
}

/* =========================================================================
 * Agrupamentos
 * ====================================================================== */

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const row of rows) {
    const chave = key(row);
    const atual = grupos.get(chave);
    if (atual) atual.push(row);
    else grupos.set(chave, [row]);
  }
  return grupos;
}

const byAbsencesDesc = <T extends { absences: number; label: string }>(a: T, b: T) =>
  b.absences - a.absences || a.label.localeCompare(b.label, 'pt-BR');

/* =========================================================================
 * Rankings
 * ====================================================================== */

/**
 * Lojas com mais faltas.
 *
 * `averagePerDayWithAbsence` divide pelos DIAS EM QUE HOUVE FALTA, não pelos
 * dias do período: "12 faltas em 5 dias = 2,4 por dia" responde "quando
 * acontece, acontece quanto", que é o que o supervisor quer saber ao olhar uma
 * loja específica.
 */
export function buildStoreRanking(
  items: RangeItemRow[],
  stores: NetworkStoreRef[],
): StoreRankingEntry[] {
  const porLoja = groupBy(items, (item) => item.storeId);
  const totalFaltas = sum(items.map((item) => item.absenceQuantity));
  const nomePorId = new Map(stores.map((store) => [store.id, store]));

  const entries: StoreRankingEntry[] = [];

  for (const [storeId, linhas] of porLoja) {
    const absences = sum(linhas.map((linha) => linha.absenceQuantity));
    const dayOffs = sum(linhas.map((linha) => linha.dayOffQuantity));
    if (absences === 0 && dayOffs === 0) continue;

    const diasComFalta = new Set(
      linhas.filter((linha) => linha.absenceQuantity > 0).map((linha) => linha.referenceDate),
    ).size;

    const store = nomePorId.get(storeId);
    const label = store?.name ?? linhas[0]?.storeName ?? storeId;

    entries.push({
      key: storeId,
      storeId,
      storeCode: store?.code ?? '',
      label,
      absences,
      dayOffs,
      share: share(absences, totalFaltas),
      daysWithAbsence: diasComFalta,
      averagePerDayWithAbsence: safeDivide(absences, diasComFalta),
    });
  }

  return entries.sort(byAbsencesDesc);
}

/**
 * Funções mais impactadas, pelo NOME COMPLETO.
 *
 * `REPOSITOR - HORTI` e `REPOSITOR - MERCEARIA` são linhas distintas e assim
 * permanecem: são funções diferentes na planilha e no banco. O agrupamento por
 * `function_group` existe em `buildFunctionGroups`, e é só analítico.
 */
export function buildPositionRanking(items: RangeItemRow[]): PositionRankingEntry[] {
  const porFuncao = groupBy(items, (item) => item.positionId);
  const totalFaltas = sum(items.map((item) => item.absenceQuantity));

  const entries: PositionRankingEntry[] = [];

  for (const [positionId, linhas] of porFuncao) {
    const absences = sum(linhas.map((linha) => linha.absenceQuantity));
    if (absences === 0) continue;

    entries.push({
      key: positionId,
      positionId,
      label: linhas[0].positionName,
      functionGroup: linhas[0].functionGroup,
      sector: linhas[0].sector,
      absences,
      dayOffs: sum(linhas.map((linha) => linha.dayOffQuantity)),
      share: share(absences, totalFaltas),
      storesAffected: new Set(
        linhas.filter((linha) => linha.absenceQuantity > 0).map((linha) => linha.storeId),
      ).size,
    });
  }

  return entries.sort(byAbsencesDesc);
}

/** Grupos de função, cada um trazendo dentro as funções detalhadas. */
export function buildFunctionGroups(items: RangeItemRow[]): FunctionGroupEntry[] {
  const porGrupo = groupBy(items, (item) => item.functionGroup);
  const totalFaltas = sum(items.map((item) => item.absenceQuantity));

  const entries: FunctionGroupEntry[] = [];

  for (const [functionGroup, linhas] of porGrupo) {
    const absences = sum(linhas.map((linha) => linha.absenceQuantity));
    if (absences === 0) continue;

    entries.push({
      key: functionGroup,
      functionGroup,
      label: functionGroup,
      absences,
      dayOffs: sum(linhas.map((linha) => linha.dayOffQuantity)),
      share: share(absences, totalFaltas),
      storesAffected: new Set(
        linhas.filter((linha) => linha.absenceQuantity > 0).map((linha) => linha.storeId),
      ).size,
      // O detalhamento reaproveita o ranking de funções, restrito ao grupo.
      positions: buildPositionRanking(linhas),
    });
  }

  return entries.sort(byAbsencesDesc);
}

/**
 * Setores mais impactados.
 *
 * Só entram funções que TÊM setor. Função sem setor não ganha um setor
 * inventado — mas as faltas dela também não somem: voltam em
 * `absencesWithoutSector`, para os números fecharem com o total da rede.
 *
 * O percentual usa como denominador apenas as faltas de funções com setor
 * (`applicableTotal`); senão a soma das fatias nunca chegaria a 100%.
 */
export function buildSectorRanking(items: RangeItemRow[]): SectorRanking {
  const comSetor = items.filter((item) => item.sector !== null && item.sector !== '');
  const semSetor = items.filter((item) => item.sector === null || item.sector === '');

  const applicableTotal = sum(comSetor.map((item) => item.absenceQuantity));
  const porSetor = groupBy(comSetor, (item) => item.sector as string);

  const entries = [];
  for (const [sector, linhas] of porSetor) {
    const absences = sum(linhas.map((linha) => linha.absenceQuantity));
    if (absences === 0) continue;

    entries.push({
      key: sector,
      sector,
      label: sector,
      absences,
      dayOffs: sum(linhas.map((linha) => linha.dayOffQuantity)),
      share: share(absences, applicableTotal),
      storesAffected: new Set(
        linhas.filter((linha) => linha.absenceQuantity > 0).map((linha) => linha.storeId),
      ).size,
    });
  }

  return {
    entries: entries.sort(byAbsencesDesc),
    absencesWithoutSector: sum(semSetor.map((item) => item.absenceQuantity)),
    applicableTotal,
  };
}

/**
 * Distribuição por motivo.
 *
 * Soma `reason_quantity`, e só ele. É a única conta que sai da view de motivos.
 */
export function buildReasonRanking(reasons: RangeReasonRow[]): ReasonEntry[] {
  const porMotivo = groupBy(reasons, (reason) => reason.reasonId);
  const total = sum(reasons.map((reason) => reason.reasonQuantity));

  const entries: ReasonEntry[] = [];
  for (const [reasonId, linhas] of porMotivo) {
    const quantity = sum(linhas.map((linha) => linha.reasonQuantity));
    if (quantity === 0) continue;
    entries.push({
      reasonId,
      reasonName: linhas[0].reasonName,
      quantity,
      share: share(quantity, total),
    });
  }

  return entries.sort(
    (a, b) => b.quantity - a.quantity || a.reasonName.localeCompare(b.reasonName, 'pt-BR'),
  );
}

/* =========================================================================
 * Séries temporais
 * ====================================================================== */

/**
 * Um ponto por dia do período — inclusive os dias sem nenhuma conferência.
 *
 * Pular os dias vazios faria o gráfico mentir: um buraco viraria uma linha
 * contínua e ninguém veria que faltou conferência.
 *
 * Mas dia sem conferência TAMBÉM não é "zero faltas". Antes desta correção
 * ele aparecia como barra de valor zero, indistinguível de um dia em que todas
 * as lojas enviaram e ninguém faltou. São coisas opostas:
 *
 *   "não recebemos informação"  ≠  "apuramos e deu zero"
 *
 * `expected` é a quantidade de lojas CONSIDERADAS — com uma loja selecionada
 * no filtro, é 1, nunca o total da rede. `state` é o que a tela usa para
 * desenhar cada caso de um jeito.
 */
export function buildDailySeries(
  range: DateRange,
  items: RangeItemRow[],
  conferences: RangeConferenceRow[],
  storeCount: number,
): DailyPoint[] {
  const itensPorDia = groupBy(items, (item) => item.referenceDate);
  const enviadasPorDia = groupBy(
    conferences.filter((conference) => conference.status === 'SUBMITTED'),
    (conference) => conference.referenceDate,
  );

  const expected = Math.max(0, storeCount);

  return eachDate(range).map((date) => {
    const linhas = itensPorDia.get(date) ?? [];
    const submitted = (enviadasPorDia.get(date) ?? []).length;

    return {
      date,
      absences: sum(linhas.map((linha) => linha.absenceQuantity)),
      dayOffs: sum(linhas.map((linha) => linha.dayOffQuantity)),
      submitted,
      expected,
      coverage: safeDivide(submitted, expected),
      state: dayCoverageState(submitted, expected),
    };
  });
}

/** Regra dos três estados de um dia. */
export function dayCoverageState(submitted: number, expected: number): DayCoverageState {
  if (submitted <= 0) return 'NO_DATA';
  // `submitted > expected` não deveria acontecer (uma conferência por loja/dia,
  // garantido por constraint), mas se acontecer é cobertura cheia, não parcial.
  return submitted >= expected ? 'COMPLETE' : 'PARTIAL';
}

const WEEKDAY_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/**
 * Faltas acumuladas por dia da semana.
 *
 * `sampleDays` diz quantas segundas (terças, ...) o período tem. A tela usa
 * isso para avisar quando a amostra é pequena demais para concluir qualquer
 * coisa — com 7 dias, cada dia da semana aparece uma única vez.
 */
export function buildWeekdaySeries(daily: DailyPoint[]): WeekdayPoint[] {
  const pontos: WeekdayPoint[] = WEEKDAY_LABEL.map((label, weekday) => ({
    weekday,
    label,
    absences: 0,
    sampleDays: 0,
  }));

  for (const dia of daily) {
    const weekday = fromIsoDate(dia.date).getDay();
    pontos[weekday].absences += dia.absences;
    pontos[weekday].sampleDays += 1;
  }

  // Começa na segunda: é como a operação da loja lê a semana.
  return [...pontos.slice(1), pontos[0]];
}

/* =========================================================================
 * Atenções — regras nomeadas, sem score oculto
 * ====================================================================== */

/** Faltas em N dias seguidos que dispara o alerta de sequência. */
export const CONSECUTIVE_DAYS_THRESHOLD = 3;
/** Alta mínima, em %, para a loja entrar em atenção. */
export const SHARP_INCREASE_THRESHOLD = 30;
/** Faltas mínimas no período anterior para a alta ter base. */
export const SHARP_INCREASE_MIN_BASE = 3;

/** Maior sequência de dias seguidos com falta. */
export function longestAbsenceStreak(dates: string[]): number {
  if (dates.length === 0) return 0;
  const ordenadas = [...new Set(dates)].sort();

  let maior = 1;
  let atual = 1;
  for (let i = 1; i < ordenadas.length; i += 1) {
    const anterior = fromIsoDate(ordenadas[i - 1]).getTime();
    const hoje = fromIsoDate(ordenadas[i]).getTime();
    const diferencaEmDias = Math.round((hoje - anterior) / 86_400_000);
    atual = diferencaEmDias === 1 ? atual + 1 : 1;
    if (atual > maior) maior = atual;
  }
  return maior;
}

/**
 * Lojas que merecem atenção.
 *
 * Quatro regras fixas, cada uma com o número que a disparou dentro da frase.
 * Sem pontuação combinada, sem peso escondido: quem lê sabe exatamente por que
 * a loja está ali e pode conferir na mão.
 */
export function buildStoreAttention(params: {
  items: RangeItemRow[];
  previousItems: RangeItemRow[];
  conferences: RangeConferenceRow[];
  stores: NetworkStoreRef[];
  days: number;
}): StoreAttention[] {
  const { items, previousItems, conferences, stores, days } = params;
  const alertas: StoreAttention[] = [];
  const nomePorId = new Map(stores.map((store) => [store.id, store.name]));

  const faltasPorLoja = new Map<string, number>();
  const diasComFaltaPorLoja = new Map<string, string[]>();

  for (const item of items) {
    if (item.absenceQuantity <= 0) continue;
    faltasPorLoja.set(item.storeId, (faltasPorLoja.get(item.storeId) ?? 0) + item.absenceQuantity);
    const dias = diasComFaltaPorLoja.get(item.storeId) ?? [];
    dias.push(item.referenceDate);
    diasComFaltaPorLoja.set(item.storeId, dias);
  }

  const enviadasPorLoja = new Map<string, number>();
  for (const conference of conferences) {
    if (conference.status !== 'SUBMITTED') continue;
    enviadasPorLoja.set(conference.storeId, (enviadasPorLoja.get(conference.storeId) ?? 0) + 1);
  }

  const faltasAnterioresPorLoja = new Map<string, number>();
  for (const item of previousItems) {
    faltasAnterioresPorLoja.set(
      item.storeId,
      (faltasAnterioresPorLoja.get(item.storeId) ?? 0) + item.absenceQuantity,
    );
  }

  // REGRA 1 — conferência que não chegou.
  for (const store of stores) {
    const pendentes = days - (enviadasPorLoja.get(store.id) ?? 0);
    if (pendentes > 0) {
      alertas.push({
        storeId: store.id,
        storeName: store.name,
        rule: 'PENDING_CONFERENCES',
        message:
          pendentes === 1
            ? '1 conferência pendente no período'
            : `${pendentes} conferências pendentes no período`,
      });
    }
  }

  // REGRA 2 — faltas em dias seguidos.
  for (const [storeId, dias] of diasComFaltaPorLoja) {
    const sequencia = longestAbsenceStreak(dias);
    if (sequencia >= CONSECUTIVE_DAYS_THRESHOLD) {
      alertas.push({
        storeId,
        storeName: nomePorId.get(storeId) ?? storeId,
        rule: 'CONSECUTIVE_DAYS',
        message: `${plural(faltasPorLoja.get(storeId) ?? 0, 'falta', 'faltas')} em ${sequencia} dias consecutivos`,
      });
    }
  }

  // REGRA 3 — alta forte contra o período anterior, com base mínima.
  for (const [storeId, faltas] of faltasPorLoja) {
    const anterior = faltasAnterioresPorLoja.get(storeId) ?? 0;
    if (anterior < SHARP_INCREASE_MIN_BASE) continue;
    const variacao = share(faltas - anterior, anterior);
    if (variacao !== null && variacao >= SHARP_INCREASE_THRESHOLD) {
      alertas.push({
        storeId,
        storeName: nomePorId.get(storeId) ?? storeId,
        rule: 'SHARP_INCREASE',
        message: `${formatPercent(variacao)} de aumento: ${anterior} → ${plural(faltas, 'falta', 'faltas')}`,
      });
    }
  }

  // REGRA 4 — maior volume da rede (só faz sentido com mais de uma loja).
  if (faltasPorLoja.size > 1) {
    const [lider] = [...faltasPorLoja.entries()].sort((a, b) => b[1] - a[1]);
    if (lider && lider[1] > 0) {
      alertas.push({
        storeId: lider[0],
        storeName: nomePorId.get(lider[0]) ?? lider[0],
        rule: 'HIGHEST_VOLUME',
        message: `Maior volume da rede: ${plural(lider[1], 'falta', 'faltas')}`,
      });
    }
  }

  return alertas;
}

/** `1 falta` / `3 faltas` — concordância simples. */
function plural(count: number, singular: string, pluralWord: string): string {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

/** Percentual com sinal, uma casa: `+12,5%`. */
export function formatPercent(value: number, digits = 1): string {
  const sinal = value > 0 ? '+' : '';
  return `${sinal}${value.toFixed(digits).replace('.', ',')}%`;
}

/** Funções em atenção: as que mais faltaram, com quantas lojas atingiram. */
export function buildPositionAttention(
  ranking: PositionRankingEntry[],
  limit = 3,
): PositionAttention[] {
  return ranking.slice(0, limit).map((entry) => ({
    positionId: entry.positionId,
    positionName: entry.label,
    absences: entry.absences,
    storesAffected: entry.storesAffected,
    message: `${plural(entry.absences, 'falta', 'faltas')} em ${plural(
      entry.storesAffected,
      'loja',
      'lojas',
    )}`,
  }));
}

/* =========================================================================
 * Montagem final
 * ====================================================================== */

/**
 * FASE 4.5 — as faltas ENVIADAS que ainda esperam o motivo definitivo.
 *
 * Sai das MESMAS linhas de motivo que o ranking já usa — `reasons` chega aqui
 * recortado por período, escopo e conferência enviada. Nenhuma consulta nova,
 * nenhum N+1: é uma leitura a mais sobre o pacote que já veio.
 *
 * O nome da função vem de `items`, que é a fonte única de função × dia. Quando
 * a função não estiver ali (não deveria acontecer, mas dado real surpreende), o
 * id aparece no lugar do nome — sumir da lista seria pior, porque esconderia
 * uma pendência real.
 */
export function buildPendingJustifications(
  reasons: RangeReasonRow[],
  items: RangeItemRow[],
  stores: NetworkStoreRef[],
  today: Date = businessNow(),
): NetworkPendingJustification[] {
  const nomeDaFuncao = new Map(items.map((item) => [item.positionId, item.positionName]));
  const porLoja = new Map(stores.map((store) => [store.id, store]));

  return reasons
    .filter((row) => row.reasonId === PENDING_REASON_ID && row.reasonQuantity > 0)
    .map((row) => {
      const store = porLoja.get(row.storeId);
      return {
        storeId: row.storeId,
        storeName: store?.name ?? row.storeId,
        districtId: store?.districtId ?? null,
        referenceDate: row.referenceDate,
        positionId: row.positionId,
        positionName: nomeDaFuncao.get(row.positionId) ?? row.positionId,
        quantity: row.reasonQuantity,
        waitingDays: waitingDaysSince(row.referenceDate, today),
      };
    })
    // Mais antiga primeiro: é a que está esperando há mais tempo.
    .sort(
      (a, b) =>
        a.referenceDate.localeCompare(b.referenceDate) ||
        a.storeName.localeCompare(b.storeName, 'pt-BR') ||
        a.positionName.localeCompare(b.positionName, 'pt-BR'),
    );
}

export function buildNetworkAnalytics(
  data: NetworkRangeData,
  period: ResolvedPeriod,
  filters: AnalyticsFilters,
): NetworkAnalytics {
  // ESCOPO da análise: distrito + loja. `data.stores` já chega recortado pela
  // RLS, então isto só reduz — nunca amplia.
  const stores = selectStores(data.stores, filters);
  const scopeStoreIds = new Set(stores.map((store) => store.id));

  // Lojas do seletor: recortadas SÓ pelo distrito. Aplicar também o filtro de
  // loja deixaria o seletor com uma opção depois da primeira escolha.
  const selectableStores = selectStores(data.stores, { ...filters, storeId: null });

  // O que é dado oficial. Vale para o período analisado E para o anterior:
  // comparar 5 faltas enviadas contra 13 (3 enviadas + 10 em rascunho) daria
  // uma queda inventada.
  const official = submittedConferenceIds(data.conferences);

  const items = selectItems(data.items, period.range, filters, official, scopeStoreIds);
  const previousItems = period.comparison
    ? selectItems(data.items, period.comparison, filters, official, scopeStoreIds)
    : [];
  const conferences = selectConferences(data.conferences, period.range, scopeStoreIds);

  const allowedPositions = new Set(items.map((item) => item.positionId));
  const reasons = selectReasons(
    data.reasons,
    period.range,
    filters,
    allowedPositions,
    official,
    scopeStoreIds,
  );

  const totalAbsences = sum(items.map((item) => item.absenceQuantity));
  const totalDayOffs = sum(items.map((item) => item.dayOffQuantity));

  const daily = buildDailySeries(period.range, items, conferences, stores.length);

  const headline: HeadlineMetrics = {
    totalAbsences,
    totalDayOffs,
    storesWithAbsence: new Set(
      items.filter((item) => item.absenceQuantity > 0).map((item) => item.storeId),
    ).size,
    // Média sobre os DIAS DO PERÍODO (o calendário), não sobre os dias com
    // dados: a cobertura, mostrada ao lado, é quem explica um número baixo.
    absencesPerDay: safeDivide(totalAbsences, period.days),
    coverage: buildCoverage(conferences, stores.length, period.days),
    absencesDelta: buildDelta(totalAbsences, sum(previousItems.map((i) => i.absenceQuantity))),
    dayOffsDelta: buildDelta(totalDayOffs, sum(previousItems.map((i) => i.dayOffQuantity))),
  };

  const positionRanking = buildPositionRanking(items);

  return {
    period,
    headline,
    storeRanking: buildStoreRanking(items, stores),
    positionRanking,
    functionGroups: buildFunctionGroups(items),
    sectors: buildSectorRanking(items),
    reasons: buildReasonRanking(reasons),
    daily,
    weekdays: buildWeekdaySeries(daily),
    storeAttention: buildStoreAttention({
      items,
      previousItems,
      conferences,
      stores,
      days: period.days,
    }),
    positionAttention: buildPositionAttention(positionRanking),
    pendingJustifications: buildPendingJustifications(reasons, items, stores),
    stores: selectableStores,
    // Os distritos saem das lojas ACESSÍVEIS, não do distrito escolhido: trocar
    // de distrito não pode fazer as outras opções sumirem do seletor.
    districts: buildDistrictOptions(data.stores),
    storesConsidered: stores.length,
    storesWithoutDistrict: data.stores.filter((store) => store.districtId === null).length,
    availableGroups: [...new Set(data.items.map((item) => item.functionGroup))].sort((a, b) =>
      a.localeCompare(b, 'pt-BR'),
    ),
    /**
     * "Não há dado ANALÍTICO no período."
     *
     * Passou a olhar só as conferências ENVIADAS. Um período com rascunhos e
     * nenhum envio não tem número oficial nenhum — mostrar rankings vazios ao
     * lado de uma cobertura diferente de zero daria a impressão de que os
     * dados foram apurados e deram zero.
     *
     * A cobertura e as pendências continuam sendo calculadas: são justamente
     * o que explica o vazio.
     */
    isEmpty: conferences.filter((conference) => conference.status === 'SUBMITTED').length === 0,
  };
}

/**
 * Opções do seletor de distrito, a partir das lojas ACESSÍVEIS.
 *
 * Nada de contagem fixa: quem recebe 20 lojas de um distrito vê "20"; quem
 * recebe 34 de dois distritos vê "20" e "14". Se amanhã abrir uma loja, o
 * número muda sozinho porque sai da mesma leitura.
 *
 * O nome vem do catálogo gerado (`@/data/network`) só para exibição. Distrito
 * que o catálogo não conheça continua aparecendo, com o id no lugar do nome —
 * some da tela seria pior: as lojas dele sumiriam junto.
 */
export function buildDistrictOptions(stores: NetworkStoreRef[]): DistrictOption[] {
  const contagem = new Map<string, number>();

  for (const store of stores) {
    if (!store.districtId) continue;
    contagem.set(store.districtId, (contagem.get(store.districtId) ?? 0) + 1);
  }

  return [...contagem.entries()]
    .map(([id, storeCount]) => {
      const district = getDistrict(id);
      return {
        id,
        name: district?.name ?? id,
        managerName: district?.managerName ?? null,
        storeCount,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/* =========================================================================
 * FOCO — função, grupo ou setor (fase 4.2)
 * ====================================================================== */

/** As linhas que pertencem ao foco. Um `switch` só, num lugar só. */
function matchesFocus(item: RangeItemRow, focus: AnalyticsFocus): boolean {
  switch (focus.kind) {
    case 'POSITION':
      return item.positionId === focus.positionId;
    case 'GROUP':
      return item.functionGroup === focus.functionGroup;
    case 'SECTOR':
      return item.sector === focus.sector;
    default:
      return false;
  }
}

/**
 * Lojas do foco, com quanto, em quantos dias e quando foi a última ocorrência.
 *
 * ORDEM, como o pedido define: mais faltas primeiro; empate resolvido pela
 * ocorrência MAIS RECENTE. É a ordem de quem vai agir — duas lojas com 3
 * faltas não são iguais se uma parou ontem e a outra há duas semanas.
 *
 * Loja sem falta alguma não entra: "lojas impactadas" que inclui loja sem
 * impacto não é uma contagem, é um cadastro.
 */
export function buildFocusStores(
  items: RangeItemRow[],
  stores: NetworkStoreRef[],
): FocusStoreEntry[] {
  const porLoja = groupBy(items, (item) => item.storeId);
  const catalogo = new Map(stores.map((store) => [store.id, store]));

  const entries: FocusStoreEntry[] = [];

  for (const [storeId, linhas] of porLoja) {
    const absences = sum(linhas.map((linha) => linha.absenceQuantity));
    const dayOffs = sum(linhas.map((linha) => linha.dayOffQuantity));
    if (absences === 0 && dayOffs === 0) continue;

    const diasComFalta = [
      ...new Set(
        linhas.filter((linha) => linha.absenceQuantity > 0).map((linha) => linha.referenceDate),
      ),
    ].sort();

    const store = catalogo.get(storeId);

    entries.push({
      storeId,
      storeCode: store?.code ?? '',
      // Cai para o nome que veio na própria linha quando a loja não está no
      // catálogo — some da tela seria pior: as faltas dela sumiriam junto.
      storeName: store?.name ?? linhas[0]?.storeName ?? storeId,
      absences,
      dayOffs,
      daysWithAbsence: diasComFalta.length,
      lastOccurrence: diasComFalta.at(-1) ?? null,
    });
  }

  return entries.sort(
    (a, b) =>
      b.absences - a.absences ||
      (b.lastOccurrence ?? '').localeCompare(a.lastOccurrence ?? '') ||
      a.storeName.localeCompare(b.storeName, 'pt-BR'),
  );
}

/** Ocorrências individuais de motivos, preservando a observação e o contexto. */
function buildReasonDetails(
  reasons: RangeReasonRow[],
  items: RangeItemRow[],
  stores: NetworkStoreRef[],
): ReasonDetailEntry[] {
  const itemByKey = new Map(
    items.map((item) => [`${item.conferenceId}::${item.positionId}`, item]),
  );
  const storeById = new Map(stores.map((store) => [store.id, store]));

  return reasons
    .filter((reason) => reason.reasonQuantity > 0)
    .map((reason) => {
      const item = itemByKey.get(`${reason.conferenceId}::${reason.positionId}`);
      const store = storeById.get(reason.storeId);

      return {
        reasonId: reason.reasonId,
        reasonName: reason.reasonName,
        referenceDate: reason.referenceDate,
        storeId: reason.storeId,
        storeCode: store?.code ?? '',
        storeName: store?.name ?? item?.storeName ?? reason.storeId,
        positionId: reason.positionId,
        positionName: item?.positionName ?? reason.positionId,
        quantity: reason.reasonQuantity,
        // A observação específica do motivo tem prioridade. Se não houver,
        // aproveita a observação geral daquele lançamento.
        observation: reason.observation ?? item?.observation ?? null,
      };
    })
    .sort(
      (a, b) =>
        b.referenceDate.localeCompare(a.referenceDate) ||
        a.storeName.localeCompare(b.storeName, 'pt-BR') ||
        a.positionName.localeCompare(b.positionName, 'pt-BR'),
    );
}

/** Rótulo e subtítulo do foco, tirados das próprias linhas. */
function describeFocus(
  focus: AnalyticsFocus,
  items: RangeItemRow[],
): { title: string; subtitle: string | null } {
  const primeira = items[0];

  switch (focus.kind) {
    case 'POSITION':
      return {
        title: primeira?.positionName ?? focus.positionId,
        subtitle: primeira?.functionGroup ?? null,
      };
    case 'GROUP':
      return { title: focus.functionGroup, subtitle: 'Grupo de função' };
    case 'SECTOR':
      return { title: focus.sector, subtitle: 'Setor' };
    default:
      return { title: '', subtitle: null };
  }
}

/**
 * Detalhe de uma função, grupo ou setor no período.
 *
 * SEM IDA AO BANCO. Trabalha sobre `data`, que a tela já carregou — abrir um
 * foco não dispara consulta nenhuma, e muito menos uma por loja.
 *
 * As três regras que já valiam continuam valendo, e não por acaso: este builder
 * reaproveita `selectItems` e `selectReasons`, os mesmos do dashboard.
 *
 *   1. só conferência ENVIADA vira número;
 *   2. falta e folga saem só de `RangeItemRow` — 3 faltas divididas em 2
 *      motivos continuam sendo 3, porque `RangeReasonRow` nem tem o campo;
 *   3. o escopo (distrito e loja) do dashboard vale aqui igual.
 */
export function buildFocusAnalysis(
  data: NetworkRangeData,
  period: ResolvedPeriod,
  filters: AnalyticsFilters,
  focus: AnalyticsFocus,
): FocusAnalysis {
  const stores = selectStores(data.stores, filters);
  const scopeStoreIds = new Set(stores.map((store) => store.id));
  const official = submittedConferenceIds(data.conferences);

  // O MESMO filtro do dashboard, e depois o recorte do foco.
  const doPeriodo = selectItems(data.items, period.range, filters, official, scopeStoreIds);
  const items = doPeriodo.filter((item) => matchesFocus(item, focus));

  // Os motivos vêm restritos às funções DO FOCO: pedir os motivos de um setor
  // sem essa restrição traria os motivos da rede inteira.
  const funcoesDoFoco = new Set(items.map((item) => item.positionId));
  const reasons = selectReasons(
    data.reasons,
    period.range,
    filters,
    funcoesDoFoco,
    official,
    scopeStoreIds,
  ).filter((reason) => funcoesDoFoco.has(reason.positionId));

  const { title, subtitle } = describeFocus(focus, items);
  const totalAbsences = sum(items.map((item) => item.absenceQuantity));
  const lojas = buildFocusStores(items, stores);

  return {
    focus,
    title,
    subtitle,
    totalAbsences,
    totalDayOffs: sum(items.map((item) => item.dayOffQuantity)),
    storesAffected: new Set(
      items.filter((item) => item.absenceQuantity > 0).map((item) => item.storeId),
    ).size,
    stores: lojas,
    // Foco de função não lista "funções dentro": ela é a única, e repeti-la
    // não informaria nada.
    positions: focus.kind === 'POSITION' ? [] : buildPositionRanking(items),
    reasons: buildReasonRanking(reasons),
    reasonDetails: buildReasonDetails(reasons, items, stores),
    isEmpty: totalAbsences === 0 && lojas.length === 0,
  };
}

/* =========================================================================
 * O dia a dia de uma loja
 * ====================================================================== */

/**
 * Dias com ocorrência de uma loja, com motivos e observações.
 *
 * SÓ DIAS COM OCORRÊNCIA. Num período de 30 dias, listar os 27 dias vazios
 * enterraria os 3 que interessam.
 *
 * As duas fontes se encontram só aqui, já agregadas: os TOTAIS vêm dos itens,
 * os MOTIVOS vêm da view de motivos. Cruzar antes é o que duplicaria a falta.
 */
export function buildStoreDays(
  items: RangeItemRow[],
  reasons: RangeReasonRow[],
  conferences: RangeConferenceRow[],
): StoreDay[] {
  const statusPorData = new Map(
    conferences.map((conference) => [conference.referenceDate, conference.status]),
  );

  // conferenceId + positionId identifica a ocorrência; é por aí que o motivo
  // encontra a função certa no dia certo.
  const motivosPorItem = new Map<string, RangeReasonRow[]>();
  for (const reason of reasons) {
    const chave = `${reason.conferenceId}::${reason.positionId}`;
    const atual = motivosPorItem.get(chave);
    if (atual) atual.push(reason);
    else motivosPorItem.set(chave, [reason]);
  }

  const porData = groupBy(
    items.filter((item) => item.absenceQuantity > 0 || item.dayOffQuantity > 0),
    (item) => item.referenceDate,
  );

  const dias: StoreDay[] = [];

  for (const [date, linhas] of porData) {
    const occurrences: StoreDayOccurrence[] = linhas
      .map((linha) => ({
        positionId: linha.positionId,
        positionName: linha.positionName,
        functionGroup: linha.functionGroup,
        sector: linha.sector,
        absences: linha.absenceQuantity,
        dayOffs: linha.dayOffQuantity,
        observation: linha.observation,
        reasons: (motivosPorItem.get(`${linha.conferenceId}::${linha.positionId}`) ?? [])
          .map((reason) => ({
            reasonId: reason.reasonId,
            reasonName: reason.reasonName,
            quantity: reason.reasonQuantity,
            observation: reason.observation,
          }))
          .sort((a, b) => b.quantity - a.quantity || a.reasonName.localeCompare(b.reasonName, 'pt-BR')),
      }))
      .sort(
        (a, b) =>
          b.absences - a.absences ||
          b.dayOffs - a.dayOffs ||
          a.positionName.localeCompare(b.positionName, 'pt-BR'),
      );

    dias.push({
      date,
      status: statusPorData.get(date) ?? 'SUBMITTED',
      absences: sum(linhas.map((linha) => linha.absenceQuantity)),
      dayOffs: sum(linhas.map((linha) => linha.dayOffQuantity)),
      occurrences,
    });
  }

  // Mais recente primeiro: é o que o supervisor quer ver ao abrir.
  return dias.sort((a, b) => b.date.localeCompare(a.date));
}

/** Análise de uma loja só — alimenta o drawer aberto pelo ranking. */
export function buildStoreAnalysis(
  data: NetworkRangeData,
  period: ResolvedPeriod,
  storeId: string,
  filters: AnalyticsFilters,
  /** Função que trouxe o usuário até aqui. Só destaca; não filtra. */
  highlightPositionId: string | null = null,
): StoreAnalysis | null {
  const store = data.stores.find((candidate) => candidate.id === storeId);
  if (!store) return null;

  // O drawer é de UMA loja: o escopo é ela, independentemente do distrito
  // escolhido na barra. A loja só chegou aqui porque estava em `data.stores`,
  // ou seja, porque a RLS a liberou.
  const escopo: AnalyticsFilters = { ...filters, districtId: null, storeId };
  const apenasEsta = new Set([store.id]);
  const official = submittedConferenceIds(data.conferences);

  const items = selectItems(data.items, period.range, escopo, official, apenasEsta);
  const conferences = selectConferences(data.conferences, period.range, apenasEsta);
  const allowedPositions = new Set(items.map((item) => item.positionId));
  const reasons = selectReasons(
    data.reasons,
    period.range,
    escopo,
    allowedPositions,
    official,
    apenasEsta,
  );

  const porConferencia = groupBy(items, (item) => item.conferenceId);

  return {
    storeId: store.id,
    storeName: store.name,
    storeCode: store.code,
    totalAbsences: sum(items.map((item) => item.absenceQuantity)),
    totalDayOffs: sum(items.map((item) => item.dayOffQuantity)),
    daysWithAbsence: new Set(
      items.filter((item) => item.absenceQuantity > 0).map((item) => item.referenceDate),
    ).size,
    positions: buildPositionRanking(items),
    // Dia a dia com motivos e observações, dos dados já carregados.
    days: buildStoreDays(items, reasons, conferences),
    highlightPositionId,
    reasons: buildReasonRanking(reasons),
    reasonDetails: buildReasonDetails(reasons, items, [store]),
    // Uma loja: o esperado por dia é 1, nunca o total da rede.
    daily: buildDailySeries(period.range, items, conferences, 1),
    conferences: conferences
      .map((conference) => {
        const linhas = porConferencia.get(conference.id) ?? [];
        const enviada = conference.status === 'SUBMITTED';
        return {
          referenceDate: conference.referenceDate,
          status: conference.status,
          // Conferência não enviada não tem número oficial: `null` para a tela
          // escrever "—" em vez de um zero que pareceria apurado.
          absences: enviada ? sum(linhas.map((linha) => linha.absenceQuantity)) : null,
          dayOffs: enviada ? sum(linhas.map((linha) => linha.dayOffQuantity)) : null,
        };
      })
      .sort((a, b) => b.referenceDate.localeCompare(a.referenceDate)),
  };
}
