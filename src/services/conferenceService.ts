import type {
  AbsenceReason,
  ConferenceHistoryEntry,
  DailyConference,
  Position,
  ValidationResult,
} from '@/types/domain';
import {
  createDraftConference,
  reconcileItems,
  sanitizeConferenceForPersistence,
} from '@/domain/conferenceFactory';
import { buildSummary } from '@/domain/summary';
import { canEditConference, validateConference } from '@/domain/validation';
import { getStorageAdapter, type StorageAdapter } from '@/services/storage';
import {
  isPreRegistrationDate,
  isMonthlyRecordableDate,
  isMonthlySubmittableDate,
} from '@/domain/referenceWindow';
import {
  collectPendingJustifications,
  type PendingJustification,
} from '@/domain/pendingJustification';
import { PENDING_REASON_ID } from '@/data/absenceReasons';
import { businessNow, formatBrDate, nowIso, toIsoDate } from '@/utils/date';
import { monthEndIso, monthStartIso } from '@/domain/referenceWindow';

export class ConferenceLockedError extends Error {
  constructor() {
    super('Esta conferência já foi enviada e está bloqueada para edição.');
    this.name = 'ConferenceLockedError';
  }
}

/** Data fora da janela permitida: futuro, ou antiga demais. */
export class InvalidReferenceDateError extends Error {
  constructor(referenceDate: string) {
    super(
      `A conferência é de ${formatBrDate(referenceDate)}, que está fora do período permitido. ` +
      'Só é possível criar conferências no mês atual, até hoje.',
    );
    this.name = 'InvalidReferenceDateError';
  }
}

/** Tentou ENVIAR a conferência de hoje. O dia ainda não terminou. */
export class TodayNotSubmittableError extends Error {
  constructor(referenceDate: string) {
    super(
      `A conferência de ${formatBrDate(referenceDate)} é o pré-registro de hoje e ainda não ` +
        'pode ser enviada: o dia não terminou. Ela poderá ser enviada a partir de amanhã.',
    );
    this.name = 'TodayNotSubmittableError';
  }
}

/**
 * ESTAS CHECAGENS EXISTEM APESAR DE A TELA JÁ FILTRAR, e é por isso que estão
 * aqui: a tela é conveniência, o serviço é regra — e, desde a fase 4.5, o BANCO
 * é a autoridade final (as duas RPCs recusam sozinhas, mesmo chamadas por curl).
 *
 * São TRÊS camadas de propósito, e cada uma responde a um público: a tela evita
 * que o gerente tente; o serviço evita que um estado manipulado no DevTools
 * passe; a RPC evita que qualquer cliente HTTP passe.
 *
 * As funções são AS MESMAS que montam o seletor. Uma segunda implementação
 * divergiria, e divergir aqui é a tela oferecer o que o serviço recusa.
 */

/** Gravar rascunho: hoje pode (pré-registro), futuro não. */
function assertRecordableDate(referenceDate: string): void {
  if (!isMonthlyRecordableDate(referenceDate)) {
    throw new InvalidReferenceDateError(referenceDate);
  }
}

/** Enviar: só o passado dentro da janela. */
function assertSubmittableDate(referenceDate: string): void {
  if (isPreRegistrationDate(referenceDate)) {
    throw new TodayNotSubmittableError(referenceDate);
  }
  if (!isMonthlySubmittableDate(referenceDate)) {
    throw new InvalidReferenceDateError(referenceDate);
  }
}

export interface SubmitFailure {
  ok: false;
  validation: ValidationResult;
}

export interface SubmitSuccess {
  ok: true;
  conference: DailyConference;
}

export type SubmitResult = SubmitSuccess | SubmitFailure;

function adapter(): StorageAdapter {
  return getStorageAdapter();
}

/**
 * Carrega a conferência da loja NA DATA PEDIDA, ou cria um rascunho zerado.
 *
 * Uma conferência é sempre `store_id + reference_date` — e o banco cobra isso
 * com `quadro_daily_conferences_store_date_key`. Carregar antes de criar é o
 * que impede duas conferências para a mesma loja no mesmo dia; a constraint é a
 * segunda barreira, para o caso de duas abas abertas ao mesmo tempo.
 *
 * Se o catálogo de funções mudou, o rascunho é reconciliado sem perder o que já
 * foi digitado.
 */
export async function loadOrCreateConference(params: {
  storeId: string;
  referenceDate: string;
  positions: Position[];
  createdBy: string;
}): Promise<DailyConference> {
  const existing = await adapter().getConference(params.storeId, params.referenceDate);

  if (existing) {
    return existing.status === 'SUBMITTED'
      ? existing
      : reconcileItems(existing, params.positions);
  }

  assertRecordableDate(params.referenceDate);

  return createDraftConference(params);
}

/**
 * Salva o rascunho. Recusa se a conferência já foi enviada.
 *
 * É AQUI que o texto é limpo (trim, vazio -> null) — nunca durante a digitação.
 * Este é um dos dois únicos pontos que chamam
 * `sanitizeConferenceForPersistence`.
 */
export async function saveDraft(conference: DailyConference): Promise<DailyConference> {
  if (!canEditConference(conference)) {
    throw new ConferenceLockedError();
  }
  assertRecordableDate(conference.referenceDate);

  return adapter().saveConference({
    ...sanitizeConferenceForPersistence(conference),
    status: conference.status === 'REOPENED' ? 'REOPENED' : 'DRAFT',
    updatedAt: nowIso(),
  });
}

/**
 * Finaliza e envia.
 *
 * A validação da aplicação roda primeiro para dar mensagem imediata ao gerente;
 * o banco valida DE NOVO dentro da RPC, que é a autoridade final. Se houver
 * pendência, NADA é enviado.
 *
 * A auditoria do envio é gravada pelo banco, na mesma transação — não depende
 * de uma chamada extra do navegador.
 */
export async function submitConference(
  conference: DailyConference,
  context: { positions: Position[]; reasons: AbsenceReason[] },
): Promise<SubmitResult> {
  assertSubmittableDate(conference.referenceDate);

  // Limpa ANTES de validar: uma observação só com espaços tem que reprovar no
  // motivo "Outros", e é o texto já limpo que vai para o banco.
  const limpa = sanitizeConferenceForPersistence(conference);

  const validation = validateConference(limpa, context);
  if (!validation.valid) {
    return { ok: false, validation };
  }

  const saved = await adapter().submitConference(limpa);
  return { ok: true, conference: saved };
}

function toHistoryEntry(conference: DailyConference): ConferenceHistoryEntry {
  const summary = buildSummary(conference);
  return {
    id: conference.id,
    referenceDate: conference.referenceDate,
    totalAbsences: summary.totalAbsences,
    totalDayOffs: summary.totalDayOffs,
    status: conference.status,
    submittedAt: conference.submittedAt,
  };
}

/** Histórico simples do gerente: data, faltas, folgas e status. */
export async function listHistory(
  storeId: string,
  limit = 15,
): Promise<ConferenceHistoryEntry[]> {
  const conferences = await adapter().listConferences(storeId, limit);
  return conferences.map(toHistoryEntry);
}

/** O que a tela do gerente precisa saber sobre as conferências da loja. */
export interface StoreConferencesSnapshot {
  history: ConferenceHistoryEntry[];
  pending: PendingJustification[];
}

/**
 * Histórico e pendências de justificativa em UMA leitura.
 *
 * As duas coisas saem da mesma lista de conferências, então pedi-las
 * separadamente seria uma segunda viagem ao banco para reler exatamente os
 * mesmos registros. A tela chama isto uma vez por carga e uma vez depois de
 * cada gravação.
 */
export async function loadStoreConferences(
  storeId: string,
  limit = 15,
  today: Date = businessNow(),
): Promise<StoreConferencesSnapshot> {
  const todayIso = toIsoDate(today);
  const conferences = await adapter().listConferences(storeId, limit, {
    start: monthStartIso(todayIso),
    end: monthEndIso(todayIso),
  });
  return {
    history: conferences.map(toHistoryEntry),
    pending: collectPendingJustifications(conferences, today),
  };
}

/**
 * FASE 4.5 — resolve uma justificativa pendente de uma conferência ENVIADA.
 *
 * NÃO REABRE NADA. A conferência continua SUBMITTED, o total de faltas continua
 * idêntico, e a única mudança é a quantidade sair de "Aguardando justificativa"
 * e entrar no motivo definitivo:
 *
 *   antes:  faltas = 2 | Atestado = 1 | Aguardando = 1
 *   depois: faltas = 2 | Atestado = 2 | Aguardando = 0
 *
 * Quem faz o trabalho de verdade é a RPC `quadro_rpc_resolve_pending_absence_reason`,
 * numa transação só, com trava na linha pendente e auditoria junto. Este
 * serviço só recusa o que dá para recusar sem ir ao banco.
 */
export async function resolvePendingReason(params: {
  itemId: string;
  toReasonId: string;
  quantity: number;
  observation?: string | null;
}): Promise<void> {
  if (params.quantity <= 0) {
    throw new Error('Quantidade a resolver precisa ser maior que zero.');
  }
  if (params.toReasonId === PENDING_REASON_ID) {
    throw new Error('O motivo de destino não pode ser "Aguardando justificativa".');
  }

  await adapter().resolvePendingReason({
    itemId: params.itemId,
    toReasonId: params.toReasonId,
    quantity: params.quantity,
    observation: params.observation ?? null,
  });
}

/** Nome do adaptador ativo — exibido no rodapé para o gerente saber onde está salvando. */
export function getStorageName(): string {
  return adapter().name;
}
