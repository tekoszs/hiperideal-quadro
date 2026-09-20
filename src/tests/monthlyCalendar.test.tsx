// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  isMonthlyRecordableDate,
  isMonthlySubmittableDate,
  monthCalendarDates,
  monthEndIso,
  monthStartIso,
  monthlyProgress,
  monthlyReferenceDates,
  shiftMonthIso,
} from '@/domain/referenceWindow';
import { MonthlyCalendar } from '@/components/MonthlyCalendar';
import type { ReferenceDateInfo } from '@/domain/referenceWindow';
import type { ConferenceHistoryEntry } from '@/types/domain';

const TODAY = new Date(2026, 8, 11, 12);

function dates(statuses: Record<string, ReferenceDateInfo['status']> = {}) {
  return Object.entries(statuses).map(([date, status]) => ({
    date,
    status,
    pending: status !== 'SUBMITTED',
    label: date,
  }));
}

describe('calendário mensal', () => {
  it('calcula meses com 28, 29, 30 e 31 dias', () => {
    expect(monthEndIso('2026-02-01')).toBe('2026-02-28');
    expect(monthEndIso('2024-02-01')).toBe('2024-02-29');
    expect(monthEndIso('2026-04-01')).toBe('2026-04-30');
    expect(monthEndIso('2026-01-01')).toBe('2026-01-31');
    expect(monthCalendarDates('2026-09-01').filter(Boolean)).toHaveLength(30);
  });

  it('mantém primeiro dia, último dia e troca de mês', () => {
    expect(monthStartIso('2026-09-11')).toBe('2026-09-01');
    expect(shiftMonthIso('2026-09-01', -1)).toBe('2026-08-01');
    expect(shiftMonthIso('2026-09-01', 1)).toBe('2026-10-01');
  });

  it('aplica ontem, hoje, amanhã e limite do mês atual', () => {
    expect(isMonthlyRecordableDate('2026-09-01', TODAY)).toBe(true);
    expect(isMonthlyRecordableDate('2026-09-10', TODAY)).toBe(true);
    expect(isMonthlyRecordableDate('2026-09-11', TODAY)).toBe(true);
    expect(isMonthlyRecordableDate('2026-09-12', TODAY)).toBe(false);
    expect(isMonthlyRecordableDate('2026-08-31', TODAY)).toBe(false);
    expect(isMonthlySubmittableDate('2026-09-10', TODAY)).toBe(true);
    expect(isMonthlySubmittableDate('2026-09-11', TODAY)).toBe(false);
  });

  it('resume somente dias elegíveis e separa rascunhos', () => {
    const summary = monthlyProgress(
      dates({
        '2026-09-08': 'SUBMITTED',
        '2026-09-09': 'DRAFT',
        '2026-09-11': 'DRAFT',
      }),
      TODAY,
    );
    expect(summary).toEqual({ done: 1, pending: 7, drafts: 2, eligible: 10 });
  });

  it('mostra status, seleção e aria-label no calendário', () => {
    render(
      <MonthlyCalendar
        month="2026-09"
        today="2026-09-11"
        dates={dates({ '2026-09-07': 'SUBMITTED', '2026-09-09': 'DRAFT' })}
        selected="2026-09-09"
        disabled={false}
        onSelect={() => undefined}
        onMonthChange={() => undefined}
      />,
    );
    expect(screen.getByTitle(/7 de setembro de 2026, enviada/i)).toBeTruthy();
    expect(screen.getByTitle(/9 de setembro de 2026, rascunho/i).getAttribute('aria-current')).toBe('date');
    expect(screen.getByRole('button', { name: /11 de setembro de 2026, hoje, pré-registro/i })).toBeTruthy();
  });

  it('cruza o status real de cada data com a grade mensal', () => {
    const history: ConferenceHistoryEntry[] = [
      ...['2026-09-04', '2026-09-05', '2026-09-07'].map((date) => ({
        id: date,
        referenceDate: date,
        totalAbsences: 0,
        totalDayOffs: 0,
        status: 'SUBMITTED' as const,
        submittedAt: `${date}T12:00:00.000Z`,
      })),
      ...[
      {
        id: '2026-09-09',
        referenceDate: '2026-09-09',
        totalAbsences: 0,
        totalDayOffs: 0,
        status: 'DRAFT' as const,
        submittedAt: null,
      },
      ],
    ];
    const dates = monthlyReferenceDates(history, '2026-09', TODAY);
    const byDate = new Map(dates.map((info) => [info.date, info]));

    expect(byDate.get('2026-09-04')?.status).toBe('SUBMITTED');
    expect(byDate.get('2026-09-05')?.status).toBe('SUBMITTED');
    expect(byDate.get('2026-09-06')?.status).toBe('MISSING');
    expect(byDate.get('2026-09-07')?.status).toBe('SUBMITTED');
    expect(byDate.get('2026-09-08')?.status).toBe('MISSING');
    expect(byDate.get('2026-09-09')?.status).toBe('DRAFT');
    expect(byDate.get('2026-09-10')?.status).toBe('MISSING');
    expect(byDate.get('2026-09-11')?.status).toBe('MISSING');

    expect(monthlyProgress(dates, TODAY)).toMatchObject({
      done: 3,
      drafts: 1,
    });
  });
});
