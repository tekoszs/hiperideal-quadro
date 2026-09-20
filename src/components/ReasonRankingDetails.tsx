import { useMemo, useState } from 'react';
import type { ReasonDetailEntry, ReasonEntry } from '@/types/analytics';
import { formatBrDate } from '@/utils/date';
import { normalizeForSearch } from '@/utils/text';

interface Props {
  reasons: ReasonEntry[];
  details: ReasonDetailEntry[];
  ariaLabel: string;
  emptyMessage: string;
  /** No detalhe de uma loja o nome dela já está no cabeçalho. */
  showStore?: boolean;
  limit?: number;
}

function formatShare(share: number | null): string {
  if (share === null) return '—';
  return `${share.toFixed(1).replace('.', ',')}%`;
}

function isGenericReason(name: string): boolean {
  const normalized = normalizeForSearch(name);
  return normalized === 'outro' || normalized === 'outros' || normalized.startsWith('outro ');
}

/**
 * Ranking de motivos com detalhe contextual para motivos genéricos.
 *
 * "Outros" pode esconder a informação mais importante. Só esses motivos ficam
 * clicáveis e expandem no próprio card, preservando data, loja, função,
 * quantidade e a observação registrada.
 */
export function ReasonRankingDetails({
  reasons,
  details,
  ariaLabel,
  emptyMessage,
  showStore = true,
  limit = 8,
}: Props) {
  const [expandedReasonId, setExpandedReasonId] = useState<string | null>(null);

  const detailsByReason = useMemo(() => {
    const map = new Map<string, ReasonDetailEntry[]>();
    for (const detail of details) {
      const current = map.get(detail.reasonId);
      if (current) current.push(detail);
      else map.set(detail.reasonId, [detail]);
    }
    return map;
  }, [details]);

  if (reasons.length === 0) {
    return <p className="ranking__empty">{emptyMessage}</p>;
  }

  const visible = reasons.slice(0, limit);
  const remaining = reasons.length - visible.length;
  const leader = Math.max(0, ...visible.map((row) => row.quantity));
  const widthOf = (value: number) => (leader > 0 ? (value / leader) * 100 : 0);

  return (
    <>
      <ol className="ranking reason-ranking" aria-label={ariaLabel}>
        {visible.map((reason, index) => {
          const expandable = isGenericReason(reason.reasonName);
          const expanded = expandable && expandedReasonId === reason.reasonId;
          const reasonDetails = detailsByReason.get(reason.reasonId) ?? [];

          const content = (
            <>
              <span className="ranking__pos">{index + 1}</span>
              <span className="ranking__identity">
                <span className="ranking__label">{reason.reasonName}</span>
                {expandable && (
                  <span className="reason-ranking__hint">
                    {expanded ? 'Ocultar detalhes' : 'Ver detalhes'}
                    <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
                  </span>
                )}
              </span>
              <span className="ranking__track" aria-hidden="true">
                <span
                  className="ranking__bar"
                  style={{ width: `${widthOf(reason.quantity)}%` }}
                />
              </span>
              <span className="ranking__value">{reason.quantity}</span>
              <span className="ranking__share">{formatShare(reason.share)}</span>
            </>
          );

          return (
            <li
              key={reason.reasonId}
              className={`ranking__row${expanded ? ' reason-ranking__row--open' : ''}`}
            >
              {expandable ? (
                <button
                  type="button"
                  className="ranking__button reason-ranking__button"
                  onClick={() =>
                    setExpandedReasonId(expanded ? null : reason.reasonId)
                  }
                  aria-expanded={expanded}
                  aria-label={`${expanded ? 'Ocultar' : 'Ver'} detalhes do motivo ${reason.reasonName}`}
                >
                  {content}
                </button>
              ) : (
                <span className="ranking__button ranking__button--static">{content}</span>
              )}

              {expanded && (
                <div className="reason-details" role="region" aria-label="Detalhes do motivo Outros">
                  {reasonDetails.length === 0 ? (
                    <p className="reason-details__empty">
                      Sem detalhamento informado pela loja.
                    </p>
                  ) : (
                    <ul className="reason-details__list">
                      {reasonDetails.map((detail, detailIndex) => (
                        <li
                          key={`${detail.reasonId}-${detail.referenceDate}-${detail.storeId}-${detail.positionId}-${detailIndex}`}
                          className="reason-details__item"
                        >
                          <div className="reason-details__meta">
                            <strong>{formatBrDate(detail.referenceDate)}</strong>
                            {showStore && (
                              <span>
                                {detail.storeCode ? `${detail.storeCode} · ` : ''}
                                {detail.storeName}
                              </span>
                            )}
                            <span>{detail.positionName}</span>
                            <span className="reason-details__qty">
                              {detail.quantity}{' '}
                              {detail.quantity === 1 ? 'falta' : 'faltas'}
                            </span>
                          </div>

                          <p
                            className={
                              detail.observation
                                ? 'reason-details__observation'
                                : 'reason-details__observation reason-details__observation--empty'
                            }
                          >
                            <span>Observação</span>
                            {detail.observation ?? 'Sem detalhamento informado pela loja.'}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {remaining > 0 && (
        <p className="ranking__more">
          e mais {remaining} {remaining === 1 ? 'motivo' : 'motivos'}
        </p>
      )}
    </>
  );
}
