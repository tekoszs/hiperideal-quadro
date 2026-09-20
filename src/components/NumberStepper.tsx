import { toNonNegativeInteger } from '@/utils/number';

interface Props {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** 'danger' pinta o número de vermelho quando > 0 (usado em faltas). */
  tone?: 'default' | 'danger';
  label: string;
  max?: number;
}

/**
 * Contador com [-] valor [+].
 * Nunca produz valor negativo: o botão [-] desabilita no zero e a digitação
 * passa por `toNonNegativeInteger`.
 */
export function NumberStepper({
  value,
  onChange,
  disabled = false,
  tone = 'default',
  label,
  max = 999,
}: Props) {
  const safeValue = toNonNegativeInteger(value);
  const canDecrease = !disabled && safeValue > 0;
  const canIncrease = !disabled && safeValue < max;

  const toneClass = tone === 'danger' && safeValue > 0 ? ' stepper--danger' : '';
  const zeroClass = safeValue === 0 ? ' stepper--zero' : '';

  return (
    <div className={`stepper${toneClass}${zeroClass}`}>
      <button
        type="button"
        className="stepper__button"
        onClick={() => onChange(Math.max(0, safeValue - 1))}
        disabled={!canDecrease}
        aria-label={`Diminuir ${label}`}
      >
        −
      </button>

      <input
        className="stepper__input"
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        step={1}
        value={safeValue}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(Math.min(max, toNonNegativeInteger(event.target.value)))}
        onFocus={(event) => event.target.select()}
      />

      <button
        type="button"
        className="stepper__button"
        onClick={() => onChange(Math.min(max, safeValue + 1))}
        disabled={!canIncrease}
        aria-label={`Aumentar ${label}`}
      >
        +
      </button>
    </div>
  );
}
