import { useMemo, useState } from 'react';
import type { DailyPoint, DayCoverageState } from '@/types/analytics';
import { formatBrDate, fromIsoDate } from '@/utils/date';

interface Props {
  daily: DailyPoint[];
}

type Serie = 'absences' | 'dayOffs';
type CardPeriod = 7 | 15 | 30;

function dayOfWeek(iso: string): number {
  return fromIsoDate(iso).getDay();
}

function isWeekend(iso: string): boolean {
  const d = dayOfWeek(iso);
  return d === 0 || d === 6;
}

function weekdayShort(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })
    .format(fromIsoDate(iso))
    .replace('.', '')
    .slice(0, 3);
}

function dayTick(iso: string, index: number, total: number): string {
  const date = fromIsoDate(iso);
  const day = String(date.getDate()).padStart(2, '0');

  if (total <= 7) return `${weekdayShort(iso)} ${day}`;
  if (total <= 15) return index % 2 === 0 || index === total - 1 ? day : '';
  return index % 4 === 0 || index === total - 1 || date.getDate() === 1 ? day : '';
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(0)}%`;
}

function decimal(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

function coverageColor(state: DayCoverageState): string {
  switch (state) {
    case 'COMPLETE':
      return 'evolution__coverage-dot--complete';
    case 'PARTIAL':
      return 'evolution__coverage-dot--partial';
    case 'NO_DATA':
      return 'evolution__coverage-dot--none';
  }
}

function coverageLabel(state: DayCoverageState): string {
  switch (state) {
    case 'COMPLETE':
      return 'Cobertura completa';
    case 'PARTIAL':
      return 'Dados parciais';
    case 'NO_DATA':
      return 'Sem conferência';
  }
}

export function DailyEvolution({ daily }: Props) {
  const [serie, setSerie] = useState<Serie>('absences');
  const [cardPeriod, setCardPeriod] = useState<CardPeriod>(7);

  const visibleDays = useMemo(() => {
    const slice = daily.slice(-cardPeriod);
    return slice.length > 0 ? slice : daily;
  }, [daily, cardPeriod]);

  const maxValue = useMemo(
    () => Math.max(0, ...visibleDays.map((p) => (serie === 'absences' ? p.absences : p.dayOffs))),
    [visibleDays, serie],
  );

  const average = useMemo(() => {
    if (visibleDays.length === 0) return 0;
    const sum = visibleDays.reduce(
      (acc, p) => acc + (serie === 'absences' ? p.absences : p.dayOffs),
      0,
    );
    return sum / visibleDays.length;
  }, [visibleDays, serie]);

  // O plot tem 160 px úteis abaixo da margem superior de 18 px.
  // A linha usa pixels para continuar alinhada às barras mesmo com os rótulos
  // dos dias dentro da própria coluna.
  const averageTopPx =
    maxValue > 0 ? 18 + (1 - Math.min(1, average / maxValue)) * 160 : 178;

  const stats = useMemo(() => {
    const values = visibleDays.map((p) => (serie === 'absences' ? p.absences : p.dayOffs));
    const max = Math.max(0, ...values);
    const completeDays = visibleDays.filter((p) => p.state === 'COMPLETE').length;
    const partialDays = visibleDays.filter((p) => p.state === 'PARTIAL').length;
    const noDataDays = visibleDays.filter((p) => p.state === 'NO_DATA').length;
    return { max, avg: average, completeDays, partialDays, noDataDays };
  }, [visibleDays, serie, average]);

  const periodStart = visibleDays.length > 0 ? visibleDays[0].date : '';
  const periodEnd = visibleDays.length > 0 ? visibleDays[visibleDays.length - 1].date : '';
  const periodoLabel =
    periodStart && periodEnd ? `${formatBrDate(periodStart)} a ${formatBrDate(periodEnd)}` : '';

  const hasData = visibleDays.some(
    (p) => p.absences > 0 || p.dayOffs > 0 || p.state !== 'NO_DATA',
  );

  const periodOptions = ([7, 15, 30] as CardPeriod[]).filter(
    (period) => period <= daily.length,
  );

  return (
    <section className="panel evolution" aria-label="Evolução diária">
      <div className="evolution__header">
        <div>
          <p className="evolution__eyebrow">Comportamento do período</p>
          <h3 className="panel__title">Evolução diária</h3>
          {periodoLabel && <p className="evolution__subtitle">{periodoLabel}</p>}
        </div>

        <div className="evolution__controls">
          <div className="scope-switch" role="group" aria-label="Série do gráfico">
            <button
              type="button"
              className={`scope-switch__btn${serie === 'absences' ? ' scope-switch__btn--on' : ''}`}
              aria-pressed={serie === 'absences'}
              onClick={() => setSerie('absences')}
            >
              Faltas
            </button>
            <button
              type="button"
              className={`scope-switch__btn${serie === 'dayOffs' ? ' scope-switch__btn--on' : ''}`}
              aria-pressed={serie === 'dayOffs'}
              onClick={() => setSerie('dayOffs')}
            >
              Folgas
            </button>
          </div>

          {periodOptions.length > 1 && (
            <div className="evolution__period-selector" role="group" aria-label="Período do gráfico">
              {periodOptions.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`evolution__period-btn${cardPeriod === p ? ' evolution__period-btn--on' : ''}`}
                  aria-pressed={cardPeriod === p}
                  onClick={() => setCardPeriod(p)}
                >
                  {p}d
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!hasData ? (
        <p className="evolution__empty">Nenhum dado disponível para o período.</p>
      ) : (
        <>
          <div className="evolution__chart-wrapper">
            <div className="evolution__bars-area">
              <span className="evolution__grid-line evolution__grid-line--top" aria-hidden="true" />
              <span className="evolution__grid-line evolution__grid-line--middle" aria-hidden="true" />
              <span className="evolution__grid-line evolution__grid-line--bottom" aria-hidden="true" />

              {maxValue > 0 && (
                <div
                  className="evolution__avg-line"
                  style={{ top: `${averageTopPx}px` }}
                  title={`Média diária: ${decimal(average)}`}
                  aria-hidden="true"
                >
                  <span>Média {decimal(average)}</span>
                </div>
              )}

              <div className="evolution__columns">
                {visibleDays.map((point, index) => {
                  const value = serie === 'absences' ? point.absences : point.dayOffs;
                  const heightPercent = maxValue > 0 ? (value / maxValue) * 100 : 0;
                  const weekend = isWeekend(point.date);
                  const nome = serie === 'absences' ? 'Faltas' : 'Folgas';
                  const cobertura = `Conferências: ${point.submitted} de ${point.expected} (${formatPercent(point.coverage)})`;
                  const tooltip =
                    point.state === 'NO_DATA'
                      ? `${formatBrDate(point.date)} · Sem conferência — nada apurado`
                      : `${formatBrDate(point.date)} · ${nome}: ${value} · ${cobertura}`;

                  return (
                    <div
                      key={point.date}
                      className={`evolution__col${weekend ? ' evolution__col--weekend' : ''}`}
                    >
                      <div className="evolution__track" title={tooltip}>
                        {point.state === 'NO_DATA' ? (
                          <div className="evolution__gap">
                            <span>—</span>
                          </div>
                        ) : value === 0 ? (
                          <>
                            <span className="evolution__zero-value">0</span>
                            <span className="evolution__zero-marker" aria-hidden="true" />
                          </>
                        ) : (
                          <div
                            className={[
                              'evolution__bar',
                              serie === 'absences'
                                ? 'evolution__bar--danger'
                                : 'evolution__bar--brand',
                              point.state === 'PARTIAL' ? 'evolution__bar--partial' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            style={{ height: `${heightPercent}%` }}
                          >
                            <span className="evolution__bar-value">{value}</span>
                          </div>
                        )}
                      </div>

                      <span className="evolution__day-label" aria-hidden="true">
                        {dayTick(point.date, index, visibleDays.length)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="evolution__coverage" aria-label="Cobertura diária">
            <div className="evolution__coverage-title">
              <span className="evolution__coverage-label">Cobertura das conferências</span>
              <span className="evolution__coverage-resume">
                {stats.completeDays} completa{stats.completeDays === 1 ? '' : 's'} ·{' '}
                {stats.partialDays} {stats.partialDays === 1 ? 'parcial' : 'parciais'} ·{' '}
                {stats.noDataDays} sem dado
              </span>
            </div>

            <div className="evolution__coverage-strip">
              {visibleDays.map((point) => (
                <span
                  key={point.date}
                  className="evolution__coverage-day"
                  title={`${formatBrDate(point.date)} — ${coverageLabel(point.state)}`}
                >
                  <span className={`evolution__coverage-dot ${coverageColor(point.state)}`} />
                </span>
              ))}
            </div>

            <div className="evolution__coverage-legend">
              <span className="evolution__legend-item">
                <span className="evolution__legend-dot evolution__legend-dot--complete" />
                Completa
              </span>
              <span className="evolution__legend-item">
                <span className="evolution__legend-dot evolution__legend-dot--partial" />
                Parcial
              </span>
              <span className="evolution__legend-item">
                <span className="evolution__legend-dot evolution__legend-dot--none" />
                Sem dado
              </span>
            </div>
          </div>

          <div className="evolution__summary">
            <div className="evolution__stat">
              <span className="evolution__stat-label">Maior valor</span>
              <span className="evolution__stat-value">{stats.max}</span>
            </div>
            <div className="evolution__stat">
              <span className="evolution__stat-label">Média diária</span>
              <span className="evolution__stat-value">{decimal(stats.avg)}</span>
            </div>
            <div className="evolution__stat">
              <span className="evolution__stat-label">Dias completos</span>
              <span className="evolution__stat-value">{stats.completeDays}</span>
            </div>
            <div className="evolution__stat">
              <span className="evolution__stat-label">Sem conferência</span>
              <span className="evolution__stat-value">{stats.noDataDays}</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
