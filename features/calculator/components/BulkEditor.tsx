import { JOB_RULES } from "../domain/job-rules";
import type {
  CalculatorInput,
  ValidationIssue,
} from "../domain/types";
import { EQUIPMENT_SLOT_LABELS } from "../labels";
import {
  EQUIPMENT_FIELD_DEFINITIONS,
  type EquipmentChangeHandler,
} from "./EquipmentEditor";

type BulkEditorProps = {
  input: CalculatorInput;
  issues: readonly ValidationIssue[];
  onEquipmentChange: EquipmentChangeHandler;
};

export function BulkEditor({
  input,
  issues,
  onEquipmentChange,
}: BulkEditorProps) {
  const rule = JOB_RULES[input.character.job];

  return (
    <section className="panel bulk-editor" aria-labelledby="bulk-editor-heading">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">일괄 입력</p>
          <h2 id="bulk-editor-heading">전체 장비 옵션</h2>
        </div>
        <span className="job-chip">{rule.mainStat} / {rule.subStat}</span>
      </div>
      <p className="panel-description">
        카드 입력과 같은 값을 편집하며 빈칸은 0으로 계산됩니다.
      </p>

      <div className="bulk-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">부위</th>
              {EQUIPMENT_FIELD_DEFINITIONS.map(({ field, suffix }) => (
                <th scope="col" key={field}>
                  {suffix(rule.mainStat, rule.subStat)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rule.visibleSlots.map((slot) => {
              const equipment = input.equipment[slot];
              if (equipment === undefined) return null;
              const slotLabel = EQUIPMENT_SLOT_LABELS[slot];

              return (
                <tr key={slot}>
                  <th scope="row">{slotLabel}</th>
                  {EQUIPMENT_FIELD_DEFINITIONS.map(({
                    field,
                    suffix,
                    max,
                    step,
                  }) => {
                    const path = `equipment.${slot}.${field}`;
                    const id = `bulk-${path.replaceAll(".", "-")}`;
                    const label = `일괄 입력 ${slotLabel} ${
                      suffix(rule.mainStat, rule.subStat)
                    }`;
                    const error = issues.find(
                      (issue) => issue.path === path && issue.severity === "error",
                    );
                    const errorId = `${id}-error`;

                    return (
                      <td key={field}>
                        <div className="field">
                          <input
                            id={id}
                            aria-label={label}
                            type="number"
                            min={0}
                            max={max}
                            step={step}
                            value={equipment[field]}
                            data-field-path={path}
                            aria-invalid={error === undefined ? undefined : true}
                            aria-describedby={
                              error === undefined ? undefined : errorId
                            }
                            onChange={(event) => onEquipmentChange(
                              slot,
                              field,
                              event.currentTarget.value,
                            )}
                          />
                          {error === undefined ? null : (
                            <span id={errorId} className="field-error">
                              <span
                                className="field-error-icon"
                                aria-hidden="true"
                              >
                                !
                              </span>
                              <span>{error.message}</span>
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
