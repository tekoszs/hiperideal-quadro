import { useEffect } from 'react';
import type { FocusAnalysis, ResolvedPeriod } from '@/types/analytics';
import type { FocusPeriodKind } from '@/hooks/useNetworkAnalytics';
import { RankingBars } from '@/components/charts/RankingBars';
import { describeRange } from '@/domain/period';
import { formatBrDate } from '@/utils/date';

interface Props {
  analysis: FocusAnalysis;
  period: ResolvedPeriod;
  focusPeriodKind: FocusPeriodKind;
  onFocusPeriodChange: (kind: FocusPeriodKind) => void;
  onClose: () => void;
  /** Abre o detalhe de uma loja, sem fechar este drawer. */
  onOpenStore: (storeId: string) => void;
}

/**
 * FASE 4.2 + FASE F — o detalhe de uma FUNÇÃO, GRUPO ou SETOR.
 *
 * UM drawer para os três, porque a pergunta é a mesma: "isto aconteceu ONDE, e
 * por quê". Três telas quase idênticas divergiriam na primeira correção feita
 * numa e esquecida nas outras.
 *
 * SOMENTE LEITURA. Nada aqui edita conferência.
 *
 * ORDEM DA TABELA DE LOJAS: mais faltas primeiro e, no empate, a ocorrência
 * mais recente. É a ordem de quem vai agir — duas lojas com 3 faltas não são
 * iguais se uma parou ontem e a outra há duas semanas.
 */
export function FocusDrawer({
  analysis,
  period,
  focusPeriodKind,
  onFocusPeriodChange,
  onClose,
  onOpenStore,
}: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Detalhe de ${analysis.title}`}
      >
        <header className="drawer__head">
          <div>
            <h3 className="drawer__title">{analysis.title}</h3>
            <p className="drawer__subtitle">
              {describeRange(period.range)}
              {analysis.subtitle ? ` · ${analysis.subtitle}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="drawer__close"
            onClick={onClose}
            aria-label="Fechar detalhe"
          >
            ×
          </button>
        </header>

        <div className="drawer__body">
          {/* FASE F — seletor SEMANA | MÊS */}
          <div className="focus-period-toggle" role="group" aria-label="Período do detalhe">
            <button
              type="button"
              className={`focus-period-toggle__btn${focusPeriodKind === 'SEMANA' ? ' focus-period-toggle__btn--on' : ''}`}
              aria-pressed={focusPeriodKind === 'SEMANA'}
              onClick={() => onFocusPeriodChange('SEMANA')}
            >
              SEMANA
            </button>
            <button
              type="button"
              className={`focus-period-toggle__btn${focusPeriodKind === 'MÊS' ? ' focus-period-toggle__btn--on' : ''}`}
              aria-pressed={focusPeriodKind === 'MÊS'}
              onClick={() => onFocusPeriodChange('MÊS')}
            >
              MÊS
            </button>
          </div>

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
              <span className="drawer__total-label">Lojas impactadas</span>
              <span className="drawer__total-value">{analysis.storesAffected}</span>
            </div>
          </div>

          {analysis.isEmpty ? (
            <p className="ranking__empty">
              Nenhuma falta registrada para este recorte no período selecionado.
            </p>
          ) : (
            <>
              {/* ------------------------------------------------- as lojas */}
              <section className="panel focus-stores-panel">
                <div className="focus-stores-panel__head">
                  <div>
                    <p className="focus-stores-panel__eyebrow">Onde está acontecendo</p>
                    <h4 className="panel__title">Lojas impactadas</h4>
                  </div>
                  <span className="focus-stores-panel__badge">
                    {analysis.storesAffected} {analysis.storesAffected === 1 ? 'loja' : 'lojas'}
                  </span>
                </div>
                <div className="focus-table__scroll">
                  <table className="focus-table">
                    <thead>
                      <tr>
                        <th scope="col">Loja</th>
                        <th scope="col" className="focus-table__num">
                          Faltas
                        </th>
                        <th scope="col" className="focus-table__num">
                          Dias com falta
                        </th>
                        <th scope="col" className="focus-table__num">
                          Última ocorrência
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.stores.map((store) => (
                        <tr key={store.storeId}>
                          <td data-label="Loja">
                            <button
                              type="button"
                              className="focus-table__store"
                              onClick={() => onOpenStore(store.storeId)}
                            >
                              <span className="focus-table__code">{store.storeCode}</span>
                              <span className="focus-table__name">{store.storeName}</span>
                            </button>
                          </td>
                          <td data-label="Faltas" className="focus-table__num">
                            <strong>{store.absences}</strong>
                          </td>
                          <td data-label="Dias com falta" className="focus-table__num">
                            {store.daysWithAbsence === 1
                              ? '1 dia'
                              : `${store.daysWithAbsence} dias`}
                          </td>
                          <td data-label="Última ocorrência" className="focus-table__num">
                            {store.lastOccurrence ? formatBrDate(store.lastOccurrence) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="focus-stores-panel__hint">
                  Clique em uma loja para abrir faltas, funções, motivos e ocorrências do período.
                </p>
              </section>

              {/* --------------------------------------------- os motivos */}
              <section className="panel">
                <h4 className="panel__title">Motivos</h4>
                <RankingBars
                  ariaLabel={`Motivos das faltas em ${analysis.title}`}
                  emptyMessage="Nenhum motivo registrado no período."
                  rows={analysis.reasons.map((entry) => ({
                    key: entry.reasonId,
                    label: entry.reasonName,
                    value: entry.quantity,
                    share: entry.share,
                  }))}
                />
              </section>

              {/* Funções de dentro do grupo/setor. Vazio quando o foco já é
                  uma função — repetir a própria função não informaria nada. */}
              {analysis.positions.length > 0 && (
                <section className="panel">
                  <h4 className="panel__title">Funções deste recorte</h4>
                  <RankingBars
                    ariaLabel={`Funções com mais faltas em ${analysis.title}`}
                    emptyMessage="Nenhuma falta registrada no período."
                    rows={analysis.positions.map((entry) => ({
                      key: entry.positionId,
                      label: entry.label,
                      hint: `${entry.storesAffected} ${entry.storesAffected === 1 ? 'loja' : 'lojas'}`,
                      value: entry.absences,
                      share: entry.share,
                    }))}
                  />
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
