import {
  CONFERENCE_STATUS_TONE,
  CONFERENCE_STATUS_WORD,
} from '@/domain/conferenceStatusView';
import {
  monthCalendarDates,
  monthlyProgress,
  monthStartIso,
  shiftMonthIso,
  type ReferenceDateInfo,
} from '@/domain/referenceWindow';
import { formatLongBrDate, fromIsoDate } from '@/utils/date';

interface Props {
  month: string;
  today: string;
  dates: ReferenceDateInfo[];
  selected: string;
  disabled: boolean;
  onSelect: (date: string) => void;
  onMonthChange: (month: string) => void;
  /** Botão de toggle (abrir/fechar) renderizado ao lado do título. */
  toggleSlot?: React.ReactNode;
}

const WEEKDAYS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];

function monthLabel(month: string): string {
  return fromIsoDate(monthStartIso(month)).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  }).replace(/^./, (char) => char.toUpperCase());
}

export function MonthlyCalendar({
  month,
  today,
  dates,
  selected,
  disabled,
  onSelect,
  onMonthChange,
  toggleSlot,
}: Props) {
  const byDate = new Map(dates.map((info) => [info.date, info]));
  const progress = monthlyProgress(dates, fromIsoDate(today));
  const currentMonth = today.slice(0, 7);
  const isCurrentMonth = month === currentMonth;
  const isFutureMonth = month > currentMonth;
  const percent = progress.eligible > 0 ? (progress.done / progress.eligible) * 100 : 0;

  return (
    <section className="monthly-calendar" aria-label="Calendário mensal da conferência">
      <div className="monthly-calendar__header">
        <div className="monthly-calendar__summary">
          <div>
            <p className="monthly-calendar__eyebrow">Resumo do mês</p>
            <h3 className="monthly-calendar__title">{monthLabel(month)}</h3>
          </div>
          {isCurrentMonth && (
            <div className="monthly-calendar__stats" aria-label="Resumo das conferências">
              <span><strong>{progress.done}</strong> concluídas</span>
              <span><strong>{progress.pending}</strong> pendentes</span>
              <span><strong>{progress.drafts}</strong> rascunho{progress.drafts === 1 ? '' : 's'}</span>
            </div>
          )}
          {toggleSlot}
        </div>

        {isCurrentMonth && (
          <div className="monthly-calendar__progress" aria-label={`${progress.done} de ${progress.eligible} dias elegíveis concluídos`}>
            <span className="monthly-calendar__progress-track" aria-hidden="true">
              <span style={{ width: `${percent}%` }} />
            </span>
            <span className="monthly-calendar__progress-text">{progress.done} de {progress.eligible} dias elegíveis</span>
          </div>
        )}
      </div>

      <nav className="monthly-calendar__nav" aria-label="Navegação de mês">
        <button
          type="button"
          className="monthly-calendar__nav-button"
          aria-label="Mês anterior"
          onClick={() => onMonthChange(shiftMonthIso(month, -1))}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <span aria-live="polite">{monthLabel(month)}</span>
        <button
          type="button"
          className="monthly-calendar__nav-button"
          aria-label="Mês seguinte"
          onClick={() => onMonthChange(shiftMonthIso(month, 1))}
          disabled={isFutureMonth}
        >
          <span aria-hidden="true">›</span>
        </button>
      </nav>

      <div className="monthly-calendar__weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="monthly-calendar__grid" role="grid" aria-label={monthLabel(month)}>
        {monthCalendarDates(month).map((date, index) => {
          if (!date) return <span key={`empty-${index}`} className="monthly-calendar__empty" aria-hidden="true" />;
          const info = byDate.get(date) ?? { date, status: 'MISSING' as const, pending: false, label: date };
          const isToday = date === today;
          const isFuture = date > today;
          const isPastMonth = month < currentMonth;
          const canSelect = !disabled && !isFutureMonth && !isFuture && (isCurrentMonth || isPastMonth && info.status !== 'MISSING');
          const state = isToday ? 'PRE_REGISTRATION' : info.status;
          const tone = isToday
            ? 'today'
            : isFuture || isFutureMonth
              ? 'disabled'
              : CONFERENCE_STATUS_TONE[state];
          const statusLabel = isToday ? 'hoje, pré-registro' : CONFERENCE_STATUS_WORD[state];
          return (
            <button
              key={date}
              type="button"
              data-date={date}
              value={date}
              className={[
                'monthly-calendar__day',
                `monthly-calendar__day--${tone}`,
                info.pending ? 'monthly-calendar__day--pending' : '',
                isToday ? 'monthly-calendar__day--today' : '',
                date === selected ? 'monthly-calendar__day--selected' : '',
                !canSelect ? 'monthly-calendar__day--disabled' : '',
              ].filter(Boolean).join(' ')}
              aria-label={isToday ? `${Number(date.slice(8))} de ${fromIsoDate(date).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}, ${statusLabel}` : `Conferência de ${formatLongBrDate(date)}`}
              title={`${Number(date.slice(8))} de ${fromIsoDate(date).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}, ${statusLabel}`}
              aria-current={date === selected ? 'date' : undefined}
              disabled={!canSelect}
              onClick={() => onSelect(date)}
            >
              <span className="monthly-calendar__number">{Number(date.slice(8))}</span>
              {isToday && <span className="monthly-calendar__today-label">Hoje</span>}
              <span className="monthly-calendar__marker" aria-hidden="true">
                {info.status === 'SUBMITTED' ? '✓' : '●'}
              </span>
            </button>
          );
        })}
      </div>

      <div className="monthly-calendar__legend" aria-label="Legenda dos status">
        <span className="monthly-calendar__legend-item monthly-calendar__legend-item--submitted">
          <span className="monthly-calendar__legend-dot" aria-hidden="true" />
          Enviada
        </span>
        <span className="monthly-calendar__legend-item monthly-calendar__legend-item--pending">
          <span className="monthly-calendar__legend-dot" aria-hidden="true" />
          Pendente
        </span>
        <span className="monthly-calendar__legend-item monthly-calendar__legend-item--draft">
          <span className="monthly-calendar__legend-dot" aria-hidden="true" />
          Rascunho
        </span>
        <span className="monthly-calendar__legend-item monthly-calendar__legend-item--today">
          <span className="monthly-calendar__legend-dot" aria-hidden="true" />
          Hoje
        </span>
      </div>
    </section>
  );
}
