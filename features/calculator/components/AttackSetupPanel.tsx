import type { CalculatorInput, ValidationIssue } from "../domain/types";
import type { EquipmentChangeHandler } from "./EquipmentEditor";

type Props = {
  input: CalculatorInput;
  issues: readonly ValidationIssue[];
  onEquipmentChange: EquipmentChangeHandler;
};

export const ATTACK_BUFF_PRESETS = [
  { label: "없음", attack: 0 },
  { label: "혼테일", attack: 30 },
  { label: "핑크빈", attack: 35 },
] as const;

export function AttackSetupPanel({ input, issues, onEquipmentChange }: Props) {
  const buff = input.equipment.buff?.attackFlat ?? "";
  const activePreset = ATTACK_BUFF_PRESETS.find(({attack}) => Number(buff) === attack);
  return (
    <section className="panel attack-setup" aria-labelledby="attack-setup-heading">
      <div className="panel-heading">
        <div>

          <h2 id="attack-setup-heading">오늘의 전투 준비</h2>
        </div>
        <span className="job-chip">{activePreset?.label ?? "직접 입력"}</span>
      </div>
      <div className="buff-presets" role="group" aria-label="공격력 버프 선택">
        {ATTACK_BUFF_PRESETS.map(({label, attack}) => (
          <button type="button" key={label} aria-label={`${label} +${attack}`} aria-pressed={activePreset?.attack === attack}
            onClick={() => onEquipmentChange("buff", "attackFlat", String(attack))}>
            <span>{label}</span><strong>+{attack}</strong>
          </button>
        ))}
      </div>
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
              <input id={`attack-source-${slot}`} type="number" min={0} max={9999} step={1}
                value={input.equipment[slot]?.attackFlat ?? ""}
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
