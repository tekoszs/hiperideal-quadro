import type { ReferenceDateStatus } from '@/domain/referenceWindow';
import { formatBrDayMonth, formatBrTime } from '@/utils/date';

/**
 * FASE 4.4 — COMO O STATUS DA CONFERÊNCIA É DITO AO GERENTE.
 *
 * Puro de propósito: nada aqui sabe de React, e é por isso que a frase que o
 * gerente lê pode ser testada sem montar tela.
 *
 * POR QUE UM VOCABULÁRIO NOVO
 * ---------------------------
 * `STATUS_LABEL` dizia "Em preenchimento" — comprido demais para um chip de
 * 76px, e ele não cobre PENDENTE, que não existe no banco porque é a AUSÊNCIA
 * de conferência. Este módulo passou a ser a fonte única do que a tela do
 * gerente escreve: título, chip e selo do histórico dizem a mesma palavra.
 *
 * A LINGUAGEM DO SUPERVISOR NÃO MUDA. A lista da rede e o dashboard usam
 * `NETWORK_STATUS_LABEL`, que nada aqui toca — a fase 4.4 é só da tela do
 * gerente.
 */

export type ConferenceStatusTone = 'pending' | 'draft' | 'submitted' | 'reopened';

/**
 * FASE 4.5 — o que a tela mostra, que é mais do que o banco guarda.
 *
 * `PRE_REGISTRATION` NÃO EXISTE EM `quadro_conference_status`, e essa é a
 * decisão: um DRAFT com `reference_date = hoje` é a mesma linha, com o mesmo
 * id, que amanhã será apresentada como "Rascunho". Criar um status novo no
 * banco significaria uma máquina de estados maior, uma migração de dados na
 * virada do dia, e um valor que o supervisor teria de aprender a ignorar.
 *
 * A diferença é de LEITURA, então ela mora na leitura.
 */
export type ConferenceViewState = ReferenceDateStatus | 'PRE_REGISTRATION';

/**
 * Como esta conferência deve ser apresentada.
 *
 * `status` é o que está gravado; `isToday` responde se a data de referência é
 * o dia corrente. A virada do dia acontece sozinha: no dia seguinte a mesma
 * conferência simplesmente deixa de ser "hoje".
 */
export function conferenceViewState(
  status: ReferenceDateStatus,
  isToday: boolean,
): ConferenceViewState {
  return isToday && status !== 'SUBMITTED' ? 'PRE_REGISTRATION' : status;
}

/**
 * A palavra do status, EM MINÚSCULAS.
 *
 * A caixa é decisão de apresentação, não de conteúdo: o selo do título usa
 * `text-transform: uppercase` (PENDENTE) e o chip usa `capitalize`
 * (Pendente) — a mesma palavra, duas caixas, um só texto no DOM. É a
 * convenção que o resto do CSS deste projeto já segue.
 */
export const CONFERENCE_STATUS_WORD: Record<ConferenceViewState, string> = {
  MISSING: 'pendente',
  DRAFT: 'rascunho',
  SUBMITTED: 'enviada',
  REOPENED: 'reaberta',
  PRE_REGISTRATION: 'pré-registro',
};

/**
 * O tom visual de cada status.
 *
 * Verde só para ENVIADA — o único estado realmente resolvido. Rascunho e
 * reaberta não são "quase enviadas": são pendências, e pintá-las de verde
 * faria a tela mentir sobre o que já chegou ao supervisor.
 */
export const CONFERENCE_STATUS_TONE: Record<ConferenceViewState, ConferenceStatusTone> = {
  MISSING: 'pending',
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  REOPENED: 'reopened',
  // Âmbar: o pré-registro é uma pendência assumida, não um problema.
  PRE_REGISTRATION: 'pending',
};

/**
 * A frase de status, em português de gente.
 *
 * Substitui o texto técnico da fase 4.3 ("sábado, 05/09/2026 · ainda não
 * conferida"), que descrevia o estado do REGISTRO. Aqui a frase diz ao gerente
 * o que está acontecendo e o que ele pode fazer.
 */
export function conferenceStatusSentence(
  status: ConferenceViewState,
  submittedAt: string | null = null,
): string {
  switch (status) {
    case 'PRE_REGISTRATION':
      // Diz o que é E o que acontece depois: sem a segunda frase o gerente
      // procuraria o botão de enviar e acharia que a tela quebrou.
      return 'Este é um pré-registro. A conferência oficial poderá ser enviada posteriormente.';
    case 'SUBMITTED':
      // "Está bloqueada para edição" é a parte acionável: explica por que os
      // campos estão cinza antes que o gerente tente digitar e ache que quebrou.
      return submittedAt
        ? `Conferência enviada em ${formatBrDayMonth(submittedAt)} às ${formatBrTime(submittedAt)}. Está bloqueada para edição.`
        : 'Conferência enviada. Está bloqueada para edição.';
    case 'DRAFT':
      return 'Rascunho salvo. Você pode continuar o preenchimento.';
    case 'REOPENED':
      return 'Esta conferência foi reaberta para correção.';
    default:
      return 'Esta conferência ainda não foi enviada.';
  }
}
