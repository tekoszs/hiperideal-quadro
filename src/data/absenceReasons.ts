import type { AbsenceReason } from '@/types/domain';

/**
 * Motivos de falta iniciais.
 *
 * IMPORTANTE: FOLGA NÃO É MOTIVO DE FALTA e por isso não aparece aqui.
 * Folga é contabilizada em `DailyItem.dayOffQuantity`.
 */
export const OTHERS_REASON_ID = 'reason-outros';

/**
 * FASE 4.5 — o motivo PROVISÓRIO.
 *
 * "Aguardando justificativa" não é sinônimo de falta injustificada: ele diz o
 * que se sabe no momento do lançamento — a ausência ocorreu, o documento ainda
 * não chegou. Sem ele, o gerente teria de escolher entre inventar um motivo e
 * não conseguir enviar a conferência.
 *
 * O id é o mesmo do banco (migration 0018). Ele existe oficialmente em
 * `quadro_absence_reasons`, não só aqui.
 */
export const PENDING_REASON_ID = 'reason-aguardando-justificativa';

export const ABSENCE_REASONS: AbsenceReason[] = [
  { id: 'reason-atestado-medico', name: 'Atestado médico', active: true, displayOrder: 1, requiresObservation: false },
  { id: 'reason-falta-injustificada', name: 'Falta injustificada', active: true, displayOrder: 2, requiresObservation: false },
  { id: 'reason-ausencia-justificada', name: 'Ausência justificada', active: true, displayOrder: 3, requiresObservation: false },
  { id: 'reason-declaracao-comparecimento', name: 'Declaração / comparecimento', active: true, displayOrder: 4, requiresObservation: false },
  { id: 'reason-afastamento', name: 'Afastamento', active: true, displayOrder: 5, requiresObservation: false },
  { id: 'reason-licenca', name: 'Licença', active: true, displayOrder: 6, requiresObservation: false },
  { id: 'reason-suspensao', name: 'Suspensão', active: true, displayOrder: 7, requiresObservation: false },
  { id: OTHERS_REASON_ID, name: 'Outros', active: true, displayOrder: 8, requiresObservation: true },
  // Último de propósito: é a saída de exceção, não a primeira opção que o olho
  // encontra. E NÃO exige observação — pedir texto para dizer "ainda não sei"
  // faria o gerente escrever a mesma frase todo dia.
  {
    id: PENDING_REASON_ID,
    name: 'Aguardando justificativa',
    active: true,
    displayOrder: 9,
    requiresObservation: false,
  },
];

/**
 * Os motivos que podem RECEBER uma quantidade vinda de "Aguardando
 * justificativa". O provisório nunca é destino de si mesmo.
 */
export function getResolutionTargetReasons(): AbsenceReason[] {
  return getActiveReasons().filter((reason) => reason.id !== PENDING_REASON_ID);
}

export function getActiveReasons(): AbsenceReason[] {
  return ABSENCE_REASONS.filter((reason) => reason.active).sort(
    (a, b) => a.displayOrder - b.displayOrder,
  );
}

export function getReasonById(reasonId: string): AbsenceReason | undefined {
  return ABSENCE_REASONS.find((reason) => reason.id === reasonId);
}
