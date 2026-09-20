import type { DailyConference } from '@/types/domain';
import { PENDING_REASON_ID } from '@/data/absenceReasons';
import { businessNow, toIsoDate } from '@/utils/date';

/**
 * FASE 4.5 — AS FALTAS QUE AINDA ESPERAM UM MOTIVO.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * ---------------------------
 * O fato da ausência e o motivo dela acontecem em momentos diferentes. O
 * associado falta no sábado; o atestado chega na terça. Até a fase 4.4 o
 * gerente tinha duas saídas ruins: inventar um motivo (registrar uma acusação
 * que ninguém apurou) ou não enviar a conferência (esconder uma falta que
 * aconteceu de verdade).
 *
 * "Aguardando justificativa" é a terceira saída, e ela é honesta: a falta entra
 * no número oficial, e o motivo fica marcado como pendente até alguém trazer o
 * documento.
 *
 * TUDO AQUI É PURO. Sem React e sem banco — quem chama passa o "hoje", e é o
 * que permite testar "aguardando há 3 dias" sem esperar três dias. Sem `today`,
 * o padrão é `businessNow()`: a data civil da Bahia, não a do aparelho.
 */

export interface PendingJustification {
  /** Conferência a que a pendência pertence — sempre uma ENVIADA. */
  conferenceId: string;
  /** Item (função) dentro da conferência. É o que a RPC de resolução recebe. */
  itemId: string;
  storeId: string;
  referenceDate: string;
  positionId: string;
  /** Quantas faltas daquela função ainda estão sem motivo definitivo. */
  quantity: number;
  /** Dias corridos entre a data da falta e hoje. */
  waitingDays: number;
}

/** Quantas faltas de um item estão em "Aguardando justificativa". */
export function pendingQuantityOf(item: { reasons: Array<{ reasonId: string; quantity: number }> }): number {
  return item.reasons
    .filter((reason) => reason.reasonId === PENDING_REASON_ID)
    .reduce((total, reason) => total + Math.max(0, reason.quantity), 0);
}

/** Dias corridos entre a data da falta e hoje. Nunca negativo. */
export function waitingDaysSince(referenceDate: string, today: Date = businessNow()): number {
  const [ay, am, ad] = referenceDate.split('-').map(Number);
  const inicio = Date.UTC(ay, am - 1, ad);
  const hojeIso = toIsoDate(today);
  const [by, bm, bd] = hojeIso.split('-').map(Number);
  const fim = Date.UTC(by, bm - 1, bd);
  return Math.max(0, Math.round((fim - inicio) / 86_400_000));
}

/**
 * As pendências de justificativa de uma loja, MAIS ANTIGA PRIMEIRO.
 *
 * SÓ CONFERÊNCIAS ENVIADAS ENTRAM. Num rascunho não há o que "resolver": o
 * gerente troca o motivo na tela e salva, pelo caminho normal. A resolução
 * auditada existe justamente porque a conferência enviada é imutável.
 */
export function collectPendingJustifications(
  conferences: DailyConference[],
  today: Date = businessNow(),
): PendingJustification[] {
  const pendencias: PendingJustification[] = [];

  for (const conference of conferences) {
    if (conference.status !== 'SUBMITTED') continue;

    for (const item of conference.items) {
      const quantity = pendingQuantityOf(item);
      if (quantity <= 0) continue;

      pendencias.push({
        conferenceId: conference.id,
        itemId: item.id,
        storeId: conference.storeId,
        referenceDate: conference.referenceDate,
        positionId: item.positionId,
        quantity,
        waitingDays: waitingDaysSince(conference.referenceDate, today),
      });
    }
  }

  return pendencias.sort(
    (a, b) =>
      a.referenceDate.localeCompare(b.referenceDate) ||
      a.positionId.localeCompare(b.positionId),
  );
}

/** Quantas faltas, no total, esperam justificativa. */
export function totalPendingQuantity(pendings: PendingJustification[]): number {
  return pendings.reduce((total, pending) => total + pending.quantity, 0);
}
