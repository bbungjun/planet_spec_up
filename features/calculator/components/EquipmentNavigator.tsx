import { JOB_RULES } from "../domain/job-rules";
import type {
  CalculatorInput,
  EquipmentInput,
  EquipmentSlot,
} from "../domain/types";
import { EQUIPMENT_SLOT_LABELS } from "../labels";

type EquipmentNavigatorProps = {
  input: CalculatorInput;
  selectedSlot: EquipmentSlot;
  onSelectSlot: (slot: EquipmentSlot) => void;
};

const INTEGER_FIELDS = new Set<keyof EquipmentInput>([
  "mainFlat",
  "subFlat",
  "attackFlat",
  "requiredSub",
]);

function hasValidValue(equipment: EquipmentInput | undefined): boolean {
  if (equipment === undefined) return false;

  return (Object.entries(equipment) as [keyof EquipmentInput, string][]).some(
    ([field, raw]) => {
      if (raw.trim() === "") return false;
      const value = Number(raw);
      const max = INTEGER_FIELDS.has(field) ? 9999 : 999;
      return Number.isFinite(value)
        && value >= 0
        && value <= max
        && (!INTEGER_FIELDS.has(field) || Number.isInteger(value));
    },
  );
}

export function EquipmentNavigator({
  input,
  selectedSlot,
  onSelectSlot,
}: EquipmentNavigatorProps) {
  const visibleSlots = JOB_RULES[input.character.job].visibleSlots;

  return (
    <nav className="panel equipment-navigator" aria-labelledby="equipment-heading">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">장비</p>
          <h2 id="equipment-heading">장비 슬롯</h2>
        </div>
        <span>{visibleSlots.length}개</span>
      </div>
      <ul className="equipment-list">
        {visibleSlots.map((slot) => {
          const complete = hasValidValue(input.equipment[slot]);
          const statusId = `equipment-${slot}-status`;

          return (
            <li key={slot}>
              <button
                type="button"
                className={[
                  "equipment-slot",
                  selectedSlot === slot ? "is-selected" : "",
                  complete ? "is-complete" : "",
                ].filter(Boolean).join(" ")}
                aria-label={`${EQUIPMENT_SLOT_LABELS[slot]} 편집`}
                aria-pressed={selectedSlot === slot}
                aria-describedby={statusId}
                onClick={() => onSelectSlot(slot)}
              >
                <span className="equipment-slot-name">
                  {EQUIPMENT_SLOT_LABELS[slot]}
                </span>
                <span id={statusId} className="equipment-slot-status">
                  {complete ? "✓ 입력 완료" : "미입력"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
