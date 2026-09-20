import type { DailyPoint, DayCoverageState } from '@/types/analytics';
import { formatBrDate } from '@/utils/date';

export interface BarPoint {
  /** Rótulo curto do eixo. */
  label: string;
  value: number;
  /** Texto do tooltip nativo (hover e leitor de tela). */
  title: string;
  /**
   * Estado de cobertura do ponto.
   *
   *   COMPLETE  todas as lojas esperadas enviaram — o valor é definitivo,
   *             inclusive quando é zero;
   *   PARTIAL   parte enviou — o valor vale, mas está incompleto;
   *   NO_DATA   ninguém enviou — NÃO existe valor apurado.
   *
   * Ausente = COMPLETE (usado pelo gráfico de dia da semana, que é acumulado
   * e não tem noção de cobertura diária).
   */
  state?: DayCoverageState;
}

interface Props {
  points: BarPoint[];
  /** Cor da série. UMA por gráfico — ver a nota sobre vermelho e laranja. */
  tone: 'danger' | 'brand';
  /** Rótulo acessível do gráfico inteiro. */
  ariaLabel: string;
  /** Mostra o rótulo do eixo só a cada N barras (30 dias não cabem todos). */
  labelEvery?: number;
  /** Exibe a legenda dos estados. Só faz sentido quando há dias sem dado. */
  showLegend?: boolean;
}

/**
 * Gráfico de barras em CSS puro — sem biblioteca.
 *
 * POR QUE SEM BIBLIOTECA: medi o Recharts neste projeto e ele acrescentava
 * 360 kB (106 kB comprimidos) ao pacote, quase dobrando o tamanho, para três
 * gráficos de barra. Barras em CSS custam zero, redimensionam sozinhas e não
 * distorcem texto ao encolher.
 *
 * SEMPRE UMA SÉRIE SÓ. Faltas e folgas têm grandezas diferentes e trocam pelo
 * alternador, nunca dividem o mesmo eixo — dois eixos Y no mesmo gráfico é o
 * erro clássico que faz duas curvas parecerem comparáveis quando não são.
 *
 * E o vermelho (#C62828) e o laranja (#A85B00) da identidade NUNCA aparecem
 * como duas séries no mesmo gráfico: medidos, ficam a ΔE 1,7 sob daltonismo
 * deuteranopia — seriam a mesma cor para boa parte das pessoas. Aqui eles são
 * cores de status, sempre acompanhadas de texto.
 *
 * TRÊS ESTADOS, NÃO UM. Um dia sem conferência não vira barra de altura zero:
 * isso seria indistinguível de um dia em que todas as lojas enviaram e ninguém
 * faltou. O primeiro é "não sabemos"; o segundo é "sabemos, e foi zero". O
 * estado NO_DATA desenha um traço tracejado no lugar da barra; o PARTIAL
 * desenha a barra com listras. Nunca só a cor: há textura, legenda e tooltip.
 */
export function BarSeries({
  points,
  tone,
  ariaLabel,
  labelEvery = 1,
  showLegend = false,
}: Props) {
  const maximo = Math.max(0, ...points.map((point) => point.value));
  // Sem valor nenhum, todas as barras ficam rentes à base — nada de divisão por
  // zero produzindo NaN na altura.
  const alturaDe = (value: number) => (maximo > 0 ? (value / maximo) * 100 : 0);

  const temSemDado = points.some((point) => point.state === 'NO_DATA');
  const temParcial = points.some((point) => point.state === 'PARTIAL');

  return (
    <div className={`bars bars--${tone}`}>
      <div className="bars__plot" role="img" aria-label={ariaLabel}>
        {points.map((point, index) => {
          const state = point.state ?? 'COMPLETE';
          const semDado = state === 'NO_DATA';

          return (
            <div key={`${point.label}-${index}`} className="bars__col">
              <div className="bars__track">
                {semDado ? (
                  // Sem conferência: nada foi apurado. Um traço tracejado
                  // ocupa o lugar da barra, e o tooltip explica.
                  <div className="bars__gap" title={point.title} />
                ) : (
                  <div
                    className={`bars__bar${state === 'PARTIAL' ? ' bars__bar--partial' : ''}`}
                    style={{ height: `${alturaDe(point.value)}%` }}
                    title={point.title}
                  >
                    <span className="bars__value">{point.value > 0 ? point.value : ''}</span>
                  </div>
                )}
              </div>
              <span className={`bars__label${semDado ? ' bars__label--muted' : ''}`}>
                {index % labelEvery === 0 || index === points.length - 1 ? point.label : ''}
              </span>
            </div>
          );
        })}
      </div>

      {showLegend && (temSemDado || temParcial) && (
        <ul className="bars__legend">
          {temSemDado && (
            <li>
              <span className="bars__key bars__key--gap" aria-hidden="true" />
              Sem conferência — nada apurado
            </li>
          )}
          {temParcial && (
            <li>
              <span className="bars__key bars__key--partial" aria-hidden="true" />
              Dados parciais — nem todas as lojas enviaram
            </li>
          )}
          <li>
            <span className="bars__key" aria-hidden="true" />
            Cobertura completa
          </li>
        </ul>
      )}
    </div>
  );
}

/** `05/09` — rótulo curto do eixo. */
function shortDay(iso: string): string {
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

/** `42,9%` — ou `—`. */
function percent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1).replace('.', ',')}%`;
}

/**
 * Converte um ponto da série diária em barra, com o tooltip contando a
 * história inteira: o valor, a cobertura e o que ela significa.
 *
 * Exemplo de um dia parcial:
 *   05/09/2026 · Faltas: 4 · Conferências: 12 de 28 (42,9%) · Dados parciais
 */
export function toBarPoint(point: DailyPoint, serie: 'absences' | 'dayOffs'): BarPoint {
  const valor = serie === 'absences' ? point.absences : point.dayOffs;
  const nome = serie === 'absences' ? 'Faltas' : 'Folgas';
  const data = formatBrDate(point.date);
  const cobertura = `Conferências: ${point.submitted} de ${point.expected} (${percent(point.coverage)})`;

  const title =
    point.state === 'NO_DATA'
      ? `${data} · Sem conferência enviada — nada apurado (0 de ${point.expected})`
      : point.state === 'PARTIAL'
        ? `${data} · ${nome}: ${valor} · ${cobertura} · Dados parciais`
        : `${data} · ${nome}: ${valor} · ${cobertura} · Cobertura completa`;

  return { label: shortDay(point.date), value: valor, title, state: point.state };
}
