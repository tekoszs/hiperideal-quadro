/** Utilitários de data em fuso local, sem dependência externa. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * FASE 4.5 — O FUSO DA OPERAÇÃO.
 *
 * As 34 lojas ficam na Bahia, e "que dia é hoje" é uma pergunta da OPERAÇÃO,
 * não do aparelho: um celular configurado em outro fuso, um tablet que voltou
 * de viagem com o relógio errado, ou um navegador em UTC não podem mudar de
 * que dia é a conferência.
 *
 * A autoridade continua sendo o banco — `quadro_business_date()` calcula a
 * mesma data lá, e é ela que autoriza. Aqui é para a tela não OFERECER uma data
 * que o servidor vai recusar.
 */
export const BUSINESS_TIME_ZONE = 'America/Bahia';

/**
 * A data civil da Bahia, em ISO, independente do fuso do aparelho.
 *
 * `en-CA` foi escolhido porque formata exatamente como `YYYY-MM-DD` — é o
 * jeito de pedir ao `Intl` a data de outro fuso sem montar a string à mão.
 */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * O "hoje" da operação, como `Date`, para as funções puras que recebem um
 * `today` injetável.
 *
 * Devolve o MEIO-DIA LOCAL do dia civil da Bahia. Meio-dia porque as funções
 * puras usam `toIsoDate` (fuso local) para voltar à string: com meio-dia,
 * nenhuma conversão de fuso atravessa a meia-noite e a data sobrevive
 * intacta — a mesma razão pela qual `fromIsoDate` já usava meio-dia.
 *
 * Os testes continuam injetando o `today` que quiserem: nada aqui força fuso
 * em quem passa a data.
 */
export function businessNow(now: Date = new Date()): Date {
  return fromIsoDate(businessToday(now));
}

/** Converte um Date para `YYYY-MM-DD` usando o fuso LOCAL (nunca UTC). */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Converte `YYYY-MM-DD` para um Date local ao meio-dia (evita salto de fuso). */
export function fromIsoDate(iso: string): Date {
  if (!ISO_DATE.test(iso)) {
    throw new Error(`Data inválida: ${iso}. Formato esperado: YYYY-MM-DD.`);
  }
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/**
 * Data de referência da conferência: SEMPRE o dia anterior (D-1).
 * Se hoje for 06/09/2026, retorna 2026-09-05.
 */
export function getReferenceDate(today: Date = new Date()): string {
  const previous = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0, 0);
  previous.setDate(previous.getDate() - 1);
  return toIsoDate(previous);
}

/**
 * Anda dias em uma data ISO, sem sair do fuso local.
 * `shiftIsoDate('2026-09-05', -1)` -> `2026-09-04`
 *
 * Usa `fromIsoDate` (meio-dia local), então atravessar horário de verão não
 * faz a data pular um dia.
 */
export function shiftIsoDate(iso: string, days: number): string {
  const date = fromIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** True quando a data ISO é posterior a hoje. */
export function isFutureIsoDate(iso: string, today: Date = new Date()): boolean {
  return iso > toIsoDate(today);
}

/** `2026-09-05` -> `05/09/2026` */
export function formatBrDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

/** `2026-09-05` -> `sábado, 05/09/2026` */
export function formatLongBrDate(iso: string): string {
  return `${weekdayName(iso)}, ${formatBrDate(iso)}`;
}

/**
 * `2026-09-05` -> `sábado`
 *
 * Em MINÚSCULAS, como o pt-BR escreve. Quem quiser "Sábado" usa
 * `text-transform: capitalize` — a caixa é apresentação.
 */
export function weekdayName(iso: string): string {
  return fromIsoDate(iso).toLocaleDateString('pt-BR', { weekday: 'long' });
}

/** Data/hora ISO completa para carimbos de auditoria. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** `2026-09-05T11:42:00.000Z` -> `08:42` (fuso local). Só a hora do envio. */
export function formatBrTime(isoTimestamp: string | null): string {
  if (!isoTimestamp) return '—';
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * `2026-09-05T11:00:00.000Z` -> `05/09` (fuso local).
 *
 * Dia e mês, sem o ano: usado na frase "Conferência enviada em 05/09 às 08:14",
 * onde o ano é ruído — o envio é sempre da última semana.
 */
export function formatBrDayMonth(isoTimestamp: string | null): string {
  if (!isoTimestamp) return '—';
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** `2026-09-05T18:30:00.000Z` -> `05/09/2026 15:30` (fuso local). */
export function formatBrDateTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
