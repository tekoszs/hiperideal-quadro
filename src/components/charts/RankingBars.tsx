export interface RankingRow {
  key: string;
  label: string;
  /** Linha menor sob o rótulo (setor, código da loja, quantidade de lojas). */
  hint?: string;
  value: number;
  /** Percentual já calculado. null = sem base, exibido como "—". */
  share: number | null;
  /** Texto à direita, quando o ranking tem uma métrica extra. */
  extra?: string;
}

interface Props {
  rows: RankingRow[];
  ariaLabel: string;
  emptyMessage: string;
  /** Torna cada linha clicável (usado no ranking de lojas). */
  onSelect?: (key: string) => void;
  /** Quantas linhas exibir. O resto vira "e mais N". */
  limit?: number;
}

/** `12,5%` — ou `—` quando não há base para o percentual. */
function formatShare(share: number | null): string {
  if (share === null) return '—';
  return `${share.toFixed(1).replace('.', ',')}%`;
}

/**
 * Ranking com barra proporcional.
 *
 * A barra é comparada com o PRIMEIRO colocado, não com o total: o objetivo é
 * ver a distância entre as posições, e uma barra de 3% do total viraria um
 * traço invisível.
 *
 * Uma série só, um tom só. O número fica em texto normal ao lado — a cor
 * carrega magnitude, o texto carrega o valor.
 */
export function RankingBars({ rows, ariaLabel, emptyMessage, onSelect, limit = 8 }: Props) {
  if (rows.length === 0) {
    return <p className="ranking__empty">{emptyMessage}</p>;
  }

  const visiveis = rows.slice(0, limit);
  const restantes = rows.length - visiveis.length;
  const lider = Math.max(0, ...visiveis.map((row) => row.value));
  const larguraDe = (value: number) => (lider > 0 ? (value / lider) * 100 : 0);

  return (
    <>
      <ol className="ranking" aria-label={ariaLabel}>
        {visiveis.map((row, index) => {
          const conteudo = (
            <>
              <span className="ranking__pos">{index + 1}</span>
              <span className="ranking__identity">
                <span className="ranking__label">{row.label}</span>
                {row.hint && <span className="ranking__hint">{row.hint}</span>}
              </span>
              <span className="ranking__track" aria-hidden="true">
                <span className="ranking__bar" style={{ width: `${larguraDe(row.value)}%` }} />
              </span>
              <span className="ranking__value">{row.value}</span>
              <span className="ranking__share">{row.extra ?? formatShare(row.share)}</span>
            </>
          );

          return (
            <li key={row.key} className="ranking__row">
              {onSelect ? (
                <button
                  type="button"
                  className="ranking__button"
                  onClick={() => onSelect(row.key)}
                  aria-label={`Abrir análise de ${row.label}`}
                >
                  {conteudo}
                </button>
              ) : (
                <span className="ranking__button ranking__button--static">{conteudo}</span>
              )}
            </li>
          );
        })}
      </ol>
      {restantes > 0 && (
        <p className="ranking__more">
          e mais {restantes} {restantes === 1 ? 'item' : 'itens'} com menos faltas
        </p>
      )}
    </>
  );
}
