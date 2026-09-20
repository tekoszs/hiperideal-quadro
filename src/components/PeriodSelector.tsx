import type { DateRange, PeriodKind, ResolvedPeriod } from '@/types/analytics';
import { describeRange } from '@/domain/period';
import { PERIOD_LABEL, PERIOD_KINDS } from '@/lib/constants';
import { toIsoDate } from '@/utils/date';
import { getReferenceDate } from '@/utils/date';

interface Props {
  period: ResolvedPeriod;
  kind: PeriodKind;
  onChangeKind: (kind: PeriodKind) => void;
  custom: DateRange;
  onChangeCustom: (range: DateRange) => void;
  disabled?: boolean;
}

/**
 * `[ Dia ] [ 7 dias ] [ 30 dias ] [ Mês ] [ Personalizado ]`
 *
 * O período analisado aparece escrito por extenso, sempre em DD/MM/AAAA
 * gerado pelo próprio sistema — o formato não pode depender do idioma do
 * navegador, senão 05/09 vira 09/05 num Chrome em inglês.
 *
 * Nenhuma data passa de D-1: a conferência de hoje ainda não existe.
 */
export function PeriodSelector({
  period,
  kind,
  onChangeKind,
  custom,
  onChangeCustom,
  disabled,
}: Props) {
  const limite = getReferenceDate(new Date());
  const hoje = toIsoDate(new Date());

  return (
    <div className="period">
      <div className="chips" role="group" aria-label="Período de análise">
        {PERIOD_KINDS.map((option) => (
          <button
            key={option}
            type="button"
            className={`chip${kind === option ? ' chip--on' : ''}`}
            aria-pressed={kind === option}
            disabled={disabled}
            onClick={() => onChangeKind(option)}
          >
            {PERIOD_LABEL[option]}
          </button>
        ))}
      </div>

      {kind === 'CUSTOM' && (
        <div className="period__custom">
          <label className="period__field">
            <span>De</span>
            <input
              type="date"
              value={custom.start}
              max={limite}
              disabled={disabled}
              onChange={(event) =>
                event.target.value && onChangeCustom({ ...custom, start: event.target.value })
              }
            />
          </label>
          <label className="period__field">
            <span>Até</span>
            <input
              type="date"
              value={custom.end}
              max={limite}
              disabled={disabled}
              onChange={(event) =>
                event.target.value && onChangeCustom({ ...custom, end: event.target.value })
              }
            />
          </label>
        </div>
      )}

      <p className="period__summary">
        <span className="period__summary-label">Período analisado</span>
        <strong className="period__summary-value">{describeRange(period.range)}</strong>
        <span className="period__summary-note">
          {period.days === 1 ? '1 dia' : `${period.days} dias`} · referência D-1
          {period.range.end === limite ? '' : ` · hoje é ${formatBr(hoje)}`}
        </span>
      </p>
    </div>
  );
}

function formatBr(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}
