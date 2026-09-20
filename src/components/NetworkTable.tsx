import type { NetworkRow } from '@/types/network';
import { NETWORK_STATUS_LABEL, NETWORK_STATUS_TONE } from '@/lib/constants';
import { formatBrTime } from '@/utils/date';

interface Props {
  rows: NetworkRow[];
  onOpenDetail: (storeId: string) => void;
  emptyMessage: string;
}

/**
 * Lista de conferências do dia.
 *
 * UMA marcação para as duas larguras: no desktop o CSS transforma em tabela
 * (grid alinhado por colunas), no celular em cards empilhados. Cada célula
 * carrega o próprio rótulo em `data-label`, que só aparece no modo card.
 *
 * Não existe `<table>` de propósito: tabela real não reflui para card sem
 * gerar rolagem horizontal, e rolagem horizontal é justamente o que não pode
 * acontecer no celular.
 */
export function NetworkTable({ rows, onOpenDetail, emptyMessage }: Props) {
  if (rows.length === 0) {
    return <p className="network-list__empty">{emptyMessage}</p>;
  }

  return (
    <div className="network-list" role="table" aria-label="Conferências do dia">
      <div className="network-list__head" role="row">
        <span role="columnheader">Loja</span>
        <span role="columnheader">Status</span>
        <span role="columnheader" className="network-list__num">
          Faltas
        </span>
        <span role="columnheader" className="network-list__num">
          Folgas
        </span>
        <span role="columnheader" className="network-list__num">
          Funções
        </span>
        <span role="columnheader" className="network-list__num">
          Enviado às
        </span>
        <span role="columnheader" className="network-list__action-head">
          Ação
        </span>
      </div>

      {rows.map((row) => {
        const pendente = row.status !== 'SUBMITTED';
        return (
          <div
            key={row.storeId}
            role="row"
            className={`network-row${pendente ? ' network-row--pending' : ''}`}
          >
            <div className="network-row__store" role="cell">
              <span className="network-row__name">{row.storeName}</span>
              <span className="network-row__code">Código {row.storeCode}</span>
            </div>

            <div className="network-row__status" role="cell">
              <span className={`badge badge--${NETWORK_STATUS_TONE[row.status]}`}>
                {NETWORK_STATUS_LABEL[row.status]}
              </span>
            </div>

            <div
              className={`network-list__num${row.totalAbsences > 0 ? ' network-list__num--danger' : ''}`}
              role="cell"
              data-label="Faltas"
            >
              {row.conferenceId ? row.totalAbsences : '—'}
            </div>

            <div className="network-list__num" role="cell" data-label="Folgas">
              {row.conferenceId ? row.totalDayOffs : '—'}
            </div>

            <div className="network-list__num" role="cell" data-label="Funções impactadas">
              {row.conferenceId ? row.impactedPositions : '—'}
            </div>

            <div className="network-list__num" role="cell" data-label="Enviado às">
              {formatBrTime(row.submittedAt)}
            </div>

            <div className="network-row__action" role="cell">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => onOpenDetail(row.storeId)}
                aria-label={`Ver detalhes de ${row.storeName}`}
              >
                Ver detalhes
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
