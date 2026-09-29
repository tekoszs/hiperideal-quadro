import { useMemo, useState } from 'react';
import type { AbsenceReason, DailyItem, Position } from '@/types/domain';
import { PositionRow } from '@/components/PositionRow';
import { buildPositionGroups } from '@/services/catalogService';
import { matchesSearch } from '@/utils/text';

interface Props {
  positions: Position[];
  items: DailyItem[];
  reasons: AbsenceReason[];
  disabled: boolean;
  search: string;
  pendingPositionIds: Set<string>;
  onChangeAbsence: (positionId: string, value: number) => void;
  onChangeDayOff: (positionId: string, value: number) => void;
  onChangeReasonQuantity: (positionId: string, reasonId: string, value: number) => void;
  onChangeReasonObservation: (positionId: string, reasonId: string, value: string) => void;
  onChangeObservation: (positionId: string, value: string) => void;
}

export function PositionList({
  positions,
  items,
  reasons,
  disabled,
  search,
  pendingPositionIds,
  onChangeAbsence,
  onChangeDayOff,
  onChangeReasonQuantity,
  onChangeReasonObservation,
  onChangeObservation,
}: Props) {
  const [onlyLaunched, setOnlyLaunched] = useState(false);

  const itemsByPosition = useMemo(
    () => new Map(items.map((item) => [item.positionId, item])),
    [items],
  );

  const totals = useMemo(
    () =>
      items.reduce(
        (acc, item) => {
          acc.absences += item.absenceQuantity;
          acc.daysOff += item.dayOffQuantity;
          if (item.absenceQuantity > 0 || item.dayOffQuantity > 0) acc.launched += 1;
          return acc;
        },
        { absences: 0, daysOff: 0, launched: 0 },
      ),
    [items],
  );

  const visiblePositions = useMemo(
    () =>
      positions.filter((position) => {
        const matches = matchesSearch(
          `${position.name} ${position.functionGroup} ${position.sector ?? ''}`,
          search,
        );
        if (!matches) return false;
        if (!onlyLaunched) return true;
        const item = itemsByPosition.get(position.id);
        return Boolean(item && (item.absenceQuantity > 0 || item.dayOffQuantity > 0));
      }),
    [positions, search, onlyLaunched, itemsByPosition],
  );

  const groups = useMemo(() => buildPositionGroups(visiblePositions), [visiblePositions]);

  return (
    <div className="position-list position-list--compact">
      <style>{`
        .position-list--compact .position-list__quick-summary {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          padding: 0 0 14px;
        }
        .position-list--compact .position-list__metrics {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .position-list--compact .position-list__metric {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          min-height: 34px;
          padding: 6px 11px;
          border: 1px solid #d9e4dc;
          border-radius: 10px;
          background: #f8fbf9;
          color: #526159;
          font-size: 12px;
          font-weight: 600;
        }
        .position-list--compact .position-list__metric strong {
          color: #10271a;
          font-size: 15px;
        }
        .position-list--compact .position-list__metric--danger strong { color: #b42318; }
        .position-list--compact .position-list__toggle {
          min-height: 34px;
          padding: 6px 12px;
          border: 1px solid #c9d8ce;
          border-radius: 10px;
          background: #fff;
          color: #284d36;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }
        .position-list--compact .position-list__toggle--active {
          border-color: #16803b;
          background: #eaf6ee;
          color: #086b2d;
        }
        .position-list--compact .position-list__header {
          position: sticky;
          top: 0;
          z-index: 2;
          background: #fff;
          padding-top: 8px;
          padding-bottom: 8px;
        }
        .position-list--compact .position-group {
          margin-top: 8px;
          border-radius: 10px;
          overflow: hidden;
        }
        .position-list--compact .position-group__title,
        .position-list--compact .position-list__sector-title {
          margin: 0;
          padding: 8px 15px;
          background: #eaf6ee;
          color: #08752f;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: .04em;
          text-transform: uppercase;
        }
        .position-list--compact .position-row {
          border-radius: 0;
          margin: 0;
        }
        .position-list--compact .position-group:not(:has(.position-group__title)):not(:has(.position-list__sector-title)) .position-row {
          border-radius: 10px;
        }
        .position-list--compact .position-row__main {
          min-height: 54px;
          padding-top: 8px;
          padding-bottom: 8px;
        }
        .position-list--compact .position-row__name {
          font-size: 13px;
          font-weight: 700;
        }
        .position-list--compact .position-row__sub {
          margin-top: 2px;
          font-size: 10px;
        }
        .position-list--compact .stepper {
          min-height: 34px;
        }
        .position-list--compact .stepper__button {
          width: 34px;
          min-height: 34px;
          font-size: 17px;
        }
        .position-list--compact .stepper__input {
          width: 48px;
          min-height: 34px;
          font-size: 14px;
          font-weight: 800;
        }
        .position-list--compact .position-row--active {
          box-shadow: inset 3px 0 0 #16803b;
        }
        @media (max-width: 700px) {
          .position-list--compact .position-list__quick-summary { align-items: stretch; }
          .position-list--compact .position-list__metrics { width: 100%; }
          .position-list--compact .position-list__metric { flex: 1; justify-content: center; }
          .position-list--compact .position-list__toggle { width: 100%; }
          .position-list--compact .position-row__main { min-height: 58px; }
        }
      `}</style>

      <div className="position-list__quick-summary">
        <div className="position-list__metrics" aria-label="Resumo dos lançamentos">
          <span className="position-list__metric position-list__metric--danger">
            Faltas <strong>{totals.absences}</strong>
          </span>
          <span className="position-list__metric">
            Folgas <strong>{totals.daysOff}</strong>
          </span>
          <span className="position-list__metric">
            Com lançamento <strong>{totals.launched}/{positions.length}</strong>
          </span>
        </div>
        <button
          type="button"
          className={`position-list__toggle${onlyLaunched ? ' position-list__toggle--active' : ''}`}
          onClick={() => setOnlyLaunched((current) => !current)}
          aria-pressed={onlyLaunched}
        >
          {onlyLaunched ? '✓ Somente lançados' : 'Mostrar somente lançados'}
        </button>
      </div>

      <div className="position-list__header" aria-hidden="true">
        <span>Função / Setor</span>
        <span>Faltas</span>
        <span>Folgas</span>
      </div>

      {visiblePositions.length === 0 ? (
        <p className="state">
          {onlyLaunched && !search
            ? 'Nenhuma falta ou folga lançada até o momento.'
            : `Nenhuma função encontrada para “${search}”.`}
        </p>
      ) : (
        groups.map((group) => {
          const ecommerceSingle =
            group.groupLabel === null &&
            group.positions.length === 1 &&
            group.positions[0].sector?.toUpperCase() === 'ECOMMERCE';

          return (
            <div className="position-group" key={group.key}>
              {group.groupLabel && <h3 className="position-group__title">{group.groupLabel}</h3>}
              {ecommerceSingle && <h3 className="position-list__sector-title">ECOMMERCE</h3>}

              {group.positions.map((position) => {
                const item = itemsByPosition.get(position.id);
                if (!item) return null;
                const visualPosition =
                  ecommerceSingle && position.name.toUpperCase().endsWith(' - ECOMMERCE')
                    ? { ...position, name: position.name.replace(/\s*-\s*ECOMMERCE$/i, '') }
                    : position;

                return (
                  <PositionRow
                    key={position.id}
                    position={visualPosition}
                    item={item}
                    reasons={reasons}
                    disabled={disabled}
                    pending={pendingPositionIds.has(position.id)}
                    showOnlySector={group.groupLabel !== null}
                    onChangeAbsence={(value) => onChangeAbsence(position.id, value)}
                    onChangeDayOff={(value) => onChangeDayOff(position.id, value)}
                    onChangeReasonQuantity={(reasonId, value) =>
                      onChangeReasonQuantity(position.id, reasonId, value)
                    }
                    onChangeReasonObservation={(reasonId, value) =>
                      onChangeReasonObservation(position.id, reasonId, value)
                    }
                    onChangeObservation={(value) => onChangeObservation(position.id, value)}
                  />
                );
              })}
            </div>
          );
        })
      )}
    </div>
  );
}
