import { useEffect } from 'react';
import type { ResolvedPeriod, StoreAnalysis } from '@/types/analytics';
import { BarSeries, toBarPoint } from '@/components/charts/BarSeries';
import { RankingBars } from '@/components/charts/RankingBars';
import { describeRange } from '@/domain/period';
import { NETWORK_STATUS_LABEL, NETWORK_STATUS_TONE } from '@/lib/constants';
import { formatBrDate } from '@/utils/date';

interface Props {
  analysis: StoreAnalysis;
  period: ResolvedPeriod;
  onClose: () => void;
  /** Leva para a tela Conferências já naquela data. */
  onOpenConferences: (referenceDate: string) => void;
}

/**
 * Análise de UMA loja no período, aberta pelo ranking.
 *
 * Somente leitura. O caminho para o detalhe operacional de um dia é o link
 * para a tela Conferências, que já existe e já mostra motivos e observações —
 * em vez de duplicar aqui a mesma informação.
 */
export function StoreAnalysisDrawer({ analysis, period, onClose, onOpenConferences }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mostrarEvolucao = analysis.daily.length > 1;

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Análise de ${analysis.storeName}`}
      >
        <header className="drawer__head">
          <div>
            <h3 className="drawer__title">{analysis.storeName}</h3>
            <p className="drawer__subtitle">
              {describeRange(period.range)} · Código {analysis.storeCode}
            </p>
          </div>
          <button
            type="button"
            className="drawer__close"
            onClick={onClose}
            aria-label="Fechar análise"
          >
            ×
          </button>
        </header>

        <div className="drawer__body">
          <div className="drawer__totals">
            <div
              className={
                analysis.totalAbsences > 0 ? 'drawer__total drawer__total--danger' : 'drawer__total'
              }
            >
              <span className="drawer__total-label">Faltas</span>
              <span className="drawer__total-value">{analysis.totalAbsences}</span>
            </div>
            <div className="drawer__total">
              <span className="drawer__total-label">Folgas</span>
              <span className="drawer__total-value">{analysis.totalDayOffs}</span>
            </div>
            <div className="drawer__total">
              <span className="drawer__total-label">Dias com falta</span>
              <span className="drawer__total-value">{analysis.daysWithAbsence}</span>
            </div>
          </div>

          {mostrarEvolucao && (
            <section className="panel">
              <h4 className="panel__title">Evolução das faltas</h4>
              <BarSeries
                tone="danger"
                ariaLabel={`Faltas por dia em ${analysis.storeName}`}
                labelEvery={analysis.daily.length > 10 ? 5 : 1}
                points={analysis.daily.map((point) => toBarPoint(point, 'absences'))}
              />
            </section>
          )}

          <section className="panel">
            <h4 className="panel__title">Funções mais impactadas</h4>
            <RankingBars
              ariaLabel={`Funções com mais faltas em ${analysis.storeName}`}
              emptyMessage="Nenhuma falta registrada no período."
              rows={analysis.positions.map((entry) => ({
                key: entry.positionId,
                label: entry.label,
                hint: entry.sector ?? undefined,
                value: entry.absences,
                share: entry.share,
              }))}
            />
          </section>

          <section className="panel">
            <h4 className="panel__title">Motivos</h4>
            <RankingBars
              ariaLabel={`Motivos das faltas em ${analysis.storeName}`}
              emptyMessage="Nenhum motivo registrado no período."
              rows={analysis.reasons.map((entry) => ({
                key: entry.reasonId,
                label: entry.reasonName,
                value: entry.quantity,
                share: entry.share,
              }))}
            />
          </section>

          {/* -------------------------------------------- dia a dia (4.2)
              Datas, quantidades, motivos e observações — tudo dos dados JÁ
              carregados do período. Abrir a loja não dispara consulta nenhuma.

              Mostra TODAS as funções com ocorrência no dia, e não só a que
              trouxe o usuário até aqui: uma padeira faltando sozinha é uma
              coisa, três funções faltando no mesmo dia é outra. */}
          {analysis.days.length > 0 && (
            <section className="panel">
              <h4 className="panel__title">Ocorrências, dia a dia</h4>
              <ul className="day-list">
                {analysis.days.map((dia) => (
                  <li key={dia.date} className="day-list__item">
                    <div className="day-list__head">
                      <span className="day-list__date">{formatBrDate(dia.date)}</span>
                      <span className="day-list__totals">
                        {dia.absences > 0 && (
                          <span className="day-list__pill day-list__pill--danger">
                            {dia.absences} {dia.absences === 1 ? 'falta' : 'faltas'}
                          </span>
                        )}
                        {dia.dayOffs > 0 && (
                          <span className="day-list__pill">
                            {dia.dayOffs} {dia.dayOffs === 1 ? 'folga' : 'folgas'}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => onOpenConferences(dia.date)}
                      >
                        Ver conferência
                      </button>
                    </div>

                    <ul className="day-list__occurrences">
                      {dia.occurrences.map((ocorrencia) => (
                        <li
                          key={ocorrencia.positionId}
                          className={
                            ocorrencia.positionId === analysis.highlightPositionId
                              ? 'occurrence occurrence--highlight'
                              : 'occurrence'
                          }
                        >
                          <div className="occurrence__head">
                            <span className="occurrence__name">{ocorrencia.positionName}</span>
                            <span className="occurrence__nums">
                              {ocorrencia.absences > 0 && (
                                <strong>{ocorrencia.absences} falta(s)</strong>
                              )}
                              {ocorrencia.dayOffs > 0 && (
                                <span>{ocorrencia.dayOffs} folga(s)</span>
                              )}
                            </span>
                          </div>

                          {ocorrencia.reasons.length > 0 && (
                            <ul className="occurrence__reasons">
                              {ocorrencia.reasons.map((motivo) => (
                                <li key={motivo.reasonId}>
                                  <span className="occurrence__reason-name">
                                    {motivo.reasonName}
                                  </span>
                                  <span className="occurrence__reason-qty">
                                    {motivo.quantity}
                                  </span>
                                  {motivo.observation && (
                                    <span className="occurrence__obs">
                                      {motivo.observation}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}

                          {ocorrencia.observation && (
                            <p className="occurrence__obs occurrence__obs--item">
                              {ocorrencia.observation}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel">
            <h4 className="panel__title">Conferências do período</h4>
            {analysis.conferences.length === 0 ? (
              <p className="ranking__empty">Nenhuma conferência enviada no período.</p>
            ) : (
              <ul className="conf-list">
                {analysis.conferences.map((conference) => (
                  <li key={conference.referenceDate} className="conf-list__row">
                    <span className="conf-list__date">
                      {formatBrDate(conference.referenceDate)}
                    </span>
                    <span className={`badge badge--${NETWORK_STATUS_TONE[conference.status]}`}>
                      {NETWORK_STATUS_LABEL[conference.status]}
                    </span>
                    <span className="conf-list__nums">
                      {/* Só conferência ENVIADA tem número oficial. Rascunho
                          mostra "—", não um zero que pareceria apurado. */}
                      {conference.absences === null
                        ? 'ainda não enviada'
                        : `${conference.absences} faltas · ${conference.dayOffs} folgas`}
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => onOpenConferences(conference.referenceDate)}
                    >
                      Ver conferência
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
