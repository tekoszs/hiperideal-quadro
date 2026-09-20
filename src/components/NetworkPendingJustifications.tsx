import type { NetworkPendingJustification } from '@/types/analytics';
import { getDistrict } from '@/data/network';
import { formatBrDate } from '@/utils/date';
import { waitingLabel } from '@/components/PendingJustificationsPanel';

interface Props {
  pendings: NetworkPendingJustification[];
  /** Quantas linhas mostrar. O resto vira "e mais N". */
  limit?: number;
}

/**
 * Justificativas pendentes da rede.
 *
 * As faltas aqui já foram contabilizadas. O supervisor usa este bloco para
 * identificar rapidamente qual loja ainda precisa concluir motivo/documento.
 */
export function NetworkPendingJustifications({ pendings, limit = 8 }: Props) {
  if (pendings.length === 0) return null;

  const total = pendings.reduce((soma, item) => soma + item.quantity, 0);
  const stores = new Set(pendings.map((item) => item.storeId)).size;
  const oldestDays = Math.max(...pendings.map((item) => item.waitingDays));
  const visiveis = pendings.slice(0, limit);
  const restantes = pendings.length - visiveis.length;

  return (
    <section className="panel netpend" aria-label="Justificativas pendentes na rede">
      <div className="netpend__head">
        <div>
          <p className="netpend__eyebrow">Acompanhamento</p>
          <h3 className="panel__title">Justificativas pendentes</h3>
          <p className="netpend__note">
            Faltas já contabilizadas que ainda aguardam o motivo ou documento definitivo
            da loja.
          </p>
        </div>

        <span className="netpend__action-badge">Aguardando ação da loja</span>
      </div>

      <div className="netpend__metrics" aria-label="Resumo das justificativas pendentes">
        <div className="netpend__metric">
          <span>Faltas pendentes</span>
          <strong>{total}</strong>
        </div>
        <div className="netpend__metric">
          <span>Lojas envolvidas</span>
          <strong>{stores}</strong>
        </div>
        <div className="netpend__metric">
          <span>Mais antiga</span>
          <strong>{waitingLabel(oldestDays)}</strong>
        </div>
      </div>

      <div className="focus-table__scroll">
        <table className="netpend__table">
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Loja</th>
              <th scope="col">Função</th>
              <th scope="col">Distrito</th>
              <th scope="col" className="netpend__num">
                Faltas
              </th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((pending) => (
              <tr key={`${pending.storeId}-${pending.referenceDate}-${pending.positionId}`}>
                <td data-label="Data" className="netpend__date">
                  {formatBrDate(pending.referenceDate)}
                </td>
                <td data-label="Loja">
                  <strong className="netpend__store">{pending.storeName}</strong>
                </td>
                <td data-label="Função" className="netpend__function">
                  {pending.positionName}
                </td>
                <td data-label="Distrito">
                  {pending.districtId
                    ? getDistrict(pending.districtId)?.name ?? pending.districtId
                    : '—'}
                </td>
                <td data-label="Faltas" className="netpend__num">
                  <strong>{pending.quantity}</strong>
                </td>
                <td data-label="Situação">
                  <span
                    className={`netpend__waiting${
                      pending.waitingDays >= 7 ? ' netpend__waiting--long' : ''
                    }`}
                  >
                    {waitingLabel(pending.waitingDays)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {restantes > 0 && (
        <p className="netpend__more">
          Mais {restantes} {restantes === 1 ? 'pendência' : 'pendências'} no período.
        </p>
      )}
    </section>
  );
}
