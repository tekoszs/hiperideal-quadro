import { useEffect, useMemo, useState } from 'react';
import type { Position, Store } from '@/types/domain';
import type { PendingJustification } from '@/domain/pendingJustification';
import { NumberStepper } from '@/components/NumberStepper';
import { getResolutionTargetReasons } from '@/data/absenceReasons';
import { formatLongBrDate } from '@/utils/date';
import { hasText } from '@/utils/text';

interface Props {
  pending: PendingJustification | null;
  store: Store | null;
  positions: Position[];
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (params: {
    toReasonId: string;
    quantity: number;
    observation: string | null;
  }) => void;
}

/**
 * FASE 4.5 — TROCAR "AGUARDANDO JUSTIFICATIVA" POR UM MOTIVO DEFINITIVO.
 *
 * O QUE ESTA TELA NÃO FAZ, e é o mais importante: ela não reabre a conferência.
 * A conferência continua ENVIADA, o total de faltas continua o mesmo, e nenhum
 * outro campo se move. A única coisa que muda é de qual motivo aquelas faltas
 * são.
 *
 *   antes:  faltas = 2 | Atestado = 1 | Aguardando = 1
 *   depois: faltas = 2 | Atestado = 2 | Aguardando = 0
 *
 * Por isso a tela mostra o total de faltas como TEXTO FIXO, não como campo: não
 * existe caminho, nesta operação, para ele mudar — e um campo editável sugeriria
 * que existe.
 */
export function ResolveJustificationModal({
  pending,
  store,
  positions,
  saving,
  error,
  onCancel,
  onConfirm,
}: Props) {
  const destinos = useMemo(() => getResolutionTargetReasons(), []);
  const [toReasonId, setToReasonId] = useState(destinos[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [observation, setObservation] = useState('');

  // Cada pendência abre o formulário do zero: manter o motivo escolhido para a
  // pendência anterior é como o gerente lança atestado na função errada.
  useEffect(() => {
    if (!pending) return;
    setToReasonId(destinos[0]?.id ?? '');
    setQuantity(pending.quantity);
    setObservation('');
  }, [pending, destinos]);

  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pending, saving, onCancel]);

  if (!pending) return null;

  const destino = destinos.find((reason) => reason.id === toReasonId);
  const nome =
    positions.find((position) => position.id === pending.positionId)?.name ??
    pending.positionId;
  const faltaObservacao = Boolean(destino?.requiresObservation) && !hasText(observation);
  const quantidadeInvalida = quantity <= 0 || quantity > pending.quantity;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resolve-title"
    >
      <div className="modal modal--resolve">
        <header className="modal__head">
          <h2 className="modal__title" id="resolve-title">
            Ajustar justificativa pendente
          </h2>
          <p className="modal__subtitle">
            {store ? `${store.name} · ` : ''}
            {formatLongBrDate(pending.referenceDate)}
          </p>
        </header>

        <div className="modal__body">
          <dl className="resolve__facts">
            <div>
              <dt>Função</dt>
              <dd>{nome}</dd>
            </div>
            <div>
              <dt>Aguardando justificativa</dt>
              <dd>
                {pending.quantity} {pending.quantity === 1 ? 'falta' : 'faltas'}
              </dd>
            </div>
          </dl>

          <div className="field">
            <label className="field__label" htmlFor="resolve-reason">
              Motivo definitivo
            </label>
            <select
              id="resolve-reason"
              className="field__input"
              value={toReasonId}
              disabled={saving}
              onChange={(event) => setToReasonId(event.target.value)}
            >
              {destinos.map((reason) => (
                <option key={reason.id} value={reason.id}>
                  {reason.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <span className="field__label" id="resolve-qty-label">
              Quantidade a resolver
            </span>
            <NumberStepper
              value={quantity}
              onChange={setQuantity}
              disabled={saving}
              max={pending.quantity}
              label="Quantidade a resolver"
            />
            <p className="field__hint">
              No máximo {pending.quantity}. O total de faltas da função não muda.
            </p>
          </div>

          <div className="field">
            <label
              className={`field__label${destino?.requiresObservation ? ' field__label--required' : ''}`}
              htmlFor="resolve-observation"
            >
              Observação {destino?.requiresObservation ? '' : '(opcional)'}
            </label>
            <textarea
              id="resolve-observation"
              className={`field__textarea${faltaObservacao ? ' field__textarea--invalid' : ''}`}
              rows={2}
              value={observation}
              disabled={saving}
              placeholder="Ex.: atestado entregue ao RH"
              onChange={(event) => setObservation(event.target.value)}
            />
            {faltaObservacao && (
              <span className="field__error">
                O motivo &quot;{destino?.name}&quot; exige observação.
              </span>
            )}
          </div>

          {error && (
            <div className="alert alert--error" role="alert">
              {error}
            </div>
          )}
        </div>

        <footer className="modal__foot">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onCancel}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() =>
              onConfirm({
                toReasonId,
                quantity,
                observation: hasText(observation) ? observation.trim() : null,
              })
            }
            disabled={saving || faltaObservacao || quantidadeInvalida}
          >
            {saving ? 'Salvando...' : 'Confirmar alteração'}
          </button>
        </footer>
      </div>
    </div>
  );
}
