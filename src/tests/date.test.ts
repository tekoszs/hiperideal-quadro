import { describe, expect, it } from 'vitest';
import { formatBrDate, fromIsoDate, getReferenceDate, toIsoDate } from '@/utils/date';

// TESTE 1 — D-1 calculado corretamente.
describe('Data de referência (D-1)', () => {
  it('usa o dia anterior ao dia atual', () => {
    const hoje = new Date(2026, 8, 6); // 06/09/2026
    expect(getReferenceDate(hoje)).toBe('2026-09-05');
  });

  it('atravessa a virada de mês', () => {
    expect(getReferenceDate(new Date(2026, 8, 1))).toBe('2026-08-31');
  });

  it('atravessa a virada de ano', () => {
    expect(getReferenceDate(new Date(2027, 0, 1))).toBe('2026-12-31');
  });

  it('trata ano bissexto', () => {
    expect(getReferenceDate(new Date(2028, 2, 1))).toBe('2028-02-29');
  });

  it('nunca retorna a data de hoje', () => {
    const hoje = new Date(2026, 8, 6);
    expect(getReferenceDate(hoje)).not.toBe(toIsoDate(hoje));
  });

  it('formata em padrão brasileiro', () => {
    expect(formatBrDate('2026-09-05')).toBe('05/09/2026');
  });

  it('converte ISO para Date sem escorregar de dia por fuso', () => {
    const date = fromIsoDate('2026-09-05');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(8);
    expect(date.getDate()).toBe(5);
  });
});
