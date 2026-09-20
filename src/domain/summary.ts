import type {
  ConferenceSummary,
  DailyConference,
  DailyItem,
} from '@/types/domain';
import { sum } from '@/utils/number';

/** Soma das quantidades informadas nos motivos de uma função. */
export function getReasonsTotal(item: DailyItem): number {
  return sum(item.reasons.map((reason) => reason.quantity));
}

/** Faltas ainda sem motivo informado nesta função. */
export function getMissingReasonsCount(item: DailyItem): number {
  return Math.max(0, item.absenceQuantity - getReasonsTotal(item));
}

/** True quando a função tem qualquer ocorrência (falta OU folga). */
export function hasOccurrence(item: DailyItem): boolean {
  return item.absenceQuantity > 0 || item.dayOffQuantity > 0;
}

/** True quando os motivos desta função ainda não fecham com as faltas. */
export function isItemPending(item: DailyItem): boolean {
  return item.absenceQuantity !== getReasonsTotal(item);
}

/**
 * Resumo em tempo real dos cards do topo.
 *
 * FOLGA NUNCA ENTRA EM `totalAbsences` — são contadores independentes.
 * `impactedPositions` = funções com falta OU folga.
 */
export function buildSummary(conference: DailyConference): ConferenceSummary {
  const totalAbsences = sum(conference.items.map((item) => item.absenceQuantity));
  const totalDayOffs = sum(conference.items.map((item) => item.dayOffQuantity));
  const impactedPositions = conference.items.filter(hasOccurrence).length;

  // Motivos só são contados até o limite de faltas da função.
  const reasonsInformed = sum(
    conference.items.map((item) =>
      Math.min(item.absenceQuantity, getReasonsTotal(item)),
    ),
  );

  return {
    totalAbsences,
    totalDayOffs,
    impactedPositions,
    reasonsInformed,
    reasonsPending: Math.max(0, totalAbsences - reasonsInformed),
  };
}

/** Funções com ocorrência, na ordem da conferência — base da tela de confirmação. */
export function getOccurrences(conference: DailyConference): DailyItem[] {
  return conference.items.filter(hasOccurrence);
}
