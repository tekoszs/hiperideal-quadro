import { formatBrDate, formatLongBrDate, isFutureIsoDate, toIsoDate } from '@/utils/date';

interface Props {
  value: string;
  onChange: (iso: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  disabled?: boolean;
}

/**
 * `‹ 05/09/2026 ›` com seletor de data.
 *
 * A data em destaque é escrita por `formatBrDate`, SEMPRE em DD/MM/AAAA.
 *
 * Isso importa: o `input type="date"` desenha o texto no formato do idioma do
 * navegador — num Chrome em inglês, 05/09/2026 apareceria como "09/05/2026" e
 * o supervisor leria o mês no lugar do dia. O input continua ali, pequeno, só
 * para abrir o calendário nativo (que no celular é a roda do sistema); quem
 * manda na leitura é o texto acima dele.
 *
 * Não deixa passar de hoje: conferência é sempre de um dia que já aconteceu.
 */
export function DateNavigator({ value, onChange, onPrevious, onNext, disabled }: Props) {
  const hoje = toIsoDate(new Date());
  const podeAvancar = !isFutureIsoDate(value) && value < hoje;

  return (
    <div className="date-nav">
      <button
        type="button"
        className="date-nav__step"
        onClick={onPrevious}
        disabled={disabled}
        aria-label="Dia anterior"
      >
        ‹
      </button>

      <div className="date-nav__center">
        <span className="date-nav__label">Referência</span>
        <strong className="date-nav__value">{formatBrDate(value)}</strong>
        <span className="date-nav__long">{formatLongBrDate(value)}</span>

        <input
          id="network-date"
          className="date-nav__input"
          type="date"
          aria-label="Referência"
          value={value}
          max={hoje}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value) onChange(event.target.value);
          }}
        />
      </div>

      <button
        type="button"
        className="date-nav__step"
        onClick={onNext}
        disabled={disabled || !podeAvancar}
        aria-label="Próximo dia"
      >
        ›
      </button>
    </div>
  );
}
