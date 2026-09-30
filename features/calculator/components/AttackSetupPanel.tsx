import type { CalculatorInput, ValidationIssue } from "../domain/types";
import type { EquipmentChangeHandler } from "./EquipmentEditor";
import { ATTACK_BUFF_PRESETS, type StackableAttackBuffId } from "../domain/attack-buffs";
import { StackableBuffControls } from "./StackableBuffControls";

type Props = {
  input: CalculatorInput;
  issues: readonly ValidationIssue[];
  onEquipmentChange: EquipmentChangeHandler;
  onStackableBuffChange: (buff: StackableAttackBuffId, enabled: boolean) => void;
};

export function AttackSetupPanel({ input, issues, onEquipmentChange, onStackableBuffChange }: Props) {
  const buff = input.equipment.buff?.attackFlat ?? "";
  const activePreset = ATTACK_BUFF_PRESETS.find(({attack}) => Number(buff) === attack);
  return (
    <section className="panel attack-setup" aria-labelledby="attack-setup-heading">
      <div className="panel-heading">
        <div>

          <h2 id="attack-setup-heading">공격력 버프</h2>
        </div>
      </div>
      <h3 className="attack-buff-group-heading">선택 버프(택1)</h3>
      <div className="buff-presets" role="group" aria-label="공격력 버프 선택">
        {ATTACK_BUFF_PRESETS.map(({label, attack}) => (
          <button type="button" key={label} aria-label={`${label} +${attack}`} aria-pressed={activePreset?.attack === attack}
            onClick={() => onEquipmentChange("buff", "attackFlat", String(attack))}>
            <span>{label}</span><strong>+{attack}</strong>
          </button>
        ))}
      </div>
      <h3 className="attack-buff-group-heading">추가 버프(중첩)</h3>
      <StackableBuffControls buffs={input.attackBuffs} onChange={onStackableBuffChange} />
      <div className="attack-source-fields">
        {([
          ["projectile", "불릿·표창 공격력"],
          ["blessing_1", "정령의 축복"],
          ["blessing_2", "여제의 축복"],
          ["buff", "공격력 버프 직접 입력"],
        ] as const).map(([slot, label]) => {
          const path = `equipment.${slot}.attackFlat`;
          const error = issues.find(issue => issue.path === path && issue.severity === "error");
          return (
            <div className="field" key={slot}>
              <label htmlFor={`attack-source-${slot}`}>{label}</label>
              <input id={`attack-source-${slot}`} name={path} autoComplete="off" inputMode="numeric" type="number" min={0} max={9999} step={1}
                value={input.equipment[slot]?.attackFlat ?? ""}
                data-field-path={path}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `attack-source-${slot}-error` : undefined}
                onChange={event => onEquipmentChange(slot, "attackFlat", event.currentTarget.value)} />
              {error && <span className="field-error" id={`attack-source-${slot}-error`}>! {error.message}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
