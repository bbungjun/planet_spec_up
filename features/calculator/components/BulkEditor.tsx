import { JOB_RULES } from "../domain/job-rules";
import type {
  CalculatorInput,
  ValidationIssue,
} from "../domain/types";
import { getEquipmentSlotLabel, getVisibleEquipmentSlots } from "../domain/slots";
import { isPendantSlot } from "../domain/pendants";
import { PendantSelect } from "./PendantSelect";
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
  const fields = EQUIPMENT_FIELD_DEFINITIONS.filter(definition => definition.field !== "damagePercent"
    || Object.values(input.equipment).some(equipment => equipment?.damagePercent?.trim()));

  return (
    <section className="panel bulk-editor" aria-labelledby="bulk-editor-heading">
      <div className="panel-heading">
        <div>

          <h2 id="bulk-editor-heading">전체 장비 옵션</h2>
        </div>
        <span className="job-chip">{rule.mainStat} / {rule.subStat}</span>
      </div>

      <div className="bulk-table-wrap" tabIndex={0} aria-label="전체 장비 옵션 표">
        <table>
          <thead>
            <tr>
              <th scope="col">부위</th>
              {fields.map(({ field, suffix }) => (
                <th scope="col" key={field}>
                  {suffix(rule.mainStat, rule.subStat)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {getVisibleEquipmentSlots(input).map((slot) => {
              const equipment = input.equipment[slot];
              if (equipment === undefined) return null;
              const slotLabel = getEquipmentSlotLabel(input, slot);

              return (
                <tr key={slot}>
                  <th scope="row">{slotLabel}{isPendantSlot(input, slot) && <PendantSelect label={`일괄 입력 ${slotLabel} 종류`} value={equipment.pendantId}
                    path={`equipment.${slot}.pendantId`} onChange={value => onEquipmentChange(slot, "pendantId", value)} />}</th>
                  {fields.map(({
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
                            name={path}
                            autoComplete="off"
                            inputMode={step === 1 ? "numeric" : "decimal"}
                            aria-label={label}
                            type="number"
                            min={0}
                            max={max}
                            step={step}
                            value={equipment[field] ?? ""}
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
