import { isWearBlocked } from "../domain/requirements";
import { useState, type FormEvent } from "react";
import { getEquipmentSlotLabel, getVisibleEquipmentSlots } from "../domain/slots";
import { isPendantCategory, pendantFromName, pendantLabel } from "../domain/pendants";
import { EquipmentIcon } from "./GameVisuals";
import type {
  CalculatorInput,
  EquipmentInput,
  EquipmentSlot,
  ValidationIssue,
} from "../domain/types";

type EquipmentNavigatorProps = {
  input: CalculatorInput;
  issues?: readonly ValidationIssue[];
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
  "requiredLevel",
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
  issues = [],
  onSelectSlot,
  onAddSlot,
  onRemoveSlot,
}: EquipmentNavigatorProps) {
  const [newSlotLabel, setNewSlotLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const visibleSlots = getVisibleEquipmentSlots(input);

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPendantCategory(newSlotLabel) || pendantFromName(newSlotLabel)) { setAddError("펜던트는 최대 2개입니다. 펜던트 1·2 칸을 사용해주세요."); return; }
    setAddError(null);
    if (onAddSlot(newSlotLabel)) setNewSlotLabel("");
  };

  return (
    <nav className="panel equipment-navigator" aria-labelledby="equipment-heading">
      <div className="panel-heading game-window-heading">
        <div>

          <span className="game-window-label" aria-hidden="true">EQUIPMENT INVENTORY</span>
          <h2 id="equipment-heading">장비 슬롯</h2>
        </div>
        <span>{visibleSlots.length}개</span>
      </div>
      <ul className="equipment-list">
        {visibleSlots.map((slot) => {
          const complete = hasValidValue(input.equipment[slot]);
          const blocked = issues.some(issue => issue.path.startsWith(`equipment.${slot}.`) && isWearBlocked(issue));
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
                  blocked ? "is-blocked" : "",
                ].filter(Boolean).join(" ")}
                aria-label={`${label} 편집`}
                aria-pressed={selectedSlot === slot}
                aria-describedby={statusId}
                title={`${label}${pendantLabel(input.equipment[slot]?.pendantId) ? ` · ${pendantLabel(input.equipment[slot]?.pendantId)}` : ""} · ${blocked ? "착용 불가" : complete ? "입력 완료" : "미입력"}`}
                onClick={() => onSelectSlot(slot)}
              >
                <EquipmentIcon slot={slot} job={input.character.job} label={label} />
                <span className="equipment-slot-name">
                  {label}
                  {pendantLabel(input.equipment[slot]?.pendantId) && <small className="pendant-item-name">{pendantLabel(input.equipment[slot]?.pendantId)}</small>}
                </span>
                <span id={statusId} className="equipment-slot-status">
                  {blocked ? "착용 불가" : complete ? "✓ 입력 완료" : "미입력"}
                </span>
              </button>
              {input.customSlots?.some(({ id }) => id === slot) && (
                <button type="button" className="equipment-remove-slot" aria-label={`${label} 삭제`} onClick={() => onRemoveSlot(slot)}>삭제</button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="inventory-selection"><span aria-hidden="true">●</span> {getEquipmentSlotLabel(input, selectedSlot)}<small>선택 중</small></div>
      <form className="equipment-add-form" onSubmit={handleAdd}>
        <label htmlFor="new-equipment-slot">새 장비 부위</label>
        <input id="new-equipment-slot" maxLength={30} value={newSlotLabel} onChange={event => setNewSlotLabel(event.currentTarget.value)} placeholder="예: 어깨장식, 벨트" />
        <button type="submit">장비 추가</button>
        {addError && <p role="alert">{addError}</p>}
      </form>
    </nav>
  );
}
