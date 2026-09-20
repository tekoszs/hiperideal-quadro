import type { AbsenceReason, DailyConference, Position } from '@/types/domain';
import { ABSENCE_REASONS } from '@/data/absenceReasons';
import { createDraftConference } from '@/domain/conferenceFactory';

/** Subconjunto do catálogo real, suficiente para exercitar as regras. */
export const TEST_POSITIONS: Position[] = [
  {
    id: 'pos-atendente-alimentos-padaria',
    name: 'ATENDENTE ALIMENTOS - PADARIA',
    functionGroup: 'ATENDENTE ALIMENTOS',
    sector: 'PADARIA',
    active: true,
    displayOrder: 1,
  },
  {
    id: 'pos-atendente-alimentos-frutas',
    name: 'ATENDENTE ALIMENTOS - FRUTAS',
    functionGroup: 'ATENDENTE ALIMENTOS',
    sector: 'FRUTAS',
    active: true,
    displayOrder: 2,
  },
  {
    id: 'pos-operador-de-caixa',
    name: 'OPERADOR DE CAIXA',
    functionGroup: 'OPERADOR DE CAIXA',
    sector: null,
    active: true,
    displayOrder: 3,
  },
  {
    id: 'pos-repositor-horti',
    name: 'REPOSITOR - HORTI',
    functionGroup: 'REPOSITOR',
    sector: 'HORTI',
    active: true,
    displayOrder: 4,
  },
];

export const TEST_REASONS: AbsenceReason[] = ABSENCE_REASONS;

export const REASON_ATESTADO = 'reason-atestado-medico';
export const REASON_INJUSTIFICADA = 'reason-falta-injustificada';
export const REASON_OUTROS = 'reason-outros';

export const POSITION_PADARIA = 'pos-atendente-alimentos-padaria';
export const POSITION_CAIXA = 'pos-operador-de-caixa';

export function makeDraft(referenceDate = '2026-09-05'): DailyConference {
  return createDraftConference({
    storeId: 'store-124',
    referenceDate,
    positions: TEST_POSITIONS,
    createdBy: 'gerente-teste',
  });
}

export const VALIDATION_CONTEXT = {
  positions: TEST_POSITIONS,
  reasons: TEST_REASONS,
};
