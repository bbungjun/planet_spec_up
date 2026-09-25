import type { CalculatorInput, GuildSkillLevel, ValidationIssue } from "../domain/types";
import type { EquipmentChangeHandler } from "./EquipmentEditor";
import type { CharacterChangeHandler } from "./CharacterPanel";

type Props = {
  input: CalculatorInput;
  issues: readonly ValidationIssue[];
  onEquipmentChange: EquipmentChangeHandler;
  onCharacterChange: CharacterChangeHandler;
};

export const ATTACK_BUFF_PRESETS = [
  { label: "없음", attack: 0 },
  { label: "혼테일", attack: 30 },
  { label: "핑크빈", attack: 35 },
] as const;

export function AttackSetupPanel({ input, issues, onEquipmentChange, onCharacterChange }: Props) {
  const buff = input.equipment.buff?.attackFlat ?? "";
  const activePreset = ATTACK_BUFF_PRESETS.find(({attack}) => Number(buff) === attack);
  return (
    <section className="panel attack-setup" aria-labelledby="attack-setup-heading">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">공격력 설정</p>
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
      <p className="attack-setup-hint">버프 하나를 선택하면 적용값이 바뀝니다. 다른 버프는 직접 입력하세요.</p>
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
        <div className="field">
          <label htmlFor="attack-source-guild">길드 공격력 스킬 레벨</label>
          <select id="attack-source-guild" value={input.character.guildAttackLevel}
            onChange={event => onCharacterChange("guildAttackLevel", Number(event.currentTarget.value) as GuildSkillLevel)}>
            {[0, 1, 2, 3, 4, 5].map(level => <option key={level} value={level}>{level}레벨 (+{level})</option>)}
          </select>
        </div>
      </div>
      <p className="attack-setup-hint">축복은 각각의 공격력 증가량을 입력하세요. 길드 공격력은 별도로 더해집니다.</p>
    </section>
  );
}
