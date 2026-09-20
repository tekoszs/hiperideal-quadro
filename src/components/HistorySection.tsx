import type { ConferenceHistoryEntry } from '@/types/domain';
import { StatusBadge } from '@/components/StatusBadge';
import { formatBrDate } from '@/utils/date';

interface Props {
  entries: ConferenceHistoryEntry[];
}

export function HistorySection({ entries }: Props) {
  return (
    <section className="section">
      <div className="section__head">
        <div>
          <h2 className="section__title">Histórico</h2>
          <p className="section__hint">Últimas conferências desta loja</p>
        </div>
      </div>

      <div className="section__body">
        {entries.length === 0 ? (
          <p className="history-table__empty">Nenhuma conferência registrada ainda.</p>
        ) : (
          <div className="table-scroll">
            <table className="history-table">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col" className="history-table__num">
                    Faltas
                  </th>
                  <th scope="col" className="history-table__num">
                    Folgas
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatBrDate(entry.referenceDate)}</td>
                    <td
                      className={`history-table__num${
                        entry.totalAbsences > 0 ? ' history-table__num--danger' : ''
                      }`}
                    >
                      {entry.totalAbsences}
                    </td>
                    <td className="history-table__num">{entry.totalDayOffs}</td>
                    <td>
                      <StatusBadge status={entry.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
