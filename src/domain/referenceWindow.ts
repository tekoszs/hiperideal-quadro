import type { ConferenceHistoryEntry, ConferenceStatus } from '@/types/domain';
import { businessNow, fromIsoDate, shiftIsoDate, toIsoDate } from '@/utils/date';

/**
 * FASE 4.3 — QUE DATAS O GERENTE PODE CONFERIR.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * ---------------------------
 * A tela trabalhava com D-1 fixo. Na segunda-feira, D-1 é o domingo — e o
 * sábado, que ninguém conferiu, ficava inalcançável. O gerente não tinha como
 * regularizar: a data que ele precisava não existia na tela.
 *
 * A resposta NÃO é tratar sábado e domingo como exceção. Fim de semana é só o
 * caso mais frequente de "faltou conferir um dia atrás"; feriado, folga do
 * gerente e esquecimento produzem exatamente a mesma pendência. A regra é uma
 * janela de dias anteriores, e qualquer pendência dentro dela é acessível.
 *
 * TUDO AQUI É PURO. Sem React e sem banco: quem chama passa o "hoje", e é o
 * que permite testar a segunda-feira sem esperar segunda-feira.
 *
 * Sem `today`, o padrão é `businessNow()` — a data civil da BAHIA, não a do
 * aparelho (fase 4.5). Um celular com o relógio em outro fuso não pode mudar de
 * que dia é a conferência; e a autoridade continua sendo o banco, que calcula a
 * mesma data em `quadro_business_date()`.
 */

/**
 * Quantos dias anteriores ficam disponíveis.
 *
 * Sete cobre o pior caso comum — voltar de uma semana de férias e regularizar
 * o que ficou. Não cobre "o mês inteiro", e isso é de propósito: quanto mais
 * longe a data, menos confiável é a memória de quem preenche.
 */
export const REFERENCE_WINDOW_DAYS = 7;

/** O primeiro dia do mês civil da operação. */
export function monthStartIso(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Último dia do mês civil da operação. */
export function monthEndIso(iso: string): string {
  const date = fromIsoDate(`${iso.slice(0, 7)}-01`);
  date.setMonth(date.getMonth() + 1, 0);
  return toIsoDate(date);
}

/** Mês anterior ou seguinte, representado pelo seu primeiro dia. */
export function shiftMonthIso(month: string, amount: number): string {
  const date = fromIsoDate(monthStartIso(month));
  date.setMonth(date.getMonth() + amount, 1);
  return toIsoDate(date);
}

/** Todos os dias do mês, começando na segunda-feira e completando a grade. */
export function monthCalendarDates(month: string): Array<string | null> {
  const first = fromIsoDate(monthStartIso(month));
  const mondayOffset = (first.getDay() + 6) % 7;
  const totalDays = Number(monthEndIso(month).slice(8));
  const cells: Array<string | null> = Array.from({ length: mondayOffset }, () => null);
  for (let day = 1; day <= totalDays; day += 1) {
    cells.push(`${month.slice(0, 7)}-${String(day).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export interface MonthlyProgress {
  done: number;
  pending: number;
  drafts: number;
  eligible: number;
}

/** Resumo do mês atual: hoje é pré-registro e não entra no denominador. */
export function monthlyProgress(
  dates: ReferenceDateInfo[],
  today: Date = businessNow(),
): MonthlyProgress {
  const hoje = toIsoDate(today);
  const mes = dates[0]?.date.slice(0, 7);
  const elegiveis = dates.filter((info) => info.date < hoje);
  const eligible = mes === hoje.slice(0, 7)
    ? Number(hoje.slice(8)) - 1
    : elegiveis.length;
  const done = elegiveis.filter((info) => info.status === 'SUBMITTED').length;
  const drafts = dates.filter((info) => info.status === 'DRAFT').length;
  return {
    done,
    pending: eligible - done - drafts,
    drafts,
    eligible,
  };
}

/** Situação de uma data dentro da janela. */
export type ReferenceDateStatus = ConferenceStatus | 'MISSING';

export interface ReferenceDateInfo {
  /** Data ISO (`YYYY-MM-DD`). */
  date: string;
  /**
   * `MISSING` não é status de banco: é a AUSÊNCIA de conferência naquela data.
   * Ele existe justamente porque "não conferido" e "conferido e deu zero" são
   * coisas diferentes — a mesma distinção que a Visão da Rede já faz.
   */
  status: ReferenceDateStatus;
  /** True quando ainda falta enviar: `MISSING`, `DRAFT` ou `REOPENED`. */
  pending: boolean;
  /** `SÁB 05/09` — para os chips. */
  label: string;
}

/** Datas do mês exibido, com dias futuros preservados para o calendário. */
export function monthlyReferenceDates(
  history: ConferenceHistoryEntry[],
  month: string,
  today: Date = businessNow(),
): ReferenceDateInfo[] {
  const porData = new Map(history.map((entrada) => [entrada.referenceDate, entrada.status]));
  const hoje = toIsoDate(today);
  return monthCalendarDates(month)
    .filter((date): date is string => date !== null)
    .map((date) => {
      const status = porData.get(date) ?? 'MISSING';
      return {
        date,
        status,
        pending: date < hoje && status !== 'SUBMITTED',
        label: shortDateLabel(date),
      };
    });
}

/** Mês atual: o gerente grava de 01 até hoje; envio termina em ontem. */
export function isMonthlyRecordableDate(
  iso: string,
  today: Date = businessNow(),
): boolean {
  const hoje = toIsoDate(today);
  return iso >= monthStartIso(hoje) && iso <= hoje;
}

export function isMonthlySubmittableDate(
  iso: string,
  today: Date = businessNow(),
): boolean {
  const hoje = toIsoDate(today);
  return iso >= monthStartIso(hoje) && iso < hoje;
}

/** `2026-09-05` -> `SÁB` */
export function shortWeekday(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  const nome = date.toLocaleDateString('pt-BR', { weekday: 'short' });
  // pt-BR devolve "sáb." ou "sáb": tira o ponto e sobe a caixa.
  return nome.replace(/\.$/, '').toUpperCase();
}

/** `2026-09-05` -> `05/09` — a segunda linha do chip. */
export function shortDayMonth(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
}

/** `2026-09-05` -> `SÁB 05/09` */
export function shortDateLabel(iso: string): string {
  return `${shortWeekday(iso)} ${shortDayMonth(iso)}`;
}

/**
 * As datas que o gerente pode escolher: D-1 até D-N, MAIS RECENTE PRIMEIRO.
 *
 * HOJE NÃO ENTRA, e não é detalhe de interface: a conferência informa o que
 * ACONTECEU num dia, e o dia de hoje ainda não terminou. Deixar hoje
 * disponível produziria conferências enviadas de manhã que já nascem
 * desatualizadas à tarde.
 */
export function selectableReferenceDates(
  today: Date = businessNow(),
  days: number = REFERENCE_WINDOW_DAYS,
): string[] {
  const hoje = toIsoDate(today);
  const datas: string[] = [];
  for (let i = 1; i <= days; i += 1) datas.push(shiftIsoDate(hoje, -i));
  return datas;
}

/**
 * A data pode ser conferida?
 *
 * Esta é a MESMA função que a tela usa para montar o seletor e que o serviço
 * usa para recusar uma gravação. Duas implementações da mesma regra divergem, e
 * divergir aqui significa a tela oferecer uma data que o serviço recusa — ou,
 * pior, o serviço aceitar uma data que a tela nunca deveria ter oferecido.
 */
export function isSelectableReferenceDate(
  iso: string,
  today: Date = businessNow(),
  days: number = REFERENCE_WINDOW_DAYS,
): boolean {
  const hoje = toIsoDate(today);
  if (iso >= hoje) return false; // hoje e futuro, fora
  return iso >= shiftIsoDate(hoje, -days);
}

/**
 * FASE 4.5 — HOJE PODE SER REGISTRADO, MAS NÃO PODE SER ENVIADO.
 *
 * São duas perguntas diferentes, e confundi-las é o que criava o problema:
 *
 *   "posso GRAVAR um lançamento nesta data?"  -> `isRecordableReferenceDate`
 *   "posso ENVIAR esta conferência?"          -> `isSelectableReferenceDate`
 *
 * O gerente lança a falta no próprio dia, enquanto lembra — é o PRÉ-REGISTRO.
 * O envio continua sendo só do passado, porque enviar é o ato que transforma o
 * lançamento em número oficial, e o dia de hoje ainda não terminou: uma
 * conferência de hoje enviada de manhã já nasce desatualizada à tarde.
 *
 * Nada disso é novo status no banco. Hoje em DRAFT é um DRAFT como qualquer
 * outro; o que muda é só como a tela o chama.
 */
export function isPreRegistrationDate(iso: string, today: Date = businessNow()): boolean {
  return iso === toIsoDate(today);
}

/** A data aceita GRAVAÇÃO de rascunho: da janela até HOJE, nunca o futuro. */
export function isRecordableReferenceDate(
  iso: string,
  today: Date = businessNow(),
  days: number = REFERENCE_WINDOW_DAYS,
): boolean {
  return isPreRegistrationDate(iso, today) || isSelectableReferenceDate(iso, today, days);
}

/** Limites do `<input type="date">`: da mais antiga da janela até D-1. */
export function referenceDateBounds(
  today: Date = businessNow(),
  days: number = REFERENCE_WINDOW_DAYS,
): { min: string; max: string } {
  const hoje = toIsoDate(today);
  return { min: shiftIsoDate(hoje, -days), max: shiftIsoDate(hoje, -1) };
}

/**
 * Cada data da janela com a situação dela.
 *
 * `history` são as conferências que a loja já tem. Data que não aparece lá
 * ainda não foi aberta — vira `MISSING`.
 */
export function buildReferenceDates(
  history: ConferenceHistoryEntry[],
  today: Date = businessNow(),
  days: number = REFERENCE_WINDOW_DAYS,
): ReferenceDateInfo[] {
  const porData = new Map(history.map((entrada) => [entrada.referenceDate, entrada.status]));

  return selectableReferenceDates(today, days).map((date) => {
    const status: ReferenceDateStatus = porData.get(date) ?? 'MISSING';
    return {
      date,
      status,
      // Só SUBMITTED está resolvido. Rascunho e reaberta continuam pendentes:
      // conferência que não foi enviada é conferência que não chegou.
      pending: status !== 'SUBMITTED',
      label: shortDateLabel(date),
    };
  });
}

/** Só as pendentes, MAIS ANTIGA PRIMEIRO — a ordem em que devem ser feitas. */
export function pendingReferenceDates(dates: ReferenceDateInfo[]): ReferenceDateInfo[] {
  return dates.filter((info) => info.pending).sort((a, b) => a.date.localeCompare(b.date));
}

/** Quanto da janela já está enviado. */
export interface WindowProgress {
  /** Datas da janela com status SUBMITTED. */
  done: number;
  /** Tamanho da janela — o denominador. */
  total: number;
}

/**
 * O progresso da janela: `0 de 7 concluídas`.
 *
 * NUMERADOR E DENOMINADOR SAEM DA MESMA LISTA, de propósito. "Concluída" aqui
 * é uma data DA JANELA que foi enviada — uma conferência de duas semanas atrás
 * não conta, porque também não aparece como pendência. Contar coisas de fora
 * faria o gerente ver "9 de 7 concluídas" numa loja em dia, ou "5 de 7" numa
 * loja que só deve dois dias.
 */
export function windowProgress(dates: ReferenceDateInfo[]): WindowProgress {
  return {
    done: dates.filter((info) => info.status === 'SUBMITTED').length,
    total: dates.length,
  };
}

/**
 * Que data abrir quando a tela carrega.
 *
 * A MAIS ANTIGA PENDENTE. Na segunda-feira isso significa o sábado, não o
 * domingo: quem regulariza pendência começa pela mais atrasada, e terminar em
 * ordem cronológica deixa o histórico coerente.
 *
 * Sem pendência nenhuma, abre D-1 — o caso normal de quem está em dia.
 */
export function suggestedReferenceDate(
  dates: ReferenceDateInfo[],
  today: Date = businessNow(),
): string {
  const pendentes = pendingReferenceDates(dates);
  if (pendentes.length > 0) return pendentes[0].date;
  return dates[0]?.date ?? shiftIsoDate(toIsoDate(today), -1);
}

/**
 * A próxima pendência depois de resolver `date` — para o "fazer agora".
 *
 * Ignora a própria data: ela acabou de ser enviada, e a lista de onde esta
 * função lê pode ainda não ter sido recarregada.
 */
export function nextPendingAfter(
  dates: ReferenceDateInfo[],
  date: string,
): ReferenceDateInfo | null {
  return pendingReferenceDates(dates).find((info) => info.date !== date) ?? null;
}
