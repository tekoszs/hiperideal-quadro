import type { NetworkDaySummary } from '@/types/network';

interface Props {
  summary: NetworkDaySummary;
}

/**
 * LOJAS · ENVIARAM · PENDENTES · FALTAS · FOLGAS
 *
 * `stores` é a contagem real de `quadro_stores` — a tela mostra as lojas que
 * existem no banco, nunca um número de exemplo.
 *
 * Cores: laranja só quando há pendência, vermelho só em falta. Enviaram e
 * folgas ficam neutros para não transformar a tela em semáforo.
 */
export function NetworkSummaryCards({ summary }: Props) {
  return (
    <section className="summary summary--network" aria-label="Resumo do dia na rede">
      <article className="summary-card summary-card--neutral">
        <p className="summary-card__label">Lojas</p>
        <p className="summary-card__value">{summary.stores}</p>
        <p className="summary-card__note">Cadastradas e ativas</p>
      </article>

      <article
        className={`summary-card ${
          summary.stores > 0 && summary.submitted === summary.stores
            ? 'summary-card--success'
            : 'summary-card--neutral'
        }`}
      >
        <p className="summary-card__label">Enviaram</p>
        <p className="summary-card__value">{summary.submitted}</p>
        <p className="summary-card__note">
          {summary.stores > 0 && summary.submitted === summary.stores
            ? 'Rede completa'
            : `de ${summary.stores}`}
        </p>
      </article>

      <article
        className={`summary-card ${
          summary.pending > 0 ? 'summary-card--warning' : 'summary-card--neutral'
        }`}
      >
        <p className="summary-card__label">Pendentes</p>
        <p className="summary-card__value">{summary.pending}</p>
        <p className="summary-card__note">
          {summary.pending > 0 ? 'Ainda não enviaram' : 'Nenhuma pendência'}
        </p>
      </article>

      <article
        className={`summary-card ${
          summary.totalAbsences > 0 ? 'summary-card--danger' : 'summary-card--neutral'
        }`}
      >
        <p className="summary-card__label">Faltas</p>
        <p className="summary-card__value">{summary.totalAbsences}</p>
        <p className="summary-card__note">Total da rede no dia</p>
      </article>

      <article className="summary-card summary-card--neutral">
        <p className="summary-card__label">Folgas</p>
        <p className="summary-card__value">{summary.totalDayOffs}</p>
        <p className="summary-card__note">Não contam como falta</p>
      </article>
    </section>
  );
}
