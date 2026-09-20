import { useState } from 'react';
import { MonthlyCalendar } from '@/components/MonthlyCalendar';
import type { ReferenceDateInfo } from '@/domain/referenceWindow';

interface Props {
  /** Todas as datas da janela, com o status de cada uma. */
  dates: ReferenceDateInfo[];
  /** Só as pendentes, mais antiga primeiro. */
  pending: ReferenceDateInfo[];
  selected: string;
  bounds: { min: string; max: string };
  disabled: boolean;
  onSelect: (date: string) => void;
  /** FASE 4.5 — a data de hoje, para o pré-registro. */
  today: string;
  /** True quando a tela está no modo pré-registro. */
  preRegistration: boolean;
  month?: string;
  onMonthChange?: (month: string) => void;
}

/**
 * FASE 4.4 — A SEMANA DO GERENTE, EM CHIPS.
 *
 * O QUE MUDOU EM RELAÇÃO À 4.3
 * ----------------------------
 * Antes só as pendências viravam chip. A tela respondia "o que falta?" e ficava
 * muda sobre "quanto já fiz?" — e o gerente que abre o sistema depois de uma
 * semana de férias precisa das duas respostas. Agora a janela inteira aparece:
 * o que falta primeiro, o que já foi em seguida, e um contador `X de 7` que
 * fecha com o que se vê.
 *
 * A ORDEM É CRONOLÓGICA E ESTÁVEL — sempre SEG, TER, QUA... até a data mais
 * recente. Datas são uma sequência temporal, e o gerente aprende onde cada dia
 * fica na fila. Ordenar por pendência colocava a próxima ação na frente, mas
 * cobrava um preço alto: ao enviar uma conferência, aquele chip DEIXAVA de ser
 * pendência e pulava para outro lugar da fila. O gerente via o dia que acabou
 * de enviar sumir de onde estava — e o dia seguinte tomar o lugar dele.
 *
 * Enviar muda a COR e a PALAVRA do chip. Não muda a posição dele.
 *
 * O que a ordem por pendência resolvia — a próxima ação estar visível no
 * celular, onde a fila rola — continua resolvido pelo `scrollIntoView` logo
 * abaixo, que traz a data ABERTA para o centro da fila. E a data aberta já é,
 * na chegada, a pendência mais antiga.
 */
export function ReferenceDateBar({
  dates,
  pending: _pending,
  selected,
  bounds: _bounds,
  disabled,
  onSelect,
  today,
  preRegistration: _preRegistration,
  month,
  onMonthChange,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const visibleMonth = month ?? dates[0]?.date.slice(0, 7) ?? today.slice(0, 7);

  return (
    <section className="refdate" aria-label="Data da conferência">
      {!collapsed && (
        <MonthlyCalendar
          month={visibleMonth}
          today={today}
          dates={dates}
          selected={selected}
          disabled={disabled}
          onSelect={onSelect}
          onMonthChange={onMonthChange ?? (() => undefined)}
          toggleSlot={(
            <button
              type="button"
              className="refdate__toggle"
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((c) => !c)}
            >
              <span className="refdate__toggle-label">
                Fechar calendário
              </span>
              <span className="refdate__toggle-icon" aria-hidden="true">▾</span>
            </button>
          )}
        />
      )}

      {collapsed && (
        <button
          type="button"
          className="refdate__toggle"
          aria-expanded={false}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span className="refdate__toggle-label">
            Abrir calendário
          </span>
          <span className="refdate__toggle-icon" aria-hidden="true">▸</span>
        </button>
      )}

      <div className="refdate__today">
        <button
          type="button"
          className="btn btn--ghost refdate__today-btn"
          aria-pressed={_preRegistration}
          disabled={disabled}
          onClick={() => onSelect(today)}
        >
          Registrar ocorrências de hoje
        </button>
        <p className="refdate__today-hint">
          Atalho para o dia marcado como Hoje no calendário.
        </p>
      </div>
    </section>
  );
}
