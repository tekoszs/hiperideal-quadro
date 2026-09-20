import type {
  AbsenceReason,
  DailyConference,
  DailyItem,
  Position,
  ValidationIssue,
  ValidationResult,
} from '@/types/domain';
import { getReasonsTotal, hasOccurrence } from '@/domain/summary';
import { hasText } from '@/utils/text';

interface ValidationContext {
  positions: Position[];
  reasons: AbsenceReason[];
}

/** Conferência já enviada não pode mais ser editada. */
export function canEditConference(conference: DailyConference): boolean {
  return conference.status !== 'SUBMITTED';
}

function positionName(positions: Position[], positionId: string): string {
  return positions.find((position) => position.id === positionId)?.name ?? positionId;
}

/** Valida uma única função. Exportado para destacar a linha problemática na tela. */
export function validateItem(
  item: DailyItem,
  context: ValidationContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const name = positionName(context.positions, item.positionId);

  if (item.absenceQuantity < 0) {
    issues.push({
      code: 'NEGATIVE_ABSENCE',
      positionId: item.positionId,
      positionName: name,
      message: `${name}: a quantidade de faltas não pode ser negativa.`,
    });
  }

  if (item.dayOffQuantity < 0) {
    issues.push({
      code: 'NEGATIVE_DAY_OFF',
      positionId: item.positionId,
      positionName: name,
      message: `${name}: a quantidade de folgas não pode ser negativa.`,
    });
  }

  if (item.absenceQuantity > 0) {
    const reasonsTotal = getReasonsTotal(item);

    if (reasonsTotal === 0) {
      issues.push({
        code: 'MISSING_REASONS',
        positionId: item.positionId,
        positionName: name,
        message: `${name}: informe o motivo das ${item.absenceQuantity} falta(s).`,
      });
    } else if (reasonsTotal !== item.absenceQuantity) {
      issues.push({
        code: 'REASON_SUM_MISMATCH',
        positionId: item.positionId,
        positionName: name,
        message:
          `${name}: motivos informados ${reasonsTotal} de ${item.absenceQuantity}. ` +
          'A soma dos motivos precisa ser igual à quantidade de faltas.',
      });
    }
  }

  // Motivo que exige observação (Outros) não pode ficar sem texto.
  for (const itemReason of item.reasons) {
    if (itemReason.quantity <= 0) continue;
    const reason = context.reasons.find((candidate) => candidate.id === itemReason.reasonId);
    if (reason?.requiresObservation && !hasText(itemReason.observation)) {
      issues.push({
        code: 'OTHERS_REQUIRES_OBSERVATION',
        positionId: item.positionId,
        positionName: name,
        message: `${name}: o motivo "${reason.name}" exige observação.`,
      });
    }
  }

  return issues;
}

/**
 * Valida a conferência inteira antes de finalizar.
 *
 * Regras:
 *  - faltas e folgas não podem ser negativas;
 *  - toda falta precisa de motivo;
 *  - a soma dos motivos precisa ser igual à quantidade de faltas;
 *  - motivo "Outros" exige observação;
 *  - conferência já enviada não pode ser reenviada.
 */
export function validateConference(
  conference: DailyConference,
  context: ValidationContext,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (conference.status === 'SUBMITTED') {
    issues.push({
      code: 'ALREADY_SUBMITTED',
      positionId: null,
      positionName: null,
      message: 'Esta conferência já foi enviada e está bloqueada para edição.',
    });
    return { valid: false, issues };
  }

  for (const item of conference.items) {
    issues.push(...validateItem(item, context));
  }

  return { valid: issues.length === 0, issues };
}

/** Ids das funções com pendência — usado para destacar as linhas na lista. */
export function getPendingPositionIds(issues: ValidationIssue[]): Set<string> {
  return new Set(
    issues
      .map((issue) => issue.positionId)
      .filter((positionId): positionId is string => positionId !== null),
  );
}

/**
 * Uma conferência sem nenhuma ocorrência é válida (dia sem falta e sem folga),
 * mas a tela avisa para o gerente confirmar que foi intencional.
 */
export function isEmptyConference(conference: DailyConference): boolean {
  return !conference.items.some(hasOccurrence);
}
