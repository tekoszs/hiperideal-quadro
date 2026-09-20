import type { DateRange, PeriodKind, ResolvedPeriod } from '@/types/analytics';
import { fromIsoDate, getReferenceDate, shiftIsoDate, toIsoDate } from '@/utils/date';

/**
 * Resolução dos períodos da Visão da Rede.
 *
 * TUDO É ANCORADO EM D-1.
 *
 * O sistema é de conferência do dia anterior: a conferência de hoje ainda não
 * existe, por definição. Então o dia mais recente que pode ser analisado é
 * D-1, e é nele que todo período termina. Incluir hoje só criaria uma
 * pendência falsa todos os dias.
 */

/** Quantidade de dias de um intervalo fechado (as duas pontas contam). */
export function countDays(range: DateRange): number {
  const inicio = fromIsoDate(range.start).getTime();
  const fim = fromIsoDate(range.end).getTime();
  if (fim < inicio) return 0;
  // As datas vêm ao meio-dia local, então o horário de verão não desloca a conta.
  return Math.round((fim - inicio) / 86_400_000) + 1;
}

/** Todas as datas do intervalo, em ordem. */
export function eachDate(range: DateRange): string[] {
  const total = countDays(range);
  const datas: string[] = [];
  for (let i = 0; i < total; i += 1) {
    datas.push(shiftIsoDate(range.start, i));
  }
  return datas;
}

/** Primeiro dia do mês da data informada. */
function firstDayOfMonth(iso: string): string {
  const date = fromIsoDate(iso);
  return toIsoDate(new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0));
}

/**
 * Período ANTERIOR: o mesmo número de dias, imediatamente antes.
 *
 * Para MÊS isso é deliberado. Comparar 1 a 5 de setembro com agosto inteiro
 * seria enganoso — 5 dias contra 31. A comparação justa é contra os mesmos
 * 5 dias do mês anterior, e é o que esta regra produz para todos os tipos.
 */
export function previousRange(range: DateRange): DateRange {
  const dias = countDays(range);
  if (dias <= 0) return range;
  const fim = shiftIsoDate(range.start, -1);
  return { start: shiftIsoDate(fim, -(dias - 1)), end: fim };
}

/**
 * Resolve o período escolhido em datas concretas.
 *
 * `today` é injetável para os testes não dependerem do relógio.
 */
export function resolvePeriod(
  kind: PeriodKind,
  options: { custom?: DateRange; today?: Date } = {},
): ResolvedPeriod {
  const hoje = options.today ?? new Date();
  const referencia = getReferenceDate(hoje); // D-1

  const range = resolveRange(kind, referencia, options.custom);
  return {
    kind,
    range,
    comparison: previousRange(range),
    days: countDays(range),
  };
}

function resolveRange(
  kind: PeriodKind,
  referencia: string,
  custom: DateRange | undefined,
): DateRange {
  switch (kind) {
    case 'DAY':
      return { start: referencia, end: referencia };

    case 'LAST_7':
      return { start: shiftIsoDate(referencia, -6), end: referencia };

    case 'LAST_30':
      return { start: shiftIsoDate(referencia, -29), end: referencia };

    case 'MONTH': {
      // Mês da referência, cortado em D-1: o resto do mês ainda não aconteceu.
      const inicio = firstDayOfMonth(referencia);
      return { start: inicio, end: referencia };
    }

    case 'CUSTOM': {
      const inicio = custom?.start ?? referencia;
      const fimPedido = custom?.end ?? referencia;
      // Nunca passa de D-1, mesmo que o usuário digite uma data futura.
      const fim = fimPedido > referencia ? referencia : fimPedido;
      return inicio > fim ? { start: fim, end: fim } : { start: inicio, end: fim };
    }

    default:
      return { start: referencia, end: referencia };
  }
}

/** Rótulo do período: "01/09/2026 a 05/09/2026" ou só a data quando é um dia. */
export function describeRange(range: DateRange): string {
  const inicio = formatBr(range.start);
  const fim = formatBr(range.end);
  return inicio === fim ? inicio : `${inicio} a ${fim}`;
}

/**
 * Formata em DD/MM/AAAA sem passar por `toLocaleDateString`.
 *
 * O formato NÃO pode depender do idioma do navegador: num Chrome em inglês,
 * 05/09/2026 viraria 09/05/2026 e o supervisor leria o mês como dia.
 */
function formatBr(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

/** True quando a data está dentro do intervalo (pontas inclusive). */
export function isWithin(range: DateRange, iso: string): boolean {
  return iso >= range.start && iso <= range.end;
}
