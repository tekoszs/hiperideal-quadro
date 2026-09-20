import { useEffect, useMemo, useState } from 'react';
import type { DetailScope, NetworkDetail } from '@/types/network';
import { scopeDetailItems } from '@/domain/network';
import { NETWORK_STATUS_LABEL, NETWORK_STATUS_TONE } from '@/lib/constants';
import { formatBrDate, formatBrTime } from '@/utils/date';

interface Props {
  detail: NetworkDetail;
  onClose: () => void;
}

/**
 * Detalhamento da loja — abre por cima da lista, sem trocar de página.
 *
 * Os totais do cabeçalho vêm dos ITENS (uma linha por função); os motivos de
 * cada função vêm da view de motivos. Repare que a soma dos motivos de uma
 * função fecha com as faltas dela: 3 faltas em 2 motivos continuam sendo 3.
 */
export function ConferenceDetailDrawer({ detail, onClose }: Props) {
  const [scope, setScope] = useState<DetailScope>('OCCURRENCES');

  // Esc fecha, como em qualquer painel sobreposto.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const items = useMemo(() => scopeDetailItems(detail.items, scope), [detail.items, scope]);
  // PENDING = a loja não abriu conferência nesta data (não é status do banco).
  const semConferencia = detail.status === 'PENDING';

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Detalhes de ${detail.storeName}`}
      >
        <header className="drawer__head">
          <div>
            <h3 className="drawer__title">{detail.storeName}</h3>
            <p className="drawer__subtitle">
              Referência {formatBrDate(detail.referenceDate)} · Código {detail.storeCode}
            </p>
          </div>
          <button
            type="button"
            className="drawer__close"
            onClick={onClose}
            aria-label="Fechar detalhes"
          >
            ×
          </button>
        </header>

        <div className="drawer__body">
          <dl className="drawer__meta">
            <div className="drawer__meta-item">
              <dt>Status</dt>
              <dd>
                <span className={`badge badge--${NETWORK_STATUS_TONE[detail.status]}`}>
                  {NETWORK_STATUS_LABEL[detail.status]}
                </span>
              </dd>
            </div>
            <div className="drawer__meta-item">
              <dt>Enviado às</dt>
              <dd>{formatBrTime(detail.submittedAt)}</dd>
            </div>
            <div className="drawer__meta-item">
              <dt>Responsável</dt>
              {/* Nome vindo de quadro_profiles pelo submitted_by, nunca do navegador. */}
              <dd>{detail.submittedByName ?? '—'}</dd>
            </div>
          </dl>

          <div className="drawer__totals">
            <div className={detail.totalAbsences > 0 ? 'drawer__total drawer__total--danger' : 'drawer__total'}>
              <span className="drawer__total-label">Faltas</span>
              <span className="drawer__total-value">{detail.totalAbsences}</span>
            </div>
            <div className="drawer__total">
              <span className="drawer__total-label">Folgas</span>
              <span className="drawer__total-value">{detail.totalDayOffs}</span>
            </div>
            <div className="drawer__total">
              <span className="drawer__total-label">Funções impactadas</span>
              <span className="drawer__total-value">{detail.impactedPositions}</span>
            </div>
          </div>

          {semConferencia ? (
            <p className="drawer__empty">
              Esta loja ainda não enviou a conferência desta data.
            </p>
          ) : (
            <>
              <div className="scope-switch" role="group" aria-label="O que exibir">
                <button
                  type="button"
                  className={`scope-switch__btn${scope === 'OCCURRENCES' ? ' scope-switch__btn--on' : ''}`}
                  aria-pressed={scope === 'OCCURRENCES'}
                  onClick={() => setScope('OCCURRENCES')}
                >
                  Ocorrências
                </button>
                <button
                  type="button"
                  className={`scope-switch__btn${scope === 'ALL' ? ' scope-switch__btn--on' : ''}`}
                  aria-pressed={scope === 'ALL'}
                  onClick={() => setScope('ALL')}
                >
                  Todas as funções
                </button>
              </div>

              {items.length === 0 ? (
                <p className="drawer__empty">
                  Nenhuma falta ou folga registrada nesta data.
                </p>
              ) : (
                <ul className="detail-list">
                  {items.map((item) => (
                    <li key={item.positionId} className="detail-item">
                      <p className="detail-item__name">{item.positionName}</p>

                      <p className="detail-item__counts">
                        <span
                          className={
                            item.absenceQuantity > 0
                              ? 'detail-item__count detail-item__count--danger'
                              : 'detail-item__count'
                          }
                        >
                          Faltas: <strong>{item.absenceQuantity}</strong>
                        </span>
                        <span className="detail-item__count">
                          Folgas: <strong>{item.dayOffQuantity}</strong>
                        </span>
                      </p>

                      {item.absenceQuantity > 0 && (
                        <div className="detail-item__block">
                          <p className="detail-item__block-title">Motivos</p>
                          {item.reasons.length === 0 ? (
                            <p className="detail-item__soft">Sem motivo informado.</p>
                          ) : (
                            <ul className="detail-item__reasons">
                              {item.reasons.map((reason) => (
                                <li key={reason.reasonId}>
                                  <strong>{reason.quantity}</strong> — {reason.reasonName}
                                  {reason.observation && (
                                    <span className="detail-item__reason-obs">
                                      {reason.observation}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      <div className="detail-item__block">
                        <p className="detail-item__block-title">Observação</p>
                        <p className={item.observation ? 'detail-item__obs' : 'detail-item__soft'}>
                          {item.observation ?? 'Sem observação.'}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
