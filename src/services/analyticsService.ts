import type {
  AnalyticsFilters,
  AnalyticsFocus,
  FocusAnalysis,
  NetworkAnalytics,
  NetworkRangeData,
  ResolvedPeriod,
  StoreAnalysis,
} from '@/types/analytics';
import {
  buildFocusAnalysis,
  buildNetworkAnalytics,
  buildStoreAnalysis,
} from '@/domain/analytics';
import { getStorageAdapter, type StorageAdapter } from '@/services/storage';

/**
 * VISÃO DA REDE — SOMENTE LEITURA.
 *
 * Este módulo não exporta nenhuma escrita, e não é por esquecimento: o
 * supervisor não edita, não reabre e não apaga conferência em nenhuma fase
 * até aqui. Há teste garantindo que a superfície pública continue só de
 * leitura.
 *
 * Divisão de trabalho:
 *   adaptador -> traz as linhas cruas do período (4 consultas em paralelo);
 *   domínio   -> faz todas as contas, sem React e sem banco;
 *   este arquivo -> junta os dois e nada mais.
 */

function adapter(): StorageAdapter {
  return getStorageAdapter();
}

export interface LoadedRange {
  period: ResolvedPeriod;
  raw: NetworkRangeData;
}

/**
 * Busca o período no banco.
 *
 * UMA ida por período. Trocar loja ou grupo de função NÃO chama esta função —
 * esses filtros são aplicados em memória, sobre `raw`, por `analyze`.
 */
export async function loadNetworkRange(period: ResolvedPeriod): Promise<LoadedRange> {
  const raw = await adapter().getNetworkRange({
    start: period.range.start,
    end: period.range.end,
    // Sem período de comparação, a busca não estica para trás.
    comparisonStart: period.comparison?.start ?? period.range.start,
  });

  return { period, raw };
}

/** Aplica os filtros e calcula tudo. Puro: pode rodar a cada render. */
export function analyze(
  loaded: LoadedRange,
  filters: AnalyticsFilters,
  displayPeriod?: ResolvedPeriod,
): NetworkAnalytics {
  return buildNetworkAnalytics(loaded.raw, displayPeriod ?? loaded.period, filters);
}

/** Análise de uma loja específica, sem nova ida ao banco. */
export function analyzeStore(
  loaded: LoadedRange,
  storeId: string,
  filters: AnalyticsFilters,
  highlightPositionId: string | null = null,
  focusPeriod?: ResolvedPeriod,
): StoreAnalysis | null {
  return buildStoreAnalysis(
    loaded.raw,
    focusPeriod ?? loaded.period,
    storeId,
    filters,
    highlightPositionId,
  );
}

/**
 * Detalhe de uma função, grupo ou setor — SEM nova ida ao banco.
 *
 * Este é o ponto do pedido "não criar N+1": abrir o detalhe de uma função com
 * 12 lojas não dispara 12 consultas, nem uma. Tudo sai de `loaded.raw`, que a
 * tela já tinha carregado para desenhar o dashboard.
 */
export function analyzeFocus(
  loaded: LoadedRange,
  focus: AnalyticsFocus,
  filters: AnalyticsFilters,
  focusPeriod?: ResolvedPeriod,
): FocusAnalysis {
  return buildFocusAnalysis(loaded.raw, focusPeriod ?? loaded.period, filters, focus);
}
