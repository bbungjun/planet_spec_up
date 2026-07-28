import { useEffect, useRef, type KeyboardEvent } from "react";
import { JOB_RULES } from "../domain/job-rules";
import type {
  CalculatorInput,
  EquipmentInput,
  EquipmentSlot,
  ValidationIssue,
} from "../domain/types";
import { EQUIPMENT_SLOT_LABELS } from "../labels";
import { EquipmentOcrPanel } from "./EquipmentOcrPanel";
import type { OcrTarget, StatReplacement } from "../ocr/types";

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
  onOcrApply: (target: OcrTarget, replacement: StatReplacement) => void;
};

export type EquipmentFieldDefinition = {
  field: keyof EquipmentInput;
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
  { field: "requiredSub", suffix: (_main, sub) => `요구 ${sub}`, max: 9999, step: 1 },
];

export function EquipmentEditor({
  input,
  selectedSlot,
  issues,
  onEquipmentChange,
  onSelectSlot,
  onOcrApply,
}: EquipmentEditorProps) {
  const equipment = input.equipment[selectedSlot];
  const rule = JOB_RULES[input.character.job];
  const slotLabel = EQUIPMENT_SLOT_LABELS[selectedSlot];
  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);
  const focusFirstFieldAfterSlotChange = useRef(false);

  useEffect(() => {
    if (!focusFirstFieldAfterSlotChange.current) return;
    focusFirstFieldAfterSlotChange.current = false;
    fieldRefs.current[0]?.focus();
  }, [selectedSlot]);

  if (equipment === undefined) return null;

  const handleKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    fieldIndex: number,
  ) => {
    if (event.key !== "Enter") return;
    event.preventDefault();

    if (event.ctrlKey) {
      const currentIndex = rule.visibleSlots.indexOf(selectedSlot);
      const nextIndex = (currentIndex + 1) % rule.visibleSlots.length;
      focusFirstFieldAfterSlotChange.current = true;
      onSelectSlot(rule.visibleSlots[nextIndex]);
      return;
    }

    fieldRefs.current[fieldIndex + 1]?.focus();
  };

  return (
    <section className="panel equipment-editor" aria-labelledby="editor-heading">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">카드 입력</p>
          <h2 id="editor-heading">{slotLabel} 옵션</h2>
        </div>
        <span className="job-chip">{rule.mainStat} / {rule.subStat}</span>
      </div>
      <p className="panel-description">
        빈칸은 0으로 계산되며 입력값은 다른 장비로 이동해도 유지됩니다.
      </p>

      <div className="equipment-field-grid">
        {EQUIPMENT_FIELD_DEFINITIONS.map(({ field, suffix, max, step }, fieldIndex) => {
          const path = `equipment.${selectedSlot}.${field}`;
          const id = path.replaceAll(".", "-");
          const label = `${slotLabel} ${suffix(rule.mainStat, rule.subStat)}`;
          const error = issues.find(
            (issue) => issue.path === path && issue.severity === "error",
          );
          const errorId = `${id}-error`;

          return (
            <div className="field" key={field}>
              <label htmlFor={id}>{label}</label>
              <input
                id={id}
                type="number"
                min={0}
                max={max}
                step={step}
                value={equipment[field]}
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
      <EquipmentOcrPanel
        target={{ job: input.character.job, slot: selectedSlot }}
        onApply={onOcrApply}
      />
    </section>
  );
}
