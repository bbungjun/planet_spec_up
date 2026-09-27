import type { CalculatorInput, ValidationIssue } from "../domain/types";
import type { EquipmentChangeHandler } from "./EquipmentEditor";
import { ATTACK_BUFF_PRESETS, STACKABLE_ATTACK_BUFFS, type StackableAttackBuffId } from "../domain/attack-buffs";

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
      <div className="buff-presets" role="group" aria-label="공격력 버프 선택">
        {ATTACK_BUFF_PRESETS.map(({label, attack}) => (
          <button type="button" key={label} aria-label={`${label} +${attack}`} aria-pressed={activePreset?.attack === attack}
            onClick={() => onEquipmentChange("buff", "attackFlat", String(attack))}>
            <span>{label}</span><strong>+{attack}</strong>
          </button>
        ))}
      </div>
      <p className="attack-setup-hint">사이다·혼테일·핑크빈·요괴대사 중 하나만 적용</p>
      <div className="buff-presets stackable-buffs" role="group" aria-label="중첩 가능한 공격력 버프">
        {STACKABLE_ATTACK_BUFFS.map(({id, label, attack}) => (
          <button type="button" key={id} aria-label={`${label} +${attack}`} aria-pressed={input.attackBuffs?.[id] ?? false}
            onClick={() => onStackableBuffChange(id, !input.attackBuffs?.[id])}>
            <span>{label}</span><strong>+{attack}</strong>
          </button>
        ))}
      </div>
      <p className="attack-setup-hint">뿌리기·분노는 다른 버프와 중첩 가능</p>
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
