import type { ConferenceSummary } from '@/types/domain';

interface Props {
  summary: ConferenceSummary;
}

/**
 * Cards do topo. Os números vêm de `buildSummary` e mudam em tempo real.
 *
 * O CARD DE STATUS SAIU NA FASE 4.4. Ele repetia, em quarto lugar e em letra
 * miúda, o que o título da conferência já anuncia em cima com um selo. Três
 * cards de número e um de texto também desalinhavam a fileira. Com três, a
 * grade fecha certo e o que sobrou são só medidas do dia.
 */
export function SummaryCards({ summary }: Props) {
  return (
    <section className="summary summary--conference" aria-label="Resumo da conferência">
      <article
        className={`summary-card ${summary.totalAbsences > 0 ? 'summary-card--danger' : 'summary-card--neutral'}`}
      >
        <p className="summary-card__label">Faltas</p>
        <p className="summary-card__value">{summary.totalAbsences}</p>
        {summary.reasonsPending > 0 ? (
          <p className="summary-card__note">{summary.reasonsPending} sem motivo informado</p>
        ) : (
          <p className="summary-card__note">Todos os motivos informados</p>
        )}
      </article>

      <article className="summary-card summary-card--neutral">
        <p className="summary-card__label">Folgas</p>
        <p className="summary-card__value">{summary.totalDayOffs}</p>
        <p className="summary-card__note">Não contam como falta</p>
      </article>

      <article className="summary-card summary-card--neutral">
        <p className="summary-card__label">Funções impactadas</p>
        <p className="summary-card__value">{summary.impactedPositions}</p>
        <p className="summary-card__note">Com falta ou folga</p>
      </article>
    </section>
  );
}
