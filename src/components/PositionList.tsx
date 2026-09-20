import { useMemo } from 'react';
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
  const itemsByPosition = useMemo(
    () => new Map(items.map((item) => [item.positionId, item])),
    [items],
  );

  const visiblePositions = useMemo(
    () =>
      positions.filter((position) =>
        matchesSearch(
          `${position.name} ${position.functionGroup} ${position.sector ?? ''}`,
          search,
        ),
      ),
    [positions, search],
  );

  const groups = useMemo(() => buildPositionGroups(visiblePositions), [visiblePositions]);

  if (visiblePositions.length === 0) {
    return <p className="state">Nenhuma função encontrada para “{search}”.</p>;
  }

  return (
    <div className="position-list">
      <div className="position-list__header" aria-hidden="true">
        <span>Função / Setor</span>
        <span>Faltas</span>
        <span>Folgas</span>
      </div>

      {groups.map((group) => (
        <div className="position-group" key={group.key}>
          {group.groupLabel && <h3 className="position-group__title">{group.groupLabel}</h3>}

          {group.positions.map((position) => {
            const item = itemsByPosition.get(position.id);
            if (!item) return null;
            return (
              <PositionRow
                key={position.id}
                position={position}
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
      ))}
    </div>
  );
}
