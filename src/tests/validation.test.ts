import { describe, expect, it } from 'vitest';
import {
  setAbsenceQuantity,
  setDayOffQuantity,
  setItemObservation,
  setReasonObservation,
  setReasonQuantity,
} from '@/domain/conferenceFactory';
import { buildSummary, getReasonsTotal } from '@/domain/summary';
import { canEditConference, validateConference } from '@/domain/validation';
import { toNonNegativeInteger } from '@/utils/number';
import {
  POSITION_CAIXA,
  POSITION_PADARIA,
  REASON_ATESTADO,
  REASON_INJUSTIFICADA,
  REASON_OUTROS,
  VALIDATION_CONTEXT,
  makeDraft,
} from './fixtures';

const itemOf = (conference: ReturnType<typeof makeDraft>, positionId: string) => {
  const item = conference.items.find((candidate) => candidate.positionId === positionId);
  if (!item) throw new Error(`Função não encontrada: ${positionId}`);
  return item;
};

describe('Rascunho inicial', () => {
  it('cria uma linha por função com faltas e folgas em zero', () => {
    const draft = makeDraft();
    expect(draft.items).toHaveLength(4);
    expect(draft.items.every((item) => item.absenceQuantity === 0)).toBe(true);
    expect(draft.items.every((item) => item.dayOffQuantity === 0)).toBe(true);
    expect(draft.status).toBe('DRAFT');
    expect(draft.submittedAt).toBeNull();
  });

  it('rascunho sem nenhuma ocorrência é válido', () => {
    const result = validateConference(makeDraft(), VALIDATION_CONTEXT);
    expect(result.valid).toBe(true);
  });
});

// TESTE 2 — não aceitar números negativos.
describe('Números negativos', () => {
  it('normaliza qualquer entrada negativa para zero', () => {
    expect(toNonNegativeInteger(-1)).toBe(0);
    expect(toNonNegativeInteger('-5')).toBe(0);
    expect(toNonNegativeInteger(-0.9)).toBe(0);
    expect(toNonNegativeInteger('abc')).toBe(0);
    expect(toNonNegativeInteger(NaN)).toBe(0);
    expect(toNonNegativeInteger(3.7)).toBe(3);
    expect(toNonNegativeInteger('4')).toBe(4);
  });

  it('falta negativa vira zero', () => {
    const conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, -3);
    expect(itemOf(conference, POSITION_PADARIA).absenceQuantity).toBe(0);
  });

  it('folga negativa vira zero', () => {
    const conference = setDayOffQuantity(makeDraft(), POSITION_PADARIA, -7);
    expect(itemOf(conference, POSITION_PADARIA).dayOffQuantity).toBe(0);
  });

  it('quantidade negativa em motivo vira zero', () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, 2);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, -4);
    expect(getReasonsTotal(itemOf(conference, POSITION_PADARIA))).toBe(0);
  });
});

// TESTE 3 — uma falta exige motivo.
describe('Toda falta exige motivo', () => {
  it('bloqueia o envio quando há 1 falta sem motivo', () => {
    const conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, 1);
    const result = validateConference(conference, VALIDATION_CONTEXT);

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({
      code: 'MISSING_REASONS',
      positionId: POSITION_PADARIA,
    });
    // A mensagem aponta exatamente qual função está pendente.
    expect(result.issues[0].message).toContain('ATENDENTE ALIMENTOS - PADARIA');
  });

  it('libera quando o motivo é informado', () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);

    expect(validateConference(conference, VALIDATION_CONTEXT).valid).toBe(true);
  });

  it('zerar as faltas descarta os motivos e volta a ser válido', () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, 2);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 2);
    conference = setAbsenceQuantity(conference, POSITION_PADARIA, 0);

    expect(itemOf(conference, POSITION_PADARIA).reasons).toHaveLength(0);
    expect(validateConference(conference, VALIDATION_CONTEXT).valid).toBe(true);
  });
});

// TESTE 4 — três faltas exigem soma de motivos igual a 3.
describe('Soma dos motivos igual à quantidade de faltas', () => {
  it('recusa 3 faltas com apenas 2 motivos informados', () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_CAIXA, 3);
    conference = setReasonQuantity(conference, POSITION_CAIXA, REASON_ATESTADO, 2);

    const result = validateConference(conference, VALIDATION_CONTEXT);
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe('REASON_SUM_MISMATCH');
    expect(result.issues[0].message).toContain('2 de 3');
  });

  it('aceita 3 faltas divididas em 2 atestados + 1 injustificada', () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_CAIXA, 3);
    conference = setReasonQuantity(conference, POSITION_CAIXA, REASON_ATESTADO, 2);
    conference = setReasonQuantity(conference, POSITION_CAIXA, REASON_INJUSTIFICADA, 1);

    expect(getReasonsTotal(itemOf(conference, POSITION_CAIXA))).toBe(3);
    expect(validateConference(conference, VALIDATION_CONTEXT).valid).toBe(true);
  });

  it('recusa quando a soma dos motivos passa da quantidade de faltas', () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_CAIXA, 2);
    conference = setReasonQuantity(conference, POSITION_CAIXA, REASON_ATESTADO, 2);
    conference = setReasonQuantity(conference, POSITION_CAIXA, REASON_INJUSTIFICADA, 1);

    const result = validateConference(conference, VALIDATION_CONTEXT);
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe('REASON_SUM_MISMATCH');
  });
});

// TESTE 5 — motivo "Outros" exige observação.
describe('Motivo "Outros" exige observação', () => {
  it('bloqueia enquanto a observação estiver vazia', () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_OUTROS, 1);

    const result = validateConference(conference, VALIDATION_CONTEXT);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'OTHERS_REQUIRES_OBSERVATION')).toBe(true);
  });

  it('bloqueia quando a observação tem só espaços', () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_OUTROS, 1);
    conference = setReasonObservation(conference, POSITION_PADARIA, REASON_OUTROS, '    ');

    const result = validateConference(conference, VALIDATION_CONTEXT);
    expect(result.issues.some((issue) => issue.code === 'OTHERS_REQUIRES_OBSERVATION')).toBe(true);
  });

  it('libera com a observação preenchida', () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_OUTROS, 1);
    conference = setReasonObservation(
      conference,
      POSITION_PADARIA,
      REASON_OUTROS,
      'Convocação judicial',
    );

    expect(validateConference(conference, VALIDATION_CONTEXT).valid).toBe(true);
  });

  it('outros motivos não exigem observação', () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);

    expect(validateConference(conference, VALIDATION_CONTEXT).valid).toBe(true);
  });

  it('observação da função continua opcional', () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);
    expect(itemOf(conference, POSITION_PADARIA).observation).toBeNull();
    expect(validateConference(conference, VALIDATION_CONTEXT).valid).toBe(true);

    conference = setItemObservation(conference, POSITION_PADARIA, 'Avisou no dia anterior');
    expect(itemOf(conference, POSITION_PADARIA).observation).toBe('Avisou no dia anterior');
  });
});

// TESTE 6 — folga não entra no total de faltas.
describe('Folga não é falta', () => {
  it('folga não soma em totalAbsences e não exige motivo', () => {
    const conference = setDayOffQuantity(makeDraft(), POSITION_CAIXA, 6);
    const summary = buildSummary(conference);

    expect(summary.totalDayOffs).toBe(6);
    expect(summary.totalAbsences).toBe(0);
    expect(summary.reasonsPending).toBe(0);
    expect(validateConference(conference, VALIDATION_CONTEXT).valid).toBe(true);
  });

  it('faltas e folgas são contadores independentes', () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);
    conference = setDayOffQuantity(conference, POSITION_PADARIA, 4);
    conference = setDayOffQuantity(conference, POSITION_CAIXA, 2);

    const summary = buildSummary(conference);
    expect(summary.totalAbsences).toBe(1);
    expect(summary.totalDayOffs).toBe(6);
    // Duas funções impactadas: PADARIA (falta + folga) e CAIXA (só folga).
    expect(summary.impactedPositions).toBe(2);
  });

  it('nenhum motivo cadastrado é "folga"', () => {
    const nomes = VALIDATION_CONTEXT.reasons.map((reason) => reason.name.toLowerCase());
    expect(nomes.some((nome) => nome.includes('folga'))).toBe(false);
  });
});

describe('Resumo do exemplo do briefing', () => {
  it('reproduz Faltas 3, Folgas 2, Funções impactadas 2', () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);
    conference = setAbsenceQuantity(conference, POSITION_CAIXA, 2);
    conference = setReasonQuantity(conference, POSITION_CAIXA, REASON_ATESTADO, 1);
    conference = setReasonQuantity(conference, POSITION_CAIXA, REASON_INJUSTIFICADA, 1);
    conference = setDayOffQuantity(conference, POSITION_CAIXA, 2);

    const summary = buildSummary(conference);
    expect(summary.totalAbsences).toBe(3);
    expect(summary.totalDayOffs).toBe(2);
    expect(summary.impactedPositions).toBe(2);
    expect(summary.reasonsPending).toBe(0);
    expect(validateConference(conference, VALIDATION_CONTEXT).valid).toBe(true);
  });
});

// TESTE 7 (parte 1) — status enviado bloqueia edição.
describe('Conferência enviada', () => {
  it('canEditConference é false quando SUBMITTED', () => {
    const conference = { ...makeDraft(), status: 'SUBMITTED' as const };
    expect(canEditConference(conference)).toBe(false);
    expect(canEditConference(makeDraft())).toBe(true);
    expect(canEditConference({ ...makeDraft(), status: 'REOPENED' as const })).toBe(true);
  });

  it('validação recusa reenvio de conferência já enviada', () => {
    const conference = { ...makeDraft(), status: 'SUBMITTED' as const };
    const result = validateConference(conference, VALIDATION_CONTEXT);

    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe('ALREADY_SUBMITTED');
  });
});
