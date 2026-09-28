import { isWearBlocked } from "../domain/requirements";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { JOB_RULES } from "../domain/job-rules";
import type {
  CalculatorInput,
  EquipmentInput,
  EquipmentSlot,
  ValidationIssue,
} from "../domain/types";
import { getEquipmentSlotLabel, getVisibleEquipmentSlots } from "../domain/slots";
import { EquipmentOcrPanel } from "./EquipmentOcrPanel";
import type { OcrTarget, OcrSource, StatReplacement } from "../ocr/types";
import type { ApplyOcrBatch } from "../ocr/batch";
import { isPendantSlot } from "../domain/pendants";
import { PendantSelect } from "./PendantSelect";
import { EquipmentIcon } from "./GameVisuals";

export type EquipmentChangeHandler = (
  slot: EquipmentSlot,
  field: keyof EquipmentInput,
  value: string,
) => void;

type EquipmentEditorProps = {
  input: CalculatorInput;
  selectedSlot: EquipmentSlot;
  issues: readonly ValidationIssue[];
  onEquipmentChange: EquipmentChangeHandler;
  onSelectSlot: (slot: EquipmentSlot) => void;
  onOcrApply: (target: OcrTarget, replacement: StatReplacement, source?: OcrSource) => void;
  onOcrAddAsNew: (target: OcrTarget, label: string, replacement: StatReplacement) => void;
  onOcrBatchApply: ApplyOcrBatch;
};

export type EquipmentFieldDefinition = {
  field: Exclude<keyof EquipmentInput, "pendantId">;
  suffix: (mainStat: string, subStat: string) => string;
  max: number;
  step: number | "any";
};

export const EQUIPMENT_FIELD_DEFINITIONS: readonly EquipmentFieldDefinition[] = [
  { field: "mainFlat", suffix: (main) => main, max: 9999, step: 1 },
  { field: "subFlat", suffix: (_main, sub) => sub, max: 9999, step: 1 },
  { field: "mainPercent", suffix: (main) => `${main}%`, max: 999, step: "any" },
  { field: "subPercent", suffix: (_main, sub) => `${sub}%`, max: 999, step: "any" },
  { field: "attackFlat", suffix: () => "공격력", max: 9999, step: 1 },
  { field: "attackPercent", suffix: () => "공격력%", max: 999, step: "any" },
  { field: "requiredLevel", suffix: () => "요구 레벨", max: 9999, step: 1 },
  { field: "requiredSub", suffix: (_main, sub) => `요구 ${sub}`, max: 9999, step: 1 },
  { field: "totalDamagePercent", suffix: () => "총데미지%", max: 999, step: "any" },
  { field: "bossDamagePercent", suffix: () => "보스공격력%", max: 999, step: "any" },
  { field: "ignoreDefensePercent", suffix: () => "방어율 무시%", max: 100, step: "any" },
  { field: "damagePercent", suffix: () => "기존 합산값% (분리 후 비우기)", max: 999, step: "any" },
];

const WEAPON_ONLY_CARD_FIELDS = new Set<string>([
  "totalDamagePercent", "bossDamagePercent", "ignoreDefensePercent",
]);

export function isEquipmentCardFieldVisible(slot: EquipmentSlot, field: string): boolean {
  return slot === "weapon" || !WEAPON_ONLY_CARD_FIELDS.has(field);
}

export function EquipmentEditor({
  input,
  selectedSlot,
  issues,
  onEquipmentChange,
  onSelectSlot,
  onOcrApply,
  onOcrAddAsNew,
  onOcrBatchApply,
}: EquipmentEditorProps) {
  const equipment = input.equipment[selectedSlot];
  const rule = JOB_RULES[input.character.job];
  const slotLabel = getEquipmentSlotLabel(input, selectedSlot);
  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);
  const focusFirstFieldAfterSlotChange = useRef(false);

  useEffect(() => {
    if (!focusFirstFieldAfterSlotChange.current) return;
    focusFirstFieldAfterSlotChange.current = false;
    fieldRefs.current[0]?.focus();
  }, [selectedSlot]);

  if (equipment === undefined) return null;

  const fields = EQUIPMENT_FIELD_DEFINITIONS.filter(({ field }) =>
    isEquipmentCardFieldVisible(selectedSlot, field)
    && (field !== "damagePercent" || (equipment.damagePercent ?? "").trim() !== ""));

  const handleKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    fieldIndex: number,
  ) => {
    if (event.key !== "Enter") return;
    event.preventDefault();

    if (event.ctrlKey) {
      const slots = getVisibleEquipmentSlots(input);
      const currentIndex = slots.indexOf(selectedSlot);
      const nextIndex = (currentIndex + 1) % slots.length;
      focusFirstFieldAfterSlotChange.current = true;
      onSelectSlot(slots[nextIndex]);
      return;
    }

    if (fieldIndex + 1 < fields.length) fieldRefs.current[fieldIndex + 1]?.focus();
  };

  return (
    <section className="panel equipment-editor" aria-labelledby="editor-heading">
      <div className="panel-heading game-window-heading">
        <div>

          <span className="game-window-label" aria-hidden="true">ITEM INFORMATION</span>
          <h2 id="editor-heading">{slotLabel} 옵션</h2>
        </div>
        <span className="job-chip">{rule.mainStat} / {rule.subStat}</span>
      </div>
      <div className="equipment-item-banner"><span className="equipment-item-icon"><EquipmentIcon slot={selectedSlot} job={input.character.job} label={slotLabel} /></span><div><small>{selectedSlot === "weapon" ? "선택 프리셋" : "공통 장비"}</small><h3>{slotLabel}</h3><span>{rule.label} · {rule.mainStat} / {rule.subStat}</span></div><span className="equipment-item-sparkle" aria-hidden="true">✦</span></div>

      {issues.filter(issue => issue.path.startsWith(`equipment.${selectedSlot}.`) && isWearBlocked(issue)).map(issue => <p className="equipment-wear-warning" role="status" key={issue.path+issue.code}>{issue.message}</p>)}

      {isPendantSlot(input, selectedSlot) && <PendantSelect label={`${slotLabel} 종류`} value={equipment.pendantId}
        path={`equipment.${selectedSlot}.pendantId`} onChange={value => onEquipmentChange(selectedSlot, "pendantId", value)} />}

      <EquipmentOcrPanel
        captureDocumentPaste={false}
        key={input.weaponPresets?.active ?? "boss"}
        target={{ job: input.character.job, slot: selectedSlot }}
        slotLabel={slotLabel}
        onApply={onOcrApply}
        onAddAsNew={onOcrAddAsNew}
        onApplyBatch={onOcrBatchApply}
        slotChoices={getVisibleEquipmentSlots(input).map(slot => ({slot, label: getEquipmentSlotLabel(input, slot), equipment: input.equipment[slot]!}))}
      />

      <div className="equipment-field-grid">
        {fields.map(({ field, suffix, max, step }, fieldIndex) => {
          const path = `equipment.${selectedSlot}.${field}`;
          const id = path.replaceAll(".", "-");
          const error = issues.find(
            (issue) => issue.path === path && issue.severity === "error",
          );
          const errorId = `${id}-error`;

          return (
            <div className={`field${field.endsWith("Percent") ? " is-percent-option" : ""}${field.startsWith("required") ? " is-requirement-option" : ""}`} key={field}>
              <label htmlFor={id}><span className="candidate-sr-only">{slotLabel} </span>{suffix(rule.mainStat, rule.subStat)}</label>
              <input
                id={id}
                type="number"
                min={0}
                max={max}
                step={step}
                value={equipment[field] ?? ""}
                data-field-path={path}
                ref={(element) => {
                  fieldRefs.current[fieldIndex] = element;
                }}
                aria-invalid={error === undefined ? undefined : true}
                aria-describedby={error === undefined ? undefined : errorId}
                onKeyDown={(event) => handleKeyDown(event, fieldIndex)}
                onChange={(event) => onEquipmentChange(
                  selectedSlot,
                  field,
                  event.currentTarget.value,
                )}
              />
              {error === undefined ? null : (
                <span id={errorId} className="field-error">
                  <span className="field-error-icon" aria-hidden="true">!</span>
                  <span>{error.message}</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
