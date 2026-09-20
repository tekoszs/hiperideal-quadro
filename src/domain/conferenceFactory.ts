import type {
  DailyConference,
  DailyItem,
  DailyItemReason,
  Position,
} from '@/types/domain';
import { nowIso } from '@/utils/date';
import { toNonNegativeInteger } from '@/utils/number';
import { keepAsTyped, normalizeObservation } from '@/utils/text';

/**
 * Gera um UUID v4.
 *
 * IMPORTANTE: precisa ser UUID de verdade. As colunas `id` de
 * daily_conferences, daily_items, daily_item_reasons e audit_logs são `uuid`
 * no PostgreSQL — um id no formato antigo ("conf-m0abc-xyz") era recusado pelo
 * banco com "invalid input syntax for type uuid".
 */
export function createId(): string {
  const globalCrypto = globalThis.crypto;

  if (typeof globalCrypto?.randomUUID === 'function') {
    return globalCrypto.randomUUID();
  }

  // Navegador em contexto não seguro (http em IP da rede): randomUUID não existe.
  const bytes = new Uint8Array(16);
  if (typeof globalCrypto?.getRandomValues === 'function') {
    globalCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versão 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Cria a linha de uma função. Falta e folga SEMPRE começam em zero. */
export function createEmptyItem(positionId: string): DailyItem {
  return {
    id: createId(),
    positionId,
    absenceQuantity: 0,
    dayOffQuantity: 0,
    observation: null,
    reasons: [],
  };
}

/**
 * Cria um rascunho novo com uma linha zerada para cada função ativa da loja.
 * O gerente só altera as linhas onde houve ocorrência.
 */
export function createDraftConference(params: {
  storeId: string;
  referenceDate: string;
  positions: Position[];
  createdBy: string;
}): DailyConference {
  const timestamp = nowIso();
  return {
    id: createId(),
    storeId: params.storeId,
    referenceDate: params.referenceDate,
    status: 'DRAFT',
    createdBy: params.createdBy,
    submittedBy: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    submittedAt: null,
    items: params.positions
      .filter((position) => position.active)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((position) => createEmptyItem(position.id)),
  };
}

/**
 * Garante que a conferência tenha exatamente as funções ativas atuais.
 * Usado quando o catálogo muda depois que um rascunho já existia.
 */
export function reconcileItems(
  conference: DailyConference,
  positions: Position[],
): DailyConference {
  const byPosition = new Map(conference.items.map((item) => [item.positionId, item]));
  const items = positions
    .filter((position) => position.active)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((position) => byPosition.get(position.id) ?? createEmptyItem(position.id));

  return { ...conference, items };
}

function upsertReason(
  reasons: DailyItemReason[],
  reasonId: string,
  update: Partial<Omit<DailyItemReason, 'id' | 'reasonId'>>,
): DailyItemReason[] {
  const existing = reasons.find((reason) => reason.reasonId === reasonId);
  const next: DailyItemReason = existing
    ? { ...existing, ...update }
    : {
        id: createId(),
        reasonId,
        quantity: 0,
        observation: null,
        ...update,
      };

  const withoutTarget = reasons.filter((reason) => reason.reasonId !== reasonId);
  // Motivo zerado e sem NENHUM texto não precisa ser mantido.
  //
  // A checagem é por texto vazio, NÃO por `normalizeObservation` (que faz trim):
  // com trim, digitar o primeiro espaço em um motivo zerado apagaria o motivo
  // inteiro no meio da digitação. Observação só de espaços é descartada depois,
  // em `sanitizeConferenceForPersistence`.
  if (next.quantity <= 0 && (next.observation == null || next.observation === '')) {
    return withoutTarget;
  }
  return [...withoutTarget, next];
}

/** Atualiza a quantidade de faltas de uma função (nunca negativa). */
export function setAbsenceQuantity(
  conference: DailyConference,
  positionId: string,
  rawValue: unknown,
): DailyConference {
  const absenceQuantity = toNonNegativeInteger(rawValue);
  return mapItem(conference, positionId, (item) => ({
    ...item,
    absenceQuantity,
    // Zerou as faltas: os motivos deixam de fazer sentido.
    reasons: absenceQuantity === 0 ? [] : item.reasons,
  }));
}

/** Atualiza a quantidade de folgas de uma função (nunca negativa, nunca vira falta). */
export function setDayOffQuantity(
  conference: DailyConference,
  positionId: string,
  rawValue: unknown,
): DailyConference {
  return mapItem(conference, positionId, (item) => ({
    ...item,
    dayOffQuantity: toNonNegativeInteger(rawValue),
  }));
}

/** Atualiza a quantidade de um motivo específico dentro de uma função. */
export function setReasonQuantity(
  conference: DailyConference,
  positionId: string,
  reasonId: string,
  rawValue: unknown,
): DailyConference {
  const quantity = toNonNegativeInteger(rawValue);
  return mapItem(conference, positionId, (item) => ({
    ...item,
    reasons: upsertReason(item.reasons, reasonId, { quantity }),
  }));
}

/**
 * Atualiza a observação de um motivo (obrigatória quando o motivo é "Outros").
 *
 * DIGITAÇÃO: guarda o texto exato (`keepAsTyped`). Nada de `trim()` aqui —
 * ver a explicação em `src/utils/text.ts`.
 */
export function setReasonObservation(
  conference: DailyConference,
  positionId: string,
  reasonId: string,
  value: string,
): DailyConference {
  return mapItem(conference, positionId, (item) => ({
    ...item,
    reasons: upsertReason(item.reasons, reasonId, {
      observation: keepAsTyped(value),
    }),
  }));
}

/**
 * Observação livre da função (opcional).
 *
 * DIGITAÇÃO: guarda o texto exato (`keepAsTyped`). Nada de `trim()` aqui.
 */
export function setItemObservation(
  conference: DailyConference,
  positionId: string,
  value: string,
): DailyConference {
  return mapItem(conference, positionId, (item) => ({
    ...item,
    observation: keepAsTyped(value),
  }));
}

/**
 * ÚNICO ponto de limpeza de texto do sistema — roda na validação final e
 * imediatamente antes de gravar, nunca durante a digitação.
 *
 * Faz, para TODO campo de texto da conferência (observação da função,
 * observação de motivo e qualquer campo de justificativa que venha a existir):
 *  - `trim()` nas pontas;
 *  - vazio ou só espaços vira `null`;
 *  - descarta motivo zerado que sobrou só por causa de texto em branco.
 *
 * Espaços INTERNOS, acentos, pontuação e quebras de linha são preservados.
 * Como é um lugar só, campos novos não precisam de correção própria: basta
 * passarem por aqui.
 */
export function sanitizeConferenceForPersistence(
  conference: DailyConference,
): DailyConference {
  return {
    ...conference,
    items: conference.items.map((item) => ({
      ...item,
      observation: normalizeObservation(item.observation),
      reasons: item.reasons
        .map((reason) => ({
          ...reason,
          observation: normalizeObservation(reason.observation),
        }))
        .filter((reason) => reason.quantity > 0 || reason.observation !== null),
    })),
  };
}

function mapItem(
  conference: DailyConference,
  positionId: string,
  updater: (item: DailyItem) => DailyItem,
): DailyConference {
  return {
    ...conference,
    updatedAt: nowIso(),
    items: conference.items.map((item) =>
      item.positionId === positionId ? updater(item) : item,
    ),
  };
}

/** Quantidade lançada em um motivo dentro de uma função. */
export function getReasonQuantity(item: DailyItem, reasonId: string): number {
  return item.reasons.find((reason) => reason.reasonId === reasonId)?.quantity ?? 0;
}

/** Observação lançada em um motivo dentro de uma função. */
export function getReasonObservation(item: DailyItem, reasonId: string): string {
  return item.reasons.find((reason) => reason.reasonId === reasonId)?.observation ?? '';
}
