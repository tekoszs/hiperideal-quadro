import { describe, expect, it } from 'vitest';
import {
  countDays,
  describeRange,
  eachDate,
  isWithin,
  previousRange,
  resolvePeriod,
} from '@/domain/period';

/**
 * FASE 3B — resolução dos períodos da Visão da Rede.
 *
 * `today` é sempre injetado: teste que depende do relógio quebra sozinho às
 * 00:00 e ninguém entende por quê.
 *
 * Cenário base: hoje 06/09/2026 (domingo), logo D-1 = 05/09/2026 (sábado).
 */

const HOJE = new Date(2026, 8, 6, 10, 0, 0); // 06/09/2026
const D1 = '2026-09-05';

// TESTE 10
describe('D-1 é a âncora de todos os períodos', () => {
  it('Dia usa D-1, nunca hoje', () => {
    const periodo = resolvePeriod('DAY', { today: HOJE });
    expect(periodo.range).toEqual({ start: D1, end: D1 });
    expect(periodo.days).toBe(1);
  });

  // TESTE 19
  it('a data de hoje nunca entra no período', () => {
    for (const kind of ['DAY', 'LAST_7', 'LAST_30', 'MONTH'] as const) {
      const periodo = resolvePeriod(kind, { today: HOJE });
      expect(periodo.range.end, kind).toBe(D1);
      expect(periodo.range.end < '2026-09-06').toBe(true);
    }
  });

  it('vira o mês corretamente: hoje 01/09 -> D-1 é 31/08', () => {
    const periodo = resolvePeriod('DAY', { today: new Date(2026, 8, 1, 10, 0, 0) });
    expect(periodo.range.end).toBe('2026-08-31');
  });
});

// TESTE 11
describe('Período de 7 dias', () => {
  it('são os últimos 7 dias terminando em D-1', () => {
    const periodo = resolvePeriod('LAST_7', { today: HOJE });
    expect(periodo.range).toEqual({ start: '2026-08-30', end: D1 });
    expect(periodo.days).toBe(7);
  });

  it('gera exatamente 7 datas, sem buraco', () => {
    const periodo = resolvePeriod('LAST_7', { today: HOJE });
    const datas = eachDate(periodo.range);
    expect(datas).toHaveLength(7);
    expect(datas[0]).toBe('2026-08-30');
    expect(datas[6]).toBe(D1);
  });
});

// TESTE 12
describe('Período de 30 dias', () => {
  it('são os últimos 30 dias terminando em D-1', () => {
    const periodo = resolvePeriod('LAST_30', { today: HOJE });
    expect(periodo.range).toEqual({ start: '2026-08-07', end: D1 });
    expect(periodo.days).toBe(30);
    expect(eachDate(periodo.range)).toHaveLength(30);
  });
});

// TESTE 13
describe('Mês', () => {
  it('vai do dia 1 até D-1, não até o fim do mês', () => {
    const periodo = resolvePeriod('MONTH', { today: HOJE });
    // O resto de setembro ainda não aconteceu.
    expect(periodo.range).toEqual({ start: '2026-09-01', end: D1 });
    expect(periodo.days).toBe(5);
  });

  it('no dia 1 do mês, D-1 cai no mês anterior e o período é aquele mês', () => {
    const periodo = resolvePeriod('MONTH', { today: new Date(2026, 8, 1, 10, 0, 0) });
    expect(periodo.range).toEqual({ start: '2026-08-01', end: '2026-08-31' });
    expect(periodo.days).toBe(31);
  });
});

// TESTE 14
describe('Período personalizado', () => {
  it('respeita as datas escolhidas', () => {
    const periodo = resolvePeriod('CUSTOM', {
      today: HOJE,
      custom: { start: '2026-08-01', end: '2026-08-15' },
    });
    expect(periodo.range).toEqual({ start: '2026-08-01', end: '2026-08-15' });
    expect(periodo.days).toBe(15);
  });

  it('corta data futura em D-1', () => {
    const periodo = resolvePeriod('CUSTOM', {
      today: HOJE,
      custom: { start: '2026-09-01', end: '2026-12-31' },
    });
    expect(periodo.range.end).toBe(D1);
  });

  it('início depois do fim não gera intervalo invertido', () => {
    const periodo = resolvePeriod('CUSTOM', {
      today: HOJE,
      custom: { start: '2026-09-05', end: '2026-09-01' },
    });
    expect(periodo.range.start <= periodo.range.end).toBe(true);
    expect(periodo.days).toBeGreaterThanOrEqual(1);
  });
});

// TESTE 15
describe('Período anterior: mesmo tamanho, imediatamente antes', () => {
  it('Dia compara com o dia anterior', () => {
    const periodo = resolvePeriod('DAY', { today: HOJE });
    expect(periodo.comparison).toEqual({ start: '2026-09-04', end: '2026-09-04' });
  });

  it('7 dias compara com os 7 dias anteriores', () => {
    const periodo = resolvePeriod('LAST_7', { today: HOJE });
    expect(periodo.comparison).toEqual({ start: '2026-08-23', end: '2026-08-29' });
    expect(countDays(periodo.comparison!)).toBe(7);
  });

  it('30 dias compara com os 30 dias anteriores', () => {
    const periodo = resolvePeriod('LAST_30', { today: HOJE });
    expect(countDays(periodo.comparison!)).toBe(30);
    expect(periodo.comparison!.end).toBe('2026-08-06');
  });

  it('MÊS compara com os MESMOS DIAS do mês anterior, não o mês inteiro', () => {
    // Setembro está cortado em 5 dias (01 a 05). Comparar com agosto inteiro
    // (31 dias) diria que as faltas despencaram — comparação desonesta.
    const periodo = resolvePeriod('MONTH', { today: HOJE });
    expect(periodo.range.start).toBe('2026-09-01');
    expect(countDays(periodo.range)).toBe(5);
    expect(periodo.comparison).toEqual({ start: '2026-08-27', end: '2026-08-31' });
    expect(countDays(periodo.comparison!)).toBe(5);
  });

  it('o anterior nunca encosta no período analisado', () => {
    for (const kind of ['DAY', 'LAST_7', 'LAST_30', 'MONTH'] as const) {
      const periodo = resolvePeriod(kind, { today: HOJE });
      expect(periodo.comparison!.end < periodo.range.start, kind).toBe(true);
    }
  });
});

describe('Utilitários de intervalo', () => {
  it('countDays conta as duas pontas', () => {
    expect(countDays({ start: '2026-09-05', end: '2026-09-05' })).toBe(1);
    expect(countDays({ start: '2026-09-01', end: '2026-09-05' })).toBe(5);
  });

  it('countDays devolve 0 em intervalo invertido, sem número negativo', () => {
    expect(countDays({ start: '2026-09-05', end: '2026-09-01' })).toBe(0);
  });

  it('countDays atravessa o horário de verão sem perder um dia', () => {
    // No Brasil não há mais horário de verão, mas as datas são criadas ao
    // meio-dia local justamente para nenhum fuso deslocar a conta.
    expect(countDays({ start: '2026-10-01', end: '2026-11-30' })).toBe(61);
  });

  it('isWithin inclui as pontas', () => {
    const range = { start: '2026-09-01', end: '2026-09-05' };
    expect(isWithin(range, '2026-09-01')).toBe(true);
    expect(isWithin(range, '2026-09-05')).toBe(true);
    expect(isWithin(range, '2026-08-31')).toBe(false);
    expect(isWithin(range, '2026-09-06')).toBe(false);
  });

  it('describeRange escreve sempre em DD/MM/AAAA', () => {
    expect(describeRange({ start: '2026-09-01', end: '2026-09-05' })).toBe(
      '01/09/2026 a 05/09/2026',
    );
    // Um dia só não repete a data.
    expect(describeRange({ start: '2026-09-05', end: '2026-09-05' })).toBe('05/09/2026');
  });

  it('previousRange preserva o tamanho do intervalo', () => {
    const range = { start: '2026-09-01', end: '2026-09-05' };
    const anterior = previousRange(range);
    expect(countDays(anterior)).toBe(countDays(range));
    expect(anterior.end).toBe('2026-08-31');
  });
});
