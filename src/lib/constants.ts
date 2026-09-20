import type { ConferenceStatus } from '@/types/domain';
import type { NetworkFilter, NetworkStatus } from '@/types/network';
import type { PeriodKind } from '@/types/analytics';

export const APP_NAME = 'HIPERIDEAL';
export const APP_SUBTITLE = 'Conferência Diária de Quadro';

export const STATUS_LABEL: Record<ConferenceStatus, string> = {
  DRAFT: 'Em preenchimento',
  SUBMITTED: 'Enviada',
  REOPENED: 'Reaberta',
};

export type StatusTone = 'neutral' | 'success' | 'warning';

export const STATUS_TONE: Record<ConferenceStatus, StatusTone> = {
  DRAFT: 'warning',
  SUBMITTED: 'success',
  REOPENED: 'neutral',
};

export const HISTORY_LIMIT = 62;

/* =========================================================================
 * Área CONFERÊNCIAS do supervisor (fase 3A)
 * ====================================================================== */

/**
 * Rótulos da lista da rede.
 *
 * PENDENTE não existe no banco: é a loja SEM conferência na data. Os outros
 * três são os status reais de `quadro_conference_status`.
 */
export const NETWORK_STATUS_LABEL: Record<NetworkStatus, string> = {
  SUBMITTED: 'Enviada',
  DRAFT: 'Em preenchimento',
  REOPENED: 'Reaberta',
  PENDING: 'Pendente',
};

/**
 * Cores: verde = enviada/normal, laranja = pendente, e nada além disso.
 * Vermelho fica reservado para falta/impacto, nunca para status.
 */
export const NETWORK_STATUS_TONE: Record<NetworkStatus, StatusTone> = {
  SUBMITTED: 'success',
  DRAFT: 'warning',
  REOPENED: 'neutral',
  PENDING: 'warning',
};

export const NETWORK_FILTER_LABEL: Record<NetworkFilter, string> = {
  ALL: 'Todos',
  SUBMITTED: 'Enviadas',
  PENDING: 'Pendentes',
  WITH_ABSENCES: 'Com faltas',
  NO_ABSENCES: 'Sem faltas',
};

export const NETWORK_FILTERS: NetworkFilter[] = [
  'ALL',
  'SUBMITTED',
  'PENDING',
  'WITH_ABSENCES',
  'NO_ABSENCES',
];

/* =========================================================================
 * Visão da Rede (fase 3B)
 * ====================================================================== */

export const PERIOD_LABEL: Record<PeriodKind, string> = {
  DAY: 'Dia',
  LAST_7: '7 dias',
  LAST_30: '30 dias',
  MONTH: 'Mês',
  CUSTOM: 'Personalizado',
};

export const PERIOD_KINDS: PeriodKind[] = ['DAY', 'LAST_7', 'LAST_30', 'MONTH', 'CUSTOM'];

/**
 * Amostra mínima por dia da semana para a distribuição semanal merecer
 * alguma leitura. Com 7 dias, cada dia aparece UMA vez — não dá para concluir
 * nada, e a tela avisa isso em vez de fingir uma tendência.
 */
export const WEEKDAY_MIN_SAMPLE = 2;
