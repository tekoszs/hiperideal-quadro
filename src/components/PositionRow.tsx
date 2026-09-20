import type { AbsenceReason, DailyItem, Position } from '@/types/domain';
import { NumberStepper } from '@/components/NumberStepper';
import { ReasonsPanel } from '@/components/ReasonsPanel';
import { hasOccurrence } from '@/domain/summary';

interface Props {
  position: Position;
  item: DailyItem;
  reasons: AbsenceReason[];
  disabled: boolean;
  pending: boolean;
  /** Quando a linha está dentro de um grupo, o cabeçalho já mostra o grupo. */
  showOnlySector: boolean;
  onChangeAbsence: (value: number) => void;
  onChangeDayOff: (value: number) => void;
  onChangeReasonQuantity: (reasonId: string, value: number) => void;
  onChangeReasonObservation: (reasonId: string, value: string) => void;
  onChangeObservation: (value: string) => void;
}

export function PositionRow({
  position,
  item,
  reasons,
  disabled,
  pending,
  showOnlySector,
  onChangeAbsence,
  onChangeDayOff,
  onChangeReasonQuantity,
  onChangeReasonObservation,
  onChangeObservation,
}: Props) {
  const active = hasOccurrence(item);
  const displayName = showOnlySector && position.sector ? position.sector : position.name;

  const rowClass = [
    'position-row',
    pending ? 'position-row--pending' : active ? 'position-row--active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rowClass}>
      <div className="position-row__main">
        <div className="position-row__identity">
          <p className="position-row__name">{displayName}</p>
          {/* Mantém o nome completo visível quando a linha está agrupada — em
              tipo secundário: o nome que distingue a linha é o de cima. */}
          {showOnlySector && position.sector && (
            <p className="position-row__sub">{position.name}</p>
          )}
        </div>

        <div className="position-row__control">
          <span className="position-row__field-label">Faltas</span>
          <NumberStepper
            value={item.absenceQuantity}
            onChange={onChangeAbsence}
            disabled={disabled}
            tone="danger"
            label={`Faltas em ${position.name}`}
          />
        </div>

        <div className="position-row__control">
          <span className="position-row__field-label">Folgas</span>
          <NumberStepper
            value={item.dayOffQuantity}
            onChange={onChangeDayOff}
            disabled={disabled}
            label={`Folgas em ${position.name}`}
          />
        </div>
      </div>

      {active && (
        <div
          className={`position-row__details${
            item.absenceQuantity > 0 ? '' : ' position-row__details--quiet'
          }`}
        >
          {item.absenceQuantity > 0 && (
            <ReasonsPanel
              item={item}
              reasons={reasons}
              disabled={disabled}
              onChangeQuantity={onChangeReasonQuantity}
              onChangeObservation={onChangeReasonObservation}
            />
          )}

          <details className="obs-collapsible">
            <summary className="obs-collapsible__summary">
              Observação
              {item.observation ? (
                <span className="obs-collapsible__badge" aria-label="Possui observação">1</span>
              ) : null}
            </summary>
            <div className="obs-collapsible__body">
              <div className="field">
                <label className="field__label" htmlFor={`item-obs-${item.id}`}>
                  Observação da função (opcional)
                </label>
                <textarea
                  id={`item-obs-${item.id}`}
                  className="field__textarea"
                  rows={1}
                  value={item.observation ?? ''}
                  disabled={disabled}
                  placeholder="Ex.: colaborador avisou com antecedência"
                  onChange={(event) => onChangeObservation(event.target.value)}
                />
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
