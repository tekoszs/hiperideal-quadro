import {
  CONFERENCE_STATUS_TONE,
  CONFERENCE_STATUS_WORD,
} from '@/domain/conferenceStatusView';
import {
  monthCalendarDates,
  monthlyProgress,
  monthStartIso,
  shiftMonthIso,
  isMonthlyRecordableDate,
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
  toggleSlot?: React.ReactNode;
}

const WEEKDAYS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];

function monthLabel(month: string): string {
  return fromIsoDate(monthStartIso(month)).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  }).replace(/^./, (char) => char.toUpperCase());
}

/**
 * Calendário operacional: apresentação separada da lógica de elegibilidade.
 * Os valores e permissões de seleção continuam vindo do domínio existente.
 */
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
    <section className="hq-cal" aria-label="Calendário mensal da conferência">
      <header className="hq-cal__top">
        <div className="hq-cal__heading">
          <p className="hq-cal__eyebrow">CONTROLE DE CONFERÊNCIAS</p>
          <h3 className="hq-cal__month">{monthLabel(month)}</h3>
          <p className="hq-cal__description">Acompanhe as conferências e selecione a data para preencher.</p>
        </div>
        <div className="hq-cal__top-actions">
          <nav className="hq-cal__month-nav" aria-label="Navegação entre meses">
            <button
              type="button"
              aria-label="Mês anterior"
              onClick={() => onMonthChange(shiftMonthIso(month, -1))}
            >‹</button>
            <span aria-live="polite">{monthLabel(month)}</span>
            <button
              type="button"
              aria-label="Mês seguinte"
              onClick={() => onMonthChange(shiftMonthIso(month, 1))}
              disabled={isFutureMonth}
            >›</button>
          </nav>
          {toggleSlot && <div className="hq-cal__toggle">{toggleSlot}</div>}
        </div>
      </header>

      <div className="hq-cal__overview">
        <div className="hq-cal__metrics" aria-label="Indicadores do mês">
          <div className="hq-cal__metric hq-cal__metric--done">
            <span className="hq-cal__metric-label"><i aria-hidden="true" />Concluídas</span>
            <strong>{progress.done}</strong>
          </div>
          <div className="hq-cal__metric hq-cal__metric--pending">
            <span className="hq-cal__metric-label"><i aria-hidden="true" />Pendentes</span>
            <strong>{progress.pending}</strong>
          </div>
          <div className="hq-cal__metric hq-cal__metric--draft">
            <span className="hq-cal__metric-label"><i aria-hidden="true" />Rascunhos</span>
            <strong>{progress.drafts}</strong>
          </div>
          <div className="hq-cal__metric hq-cal__metric--eligible">
            <span className="hq-cal__metric-label"><i aria-hidden="true" />Dias elegíveis</span>
            <strong>{progress.eligible}</strong>
          </div>
        </div>
        {isCurrentMonth && (
          <div
            className="hq-cal__progress"
            aria-label={`${progress.done} de ${progress.eligible} dias elegíveis concluídos`}
          >
            <div className="hq-cal__progress-text">
              <span>Progresso do mês</span>
              <strong>{Math.round(percent)}%</strong>
            </div>
            <div
              className="hq-cal__progress-bar"
              role="progressbar"
              aria-valuenow={progress.done}
              aria-valuemin={0}
              aria-valuemax={Math.max(progress.eligible, 1)}
              aria-label="Conferências concluídas"
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            <small>{progress.done} de {progress.eligible} dias elegíveis</small>
          </div>
        )}
      </div>

      <div className="hq-cal__calendar">
        <div className="hq-cal__calendar-heading">
          <strong>Selecione o dia</strong>
          <span>Os dias futuros ficam disponíveis conforme o calendário avança.</span>
        </div>
        <div className="hq-cal__weekdays" aria-hidden="true">
          {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="hq-cal__grid" role="group" aria-label={monthLabel(month)}>
          {monthCalendarDates(month).map((date, index) => {
            if (!date) return <span key={`empty-${index}`} className="hq-cal__empty" aria-hidden="true" />;

            const info = byDate.get(date) ?? { date, status: 'MISSING' as const, pending: false, label: date };
            const isToday = date === today;
            const isFuture = date > today;
            const isPastMonth = month < currentMonth;
            const isOperationalPastDate = isPastMonth && isMonthlyRecordableDate(date, fromIsoDate(today));
            const canSelect =
              !disabled &&
              !isFutureMonth &&
              !isFuture &&
              (isCurrentMonth || (isPastMonth && (info.status !== 'MISSING' || isOperationalPastDate)));
            const state = isToday ? 'PRE_REGISTRATION' : info.status;
            const tone = isToday
              ? 'today'
              : isFuture || isFutureMonth
                ? 'disabled'
                : CONFERENCE_STATUS_TONE[state];
            const statusLabel = isToday ? 'hoje, pré-registro' : CONFERENCE_STATUS_WORD[state];
            const visibleStatus =
              isToday ? 'HOJE' :
              isFuture || isFutureMonth ? '' :
              info.status === 'SUBMITTED' ? 'ENVIADA' :
              info.status === 'DRAFT' ? 'RASCUNHO' :
              info.status === 'REOPENED' ? 'REABERTA' :
              info.pending ? 'PENDENTE' : '';

            return (
              <button
                key={date}
                type="button"
                data-date={date}
                value={date}
                className={[
                  'hq-cal__day',
                  `hq-cal__day--${tone}`,
                  info.pending ? 'hq-cal__day--pending' : '',
                  isToday ? 'hq-cal__day--today' : '',
                  date === selected ? 'hq-cal__day--selected' : '',
                  !canSelect ? 'hq-cal__day--disabled' : '',
                ].filter(Boolean).join(' ')}
                aria-label={`${formatLongBrDate(date)}, ${statusLabel}`}
                aria-pressed={date === selected}
                title={`${formatLongBrDate(date)}, ${statusLabel}`}
                disabled={!canSelect}
                onClick={() => onSelect(date)}
              >
                <span className="hq-cal__day-number">{Number(date.slice(8))}</span>
                {visibleStatus && <span className="hq-cal__day-status">{visibleStatus}</span>}
              </button>
            );
          })}
        </div>
        <div className="hq-cal__legend" aria-label="Legenda do calendário">
          <span><i className="hq-cal__legend-dot hq-cal__legend-dot--done" /> Enviada</span>
          <span><i className="hq-cal__legend-dot hq-cal__legend-dot--pending" /> Pendente</span>
          <span><i className="hq-cal__legend-dot hq-cal__legend-dot--draft" /> Rascunho</span>
          <span><i className="hq-cal__legend-dot hq-cal__legend-dot--today" /> Hoje</span>
        </div>
      </div>
    </section>
  );
}
