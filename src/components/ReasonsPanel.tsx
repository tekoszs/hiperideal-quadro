import type { AbsenceReason, DailyItem } from '@/types/domain';
import { NumberStepper } from '@/components/NumberStepper';
import { getReasonObservation, getReasonQuantity } from '@/domain/conferenceFactory';
import { getReasonsTotal } from '@/domain/summary';
import { hasText } from '@/utils/text';
import { PENDING_REASON_ID } from '@/data/absenceReasons';

/** `plural(1, 'falta', 'faltas')` -> `1 falta` */
function plural(quantity: number, singular: string, many: string): string {
  return `${quantity} ${quantity === 1 ? singular : many}`;
}

interface Props {
  item: DailyItem;
  reasons: AbsenceReason[];
  disabled: boolean;
  onChangeQuantity: (reasonId: string, value: number) => void;
  onChangeObservation: (reasonId: string, value: string) => void;
}

/**
 * Aparece automaticamente quando a função tem faltas > 0.
 * A soma das quantidades precisa fechar com a quantidade de faltas.
 */
export function ReasonsPanel({
  item,
  reasons,
  disabled,
  onChangeQuantity,
  onChangeObservation,
}: Props) {
  const informed = getReasonsTotal(item);
  const target = item.absenceQuantity;
  const closed = informed === target;
  const aguardando = getReasonQuantity(item, PENDING_REASON_ID);

  return (
    <div className={`reasons${closed ? ' reasons--closed' : ''}`}>
      <div className="reasons__head">
        <p className="reasons__title">Motivo da falta</p>
        {/*
          O contador é o número que decide se a conferência pode ser enviada, e
          por isso ele é o elemento mais legível do painel — não um detalhe no
          canto. Âmbar enquanto falta motivo, verde discreto quando fecha.
        */}
        <span className={`reasons__counter reasons__counter--${closed ? 'ok' : 'open'}`}>
          {closed && (
            <span className="reasons__counter-check" aria-hidden="true">
              ✓
            </span>
          )}
          Motivos informados: {informed} de {target}
        </span>
      </div>

      <div className="reasons__grid">
        {reasons.map((reason) => {
          const quantity = getReasonQuantity(item, reason.id);
          const provisorio = reason.id === PENDING_REASON_ID;
          return (
            <div
              key={reason.id}
              className={[
                'reason-row',
                quantity > 0 ? 'reason-row--filled' : '',
                // Âmbar, nunca verde: "aguardando" não é motivo resolvido.
                provisorio ? 'reason-row--pending' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="reason-row__name">{reason.name}</span>
              <NumberStepper
                value={quantity}
                onChange={(value) => onChangeQuantity(reason.id, value)}
                disabled={disabled}
                label={`${reason.name} em ${item.positionId}`}
                max={Math.max(target, quantity)}
              />
            </div>
          );
        })}
      </div>

      {/* Observação obrigatória para motivos marcados com requiresObservation (Outros). */}
      {reasons
        .filter((reason) => reason.requiresObservation && getReasonQuantity(item, reason.id) > 0)
        .map((reason) => {
          const observation = getReasonObservation(item, reason.id);
          const missing = !hasText(observation);
          return (
            <div key={`obs-${reason.id}`} className="field reasons__obs">
              <label className="field__label field__label--required" htmlFor={`obs-${item.id}-${reason.id}`}>
                Observação do motivo "{reason.name}"
              </label>
              <textarea
                id={`obs-${item.id}-${reason.id}`}
                className={`field__textarea${missing ? ' field__textarea--invalid' : ''}`}
                rows={2}
                value={observation}
                disabled={disabled}
                placeholder="Descreva o motivo (obrigatório)"
                onChange={(event) => onChangeObservation(reason.id, event.target.value)}
              />
              {missing && (
                <span className="field__error">
                  O motivo "{reason.name}" exige observação.
                </span>
              )}
            </div>
          );
        })}

      {/*
        FASE 4.5 — quando há falta aguardando justificativa, a tela diz o que
        isso significa. Sem esta frase, "Aguardando justificativa" pareceria uma
        pendência de preenchimento, e o gerente ficaria procurando o que digitar.
      */}
      {aguardando > 0 && (
        <p className="reasons__waiting">
          <strong>
            {aguardando} {aguardando === 1 ? 'falta aguardando' : 'faltas aguardando'}{' '}
            justificativa.
          </strong>{' '}
          O motivo definitivo poderá ser atualizado posteriormente, sem alterar o total
          de faltas.
        </p>
      )}

      {/*
        Só o caso que exige ação ganha uma linha própria. Quando fecha, o
        contador verde acima já confirmou — repetir "motivos completos" logo
        abaixo era dizer duas vezes a mesma coisa boa.
      */}
      {!closed && (
        <p className="reasons__alert">
          {informed < target
            ? `Falta informar o motivo de ${plural(target - informed, 'falta', 'faltas')}.`
            : /* Acontece de verdade: o gerente lança 3 faltas, informa 3 motivos
                 e depois corrige as faltas para 2. Sem esta frase, o contador
                 diria "3 de 2" sem explicar o que fazer. */
              `Há ${plural(informed - target, 'motivo', 'motivos')} a mais do que faltas. Ajuste os números.`}
        </p>
      )}
    </div>
  );
}
