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
 * FASE 4.5 — JUSTIFICATIVAS PENDENTES NA REDE.
 *
 * SOMENTE LEITURA, e não por limitação técnica: quem sabe por que o associado
 * faltou é a loja. O supervisor precisa saber ONDE cobrar o documento — não
 * escolher um motivo no lugar do gerente. Um botão de resolver aqui produziria
 * "Falta injustificada" decidida por quem nunca falou com o associado.
 *
 * O escopo é o da RLS: o gerente distrital vê o distrito dele, o gerente geral
 * vê a rede. Nada aqui filtra segurança — só mostra o que já veio.
 *
 * Âmbar, nunca vermelho: a falta foi contada e a conferência é válida. O que
 * falta é o papel.
 */
export function NetworkPendingJustifications({ pendings, limit = 8 }: Props) {
  if (pendings.length === 0) return null;

  const total = pendings.reduce((soma, item) => soma + item.quantity, 0);
  const visiveis = pendings.slice(0, limit);
  const restantes = pendings.length - visiveis.length;

  return (
    <section className="panel netpend" aria-label="Justificativas pendentes na rede">
      <div className="panel__head">
        <h3 className="panel__title">Justificativas pendentes</h3>
        <span className="netpend__badge">
          {total} {total === 1 ? 'falta' : 'faltas'}
        </span>
      </div>

      <p className="netpend__note">
        Faltas já enviadas cujo motivo definitivo ainda não foi apresentado. A troca é
        feita pelo gerente da loja.
      </p>

      <div className="focus-table__scroll">
        <table className="netpend__table">
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Loja</th>
              <th scope="col">Distrito</th>
              <th scope="col">Função</th>
              <th scope="col" className="netpend__num">
                Faltas
              </th>
              <th scope="col">Aguardando</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((pending) => (
              <tr key={`${pending.storeId}-${pending.referenceDate}-${pending.positionId}`}>
                <td data-label="Data">{formatBrDate(pending.referenceDate)}</td>
                <td data-label="Loja">{pending.storeName}</td>
                <td data-label="Distrito">
                  {pending.districtId ? getDistrict(pending.districtId)?.name ?? pending.districtId : '—'}
                </td>
                <td data-label="Função">{pending.positionName}</td>
                <td data-label="Faltas" className="netpend__num">
                  {pending.quantity}
                </td>
                <td data-label="Aguardando">
                  <span
                    className={`netpend__waiting${pending.waitingDays >= 7 ? ' netpend__waiting--long' : ''}`}
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
          e mais {restantes} {restantes === 1 ? 'pendência' : 'pendências'} no período.
        </p>
      )}
    </section>
  );
}
