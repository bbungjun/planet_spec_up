import { JOB_RULES } from "../domain/job-rules";
import type {
  CalculatorInput,
  EquipmentInput,
  EquipmentSlot,
  ValidationIssue,
} from "../domain/types";
import { EQUIPMENT_SLOT_LABELS } from "../labels";

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
};

type FieldDefinition = {
  field: keyof EquipmentInput;
  suffix: (mainStat: string, subStat: string) => string;
  max: number;
  step: number | "any";
};

const FIELD_DEFINITIONS: readonly FieldDefinition[] = [
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
}: EquipmentEditorProps) {
  const equipment = input.equipment[selectedSlot];
  const rule = JOB_RULES[input.character.job];
  const slotLabel = EQUIPMENT_SLOT_LABELS[selectedSlot];

  if (equipment === undefined) return null;

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
        {FIELD_DEFINITIONS.map(({ field, suffix, max, step }) => {
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
                aria-invalid={error === undefined ? undefined : true}
                aria-describedby={error === undefined ? undefined : errorId}
                onChange={(event) => onEquipmentChange(
                  selectedSlot,
                  field,
                  event.currentTarget.value,
                )}
              />
              {error === undefined ? null : (
                <span id={errorId} className="field-error">
                  {error.message}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
