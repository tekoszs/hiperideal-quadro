import type { Position } from '@/types/domain';
import type { PendingJustification } from '@/domain/pendingJustification';
import { totalPendingQuantity } from '@/domain/pendingJustification';
import { formatBrDate, formatLongBrDate } from '@/utils/date';

interface Props {
  pendings: PendingJustification[];
  positions: Position[];
  /** Ausente no supervisor: ele vê a pendência e não a resolve. */
  onResolve?: (pending: PendingJustification) => void;
  disabled?: boolean;
}

function positionName(positions: Position[], positionId: string): string {
  return positions.find((position) => position.id === positionId)?.name ?? positionId;
}

/** `2` -> `2 faltas`; `1` -> `1 falta` */
function faltas(quantity: number): string {
  return `${quantity} ${quantity === 1 ? 'falta' : 'faltas'}`;
}

/** `0` -> `hoje`; `1` -> `há 1 dia`; `3` -> `há 3 dias` */
export function waitingLabel(days: number): string {
  if (days <= 0) return 'de hoje';
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
}

/**
 * FASE 4.5 — AS FALTAS QUE AINDA ESPERAM UM MOTIVO.
 *
 * Este bloco só existe quando há pendência. Quem está em dia não vê um card
 * vazio dizendo "0 pendências" — a ausência do bloco já é a informação, como no
 * bloco de conferências pendentes da fase 4.4.
 *
 * ÂMBAR, NUNCA VERMELHO. Uma conferência enviada com justificativa pendente é
 * uma conferência VÁLIDA: a falta aconteceu, foi contada e chegou ao
 * supervisor. O que falta é o documento. Pintar isso de vermelho ensinaria o
 * gerente a ler pendência como erro — e a evitar o motivo provisório, que é
 * exatamente o contrário do que esta fase quer.
 *
 * "Aguardando há 3 dias" é a informação que faz alguém agir: o número de dias
 * é o que separa "o atestado está a caminho" de "ninguém trouxe nada".
 */
export function PendingJustificationsPanel({
  pendings,
  positions,
  onResolve,
  disabled = false,
}: Props) {
  if (pendings.length === 0) return null;

  const total = totalPendingQuantity(pendings);
  const somenteLeitura = !onResolve;

  return (
    <section className="pendjust" aria-label="Pendências de justificativa">
      <div className="pendjust__head">
        <p className="pendjust__title">Pendências de justificativa</p>
        <p className="pendjust__count">
          {pendings.length === 1 ? '1 pendência' : `${pendings.length} pendências`}
          {total !== pendings.length && <span className="pendjust__total"> · {faltas(total)}</span>}
        </p>
      </div>

      <ul className="pendjust__list">
        {pendings.map((pending) => {
          const nome = positionName(positions, pending.positionId);
          const linha = (
            <>
              <span className="pendjust__date">{formatBrDate(pending.referenceDate)}</span>
              <span className="pendjust__position">{nome}</span>
              <span className="pendjust__qty">{faltas(pending.quantity)}</span>
              <span className="pendjust__waiting">
                Aguardando {waitingLabel(pending.waitingDays)}
              </span>
            </>
          );

          return (
            <li key={`${pending.itemId}`} className="pendjust__item">
              {somenteLeitura ? (
                <div className="pendjust__row pendjust__row--static">{linha}</div>
              ) : (
                <button
                  type="button"
                  className="pendjust__row"
                  disabled={disabled}
                  onClick={() => onResolve(pending)}
                  aria-label={`Resolver ${faltas(pending.quantity)} de ${nome} em ${formatLongBrDate(pending.referenceDate)}`}
                >
                  {linha}
                  <span className="pendjust__go" aria-hidden="true">
                    ›
                  </span>
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <p className="pendjust__hint">
        {somenteLeitura
          ? 'A resolução é feita pelo gerente da loja.'
          : 'Ao receber o documento, troque o motivo aqui. O total de faltas não muda.'}
      </p>
    </section>
  );
}
