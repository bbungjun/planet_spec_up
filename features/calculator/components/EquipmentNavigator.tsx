import { useState, type FormEvent } from "react";
import { getEquipmentSlotLabel, getVisibleEquipmentSlots } from "../domain/slots";
import type {
  CalculatorInput,
  EquipmentInput,
  EquipmentSlot,
} from "../domain/types";

type EquipmentNavigatorProps = {
  input: CalculatorInput;
  selectedSlot: EquipmentSlot;
  onSelectSlot: (slot: EquipmentSlot) => void;
  onAddSlot: (label: string) => boolean;
  onRemoveSlot: (slot: EquipmentSlot) => void;
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
  onAddSlot,
  onRemoveSlot,
}: EquipmentNavigatorProps) {
  const [newSlotLabel, setNewSlotLabel] = useState("");
  const visibleSlots = getVisibleEquipmentSlots(input);

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (onAddSlot(newSlotLabel)) setNewSlotLabel("");
  };

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
          const label = getEquipmentSlotLabel(input, slot);

          return (
            <li key={slot}>
              <button
                type="button"
                className={[
                  "equipment-slot",
                  selectedSlot === slot ? "is-selected" : "",
                  complete ? "is-complete" : "",
                ].filter(Boolean).join(" ")}
                aria-label={`${label} 편집`}
                aria-pressed={selectedSlot === slot}
                aria-describedby={statusId}
                onClick={() => onSelectSlot(slot)}
              >
                <span className="equipment-slot-name">
                  {label}
                </span>
                <span id={statusId} className="equipment-slot-status">
                  {complete ? "✓ 입력 완료" : "미입력"}
                </span>
              </button>
              {input.customSlots?.some(({ id }) => id === slot) && (
                <button type="button" className="equipment-remove-slot" aria-label={`${label} 삭제`} onClick={() => onRemoveSlot(slot)}>삭제</button>
              )}
            </li>
          );
        })}
      </ul>
      <form className="equipment-add-form" onSubmit={handleAdd}>
        <label htmlFor="new-equipment-slot">새 장비 부위</label>
        <input id="new-equipment-slot" maxLength={30} value={newSlotLabel} onChange={event => setNewSlotLabel(event.currentTarget.value)} placeholder="예: 어깨장식, 벨트, 펜던트" />
        <button type="submit">장비 추가</button>
      </form>
    </nav>
  );
}
