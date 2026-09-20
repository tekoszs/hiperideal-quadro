import type {
  NetworkDayData,
  NetworkDaySummary,
  NetworkDetail,
  NetworkRow,
} from '@/types/network';
import {
  buildNetworkDetail,
  buildNetworkRows,
  summarizeNetworkDay,
} from '@/domain/network';
import { getStorageAdapter, type StorageAdapter } from '@/services/storage';

/**
 * Área CONFERÊNCIAS do supervisor — SOMENTE LEITURA.
 *
 * Este serviço não expõe nenhuma escrita de propósito: nesta fase o supervisor
 * não edita, não reabre e não apaga conferência. As regras do gerente ficam
 * exatamente como foram aprovadas.
 *
 * A tela nunca fala com o Supabase direto: passa por aqui, que passa pelo
 * adaptador — o mesmo caminho da tela do gerente.
 */

function adapter(): StorageAdapter {
  return getStorageAdapter();
}

export interface NetworkDay {
  referenceDate: string;
  rows: NetworkRow[];
  summary: NetworkDaySummary;
  /** Guardado para montar o detalhamento sem uma segunda ida ao banco. */
  raw: NetworkDayData;
}

/**
 * Carrega o dia inteiro: lojas, conferências, itens e motivos.
 *
 * O que o usuário enxerga é decidido pela RLS, não aqui. Um MANAGER que
 * chamasse esta função receberia apenas a própria loja — o banco recusa o
 * resto. Não existe nenhum `if (role === ...)` neste caminho.
 */
export async function loadNetworkDay(referenceDate: string): Promise<NetworkDay> {
  const raw = await adapter().getNetworkDay(referenceDate);
  const rows = buildNetworkRows(raw);

  return {
    referenceDate,
    rows,
    summary: summarizeNetworkDay(rows),
    raw,
  };
}

/** Detalhamento de uma loja, montado a partir do dia já carregado. */
export function getNetworkDetail(day: NetworkDay, storeId: string): NetworkDetail | null {
  return buildNetworkDetail(day.raw, storeId, day.referenceDate);
}
