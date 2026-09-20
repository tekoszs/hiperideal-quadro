import { useEffect } from 'react';
import type {
  AbsenceReason,
  ConferenceSummary,
  DailyConference,
  Position,
  Store,
} from '@/types/domain';
import { getOccurrences } from '@/domain/summary';
import { formatBrDate } from '@/utils/date';
import { pluralize } from '@/utils/number';

interface Props {
  open: boolean;
  store: Store | null;
  conference: DailyConference;
  summary: ConferenceSummary;
  positions: Position[];
  reasons: AbsenceReason[];
  sending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Resumo final antes do envio definitivo. */
export function ConfirmSubmitModal({
  open,
  store,
  conference,
  summary,
  positions,
  reasons,
  sending,
  onCancel,
  onConfirm,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !sending) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, sending, onCancel]);

  if (!open) return null;

  const positionName = (positionId: string) =>
    positions.find((position) => position.id === positionId)?.name ?? positionId;
  const reasonName = (reasonId: string) =>
    reasons.find((reason) => reason.id === reasonId)?.name ?? reasonId;

  const occurrences = getOccurrences(conference);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={(event) => {
        if (event.target === event.currentTarget && !sending) onCancel();
      }}
    >
      <div className="modal">
        <div className="modal__head">
          <h2 className="modal__title" id="confirm-title">
            {store?.name ?? 'Loja'}
          </h2>
          <p className="modal__subtitle">
            Referência {formatBrDate(conference.referenceDate)} — confira antes de enviar
          </p>
        </div>

        <div className="modal__body">
          <div className="modal__totals">
            <div className="modal__total">
              <p className="modal__total-label">Faltas</p>
              <p
                className="modal__total-value"
                style={{ color: summary.totalAbsences > 0 ? 'var(--hi-danger)' : undefined }}
              >
                {summary.totalAbsences}
              </p>
            </div>
            <div className="modal__total">
              <p className="modal__total-label">Folgas</p>
              <p className="modal__total-value">{summary.totalDayOffs}</p>
            </div>
            <div className="modal__total">
              <p className="modal__total-label">Funções impactadas</p>
              <p className="modal__total-value">{summary.impactedPositions}</p>
            </div>
          </div>

          <h3 className="section__title" style={{ marginBottom: 12 }}>
            Ocorrências
          </h3>

          {occurrences.length === 0 ? (
            <div className="alert alert--warning">
              Nenhuma falta e nenhuma folga registrada neste dia. Confirme que o dia foi
              realmente sem ocorrências antes de enviar.
            </div>
          ) : (
            occurrences.map((item) => (
              <div className="occurrence" key={item.id}>
                <p className="occurrence__name">{positionName(item.positionId)}</p>

                {item.absenceQuantity > 0 && (
                  <>
                    <p className="occurrence__line occurrence__line--danger">
                      {pluralize(item.absenceQuantity, 'falta', 'faltas')}
                    </p>
                    <ul className="occurrence__reasons">
                      {item.reasons
                        .filter((reason) => reason.quantity > 0)
                        .map((reason) => (
                          <li key={reason.id}>
                            {reason.quantity} {reasonName(reason.reasonId)}
                            {reason.observation ? ` — ${reason.observation}` : ''}
                          </li>
                        ))}
                    </ul>
                  </>
                )}

                {item.dayOffQuantity > 0 && (
                  <p className="occurrence__line">
                    {pluralize(item.dayOffQuantity, 'folga', 'folgas')}
                  </p>
                )}

                {item.observation && (
                  <p className="occurrence__obs">Obs.: {item.observation}</p>
                )}
              </div>
            ))
          )}
        </div>

        <div className="modal__foot">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={sending}>
            Voltar e corrigir
          </button>
          <button type="button" className="btn btn--primary" onClick={onConfirm} disabled={sending}>
            {sending ? 'Enviando...' : 'Enviar conferência'}
          </button>
        </div>
      </div>
    </div>
  );
}
