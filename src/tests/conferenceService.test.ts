import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  setAbsenceQuantity,
  setDayOffQuantity,
  setReasonQuantity,
} from '@/domain/conferenceFactory';
import {
  ConferenceLockedError,
  listHistory,
  loadOrCreateConference,
  saveDraft,
  submitConference,
} from '@/services/conferenceService';
import {
  LocalStorageAdapter,
  MemoryStore,
  setStorageAdapter,
} from '@/services/storage';
import {
  POSITION_CAIXA,
  POSITION_PADARIA,
  REASON_ATESTADO,
  TEST_POSITIONS,
  TEST_REASONS,
  makeDraft,
} from './fixtures';

const CONTEXT = { positions: TEST_POSITIONS, reasons: TEST_REASONS };

beforeEach(() => {
  // Adaptador em memória: prova que a tela não depende de localStorage real.
  setStorageAdapter(new LocalStorageAdapter(new MemoryStore()));
});

afterEach(() => {
  setStorageAdapter(null);
});

describe('Camada de armazenamento com adaptador', () => {
  it('salva e recupera o rascunho pelo serviço, sem tocar em localStorage', async () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, 2);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 2);
    await saveDraft(conference);

    const reloaded = await loadOrCreateConference({
      storeId: 'store-124',
      referenceDate: '2026-09-05',
      positions: TEST_POSITIONS,
      createdBy: 'gerente-teste',
    });

    const item = reloaded.items.find((i) => i.positionId === POSITION_PADARIA);
    expect(item?.absenceQuantity).toBe(2);
    expect(reloaded.status).toBe('DRAFT');
  });

  it('cria um rascunho zerado quando ainda não existe conferência do dia', async () => {
    const created = await loadOrCreateConference({
      storeId: 'store-124',
      referenceDate: '2026-09-04',
      positions: TEST_POSITIONS,
      createdBy: 'gerente-teste',
    });

    expect(created.items).toHaveLength(TEST_POSITIONS.length);
    expect(created.items.every((item) => item.absenceQuantity === 0)).toBe(true);
  });
});

describe('Finalizar conferência', () => {
  it('não envia quando existe falta sem motivo e aponta a função pendente', async () => {
    const conference = setAbsenceQuantity(makeDraft(), POSITION_CAIXA, 3);
    const result = await submitConference(conference, CONTEXT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('deveria ter falhado');
    expect(result.validation.issues[0].positionName).toBe('OPERADOR DE CAIXA');

    // Nada foi persistido como enviado.
    const history = await listHistory('store-124');
    expect(history).toHaveLength(0);
  });

  it('envia quando tudo fecha e marca status SUBMITTED', async () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);
    conference = setDayOffQuantity(conference, POSITION_CAIXA, 2);

    const result = await submitConference(conference, CONTEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('deveria ter enviado');
    expect(result.conference.status).toBe('SUBMITTED');
    expect(result.conference.submittedAt).not.toBeNull();
  });
});

// TESTE 7 — conferência enviada fica bloqueada para edição.
describe('Bloqueio após o envio', () => {
  it('saveDraft recusa conferência já enviada', async () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);

    const sent = await submitConference(conference, CONTEXT);
    if (!sent.ok) throw new Error('deveria ter enviado');

    const alterada = setAbsenceQuantity(sent.conference, POSITION_PADARIA, 5);
    await expect(saveDraft(alterada)).rejects.toBeInstanceOf(ConferenceLockedError);
  });

  it('recarregar traz a conferência enviada intacta e bloqueada', async () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);
    await submitConference(conference, CONTEXT);

    const reloaded = await loadOrCreateConference({
      storeId: 'store-124',
      referenceDate: '2026-09-05',
      positions: TEST_POSITIONS,
      createdBy: 'gerente-teste',
    });

    expect(reloaded.status).toBe('SUBMITTED');
    expect(
      reloaded.items.find((item) => item.positionId === POSITION_PADARIA)?.absenceQuantity,
    ).toBe(1);
  });

  it('reenviar conferência já enviada é recusado', async () => {
    let conference = setAbsenceQuantity(makeDraft(), POSITION_PADARIA, 1);
    conference = setReasonQuantity(conference, POSITION_PADARIA, REASON_ATESTADO, 1);
    const sent = await submitConference(conference, CONTEXT);
    if (!sent.ok) throw new Error('deveria ter enviado');

    const again = await submitConference(sent.conference, CONTEXT);
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error('não deveria reenviar');
    expect(again.validation.issues[0].code).toBe('ALREADY_SUBMITTED');
  });
});

describe('Histórico do gerente', () => {
  it('lista data, faltas, folgas e status, do mais recente para o mais antigo', async () => {
    let dia5 = setAbsenceQuantity(makeDraft('2026-09-05'), POSITION_PADARIA, 1);
    dia5 = setReasonQuantity(dia5, POSITION_PADARIA, REASON_ATESTADO, 1);
    dia5 = setDayOffQuantity(dia5, POSITION_CAIXA, 6);
    await submitConference(dia5, CONTEXT);

    const dia4 = setDayOffQuantity(makeDraft('2026-09-04'), POSITION_CAIXA, 7);
    await submitConference(dia4, CONTEXT);

    const history = await listHistory('store-124');
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      referenceDate: '2026-09-05',
      totalAbsences: 1,
      totalDayOffs: 6,
      status: 'SUBMITTED',
    });
    expect(history[1]).toMatchObject({
      referenceDate: '2026-09-04',
      totalAbsences: 0,
      totalDayOffs: 7,
    });
  });
});
