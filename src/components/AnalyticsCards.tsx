import type { Delta, HeadlineMetrics, PeriodKind } from '@/types/analytics';
import { formatPercent } from '@/domain/analytics';

interface Props {
  headline: HeadlineMetrics;
  kind: PeriodKind;
  /** Total de lojas ativas visíveis ao perfil (denominador do modo DIA). */
  storeCount: number;
  /** Dias do período — denominador da média. */
  days: number;
}

/** `13,4` — uma casa decimal, ou `—` quando não há base. */
function decimal(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits).replace('.', ',');
}

/** `96,4%` — ou `—`. */
function percent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits).replace('.', ',')}%`;
}

/** Variação contra o período anterior, ou o aviso de que não há base. */
function DeltaNote({ delta }: { delta: Delta }) {
  if (!delta.hasBase || delta.percent === null) {
    return <p className="summary-card__note">Sem base para comparação</p>;
  }

  const subiu = delta.percent > 0;
  const estavel = Math.abs(delta.percent) < 0.05;

  return (
    <p
      className={`summary-card__note${
        estavel ? '' : subiu ? ' summary-card__note--up' : ' summary-card__note--down'
      }`}
    >
      {estavel ? 'Igual ao' : `${formatPercent(delta.percent)} vs`} período anterior
    </p>
  );
}

/**
 * Cards do topo da Visão da Rede.
 *
 * A MÉTRICA DE ENTREGA MUDA COM O PERÍODO, de propósito:
 *
 *   DIA      -> "Enviaram 1 / 1 lojas". Faz sentido: um dia, uma conferência
 *               por loja.
 *   PERÍODOS -> "Conferências 5 / 7 esperadas". Em 7 dias, dizer "1 de 1 loja"
 *               esconderia 6 dias sem conferência. O denominador passa a ser
 *               lojas × dias, que é o que realmente se espera receber.
 *
 * Era o ponto ambíguo apontado no pedido; a saída foi trocar a métrica junto
 * com o período em vez de forçar um número que serve para os dois.
 */
export function AnalyticsCards({ headline, kind, storeCount, days }: Props) {
  const { coverage } = headline;
  const modoDia = kind === 'DAY';
  const diasDoPeriodo = days;
  /** Abaixo de 90% de cobertura a média já engana bastante. */
  const coverageDiluted = coverage.rate !== null && coverage.rate < 0.9;

  return (
    <section className="summary summary--analytics" aria-label="Resumo do período">
      <article
        className={`summary-card ${
          headline.totalAbsences > 0 ? 'summary-card--danger' : 'summary-card--neutral'
        }`}
      >
        <p className="summary-card__label">Faltas</p>
        <p className="summary-card__value">{headline.totalAbsences}</p>
        <DeltaNote delta={headline.absencesDelta} metric="absences" />
      </article>

      <article className="summary-card summary-card--neutral">
        <p className="summary-card__label">Folgas</p>
        <p className="summary-card__value">{headline.totalDayOffs}</p>
        <DeltaNote delta={headline.dayOffsDelta} metric="dayOffs" />
      </article>

      {/*
        A fórmula segue sendo faltas ÷ DIAS DO PERÍODO (o calendário), não dias
        com dado — mudá-la em silêncio faria o número saltar sem explicação.
        Mas com cobertura baixa a média fica diluída, e isso agora está escrito
        no próprio card em vez de só na documentação.
      */}
      <article className="summary-card summary-card--neutral">
        <p className="summary-card__label">Média por dia</p>
        <p className="summary-card__value">{decimal(headline.absencesPerDay)}</p>
        <p className="summary-card__note">
          {coverageDiluted
            ? `Faltas ÷ ${diasDoPeriodo} dias · diluída pela cobertura de ${percent(coverage.rate)}`
            : 'Faltas ÷ dias do período'}
        </p>
      </article>

      <article className="summary-card summary-card--neutral">
        <p className="summary-card__label">Lojas com falta</p>
        <p className="summary-card__value">{headline.storesWithAbsence}</p>
        <p className="summary-card__note">
          de {storeCount} {storeCount === 1 ? 'loja' : 'lojas'}
        </p>
      </article>

      <article
        className={`summary-card ${
          coverage.rate !== null && coverage.rate >= 1
            ? 'summary-card--success'
            : 'summary-card--neutral'
        }`}
      >
        <p className="summary-card__label">{modoDia ? 'Enviaram' : 'Conferências'}</p>
        <p className="summary-card__value summary-card__value--pair">
          {coverage.submitted}
          <span className="summary-card__pair-total">/ {coverage.expected}</span>
        </p>
        <p className="summary-card__note">
          {modoDia ? 'lojas no dia' : 'enviadas / esperadas'}
        </p>
      </article>

      <article
        className={`summary-card ${
          coverage.pending > 0 ? 'summary-card--warning' : 'summary-card--neutral'
        }`}
      >
        <p className="summary-card__label">Cobertura</p>
        <p className="summary-card__value">{percent(coverage.rate)}</p>
        <p className="summary-card__note">
          {coverage.pending > 0
            ? `${coverage.pending} ${coverage.pending === 1 ? 'pendente' : 'pendentes'}`
            : 'Nenhuma pendência'}
        </p>
      </article>
    </section>
  );
}
