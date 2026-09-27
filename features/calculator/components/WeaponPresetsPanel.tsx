import { calculateDamageResult } from "../domain/calculate";
import { activeWeaponPreset, getWeaponPreset, switchWeaponPreset, WEAPON_PRESETS } from "../domain/weapon-presets";
import type { CalculatorInput, WeaponPresetId } from "../domain/types";

type Props = {
  input: CalculatorInput;
  onSelect: (id: WeaponPresetId) => void;
  onCopy: (id: WeaponPresetId) => void;
  onSave: () => void;
};

export function WeaponPresetsPanel({ input, onSelect, onCopy, onSave }: Props) {
  const active = activeWeaponPreset(input);
  return (
    <section className="panel weapon-presets" aria-labelledby="weapon-presets-heading">
      <div className="panel-heading">
        <div><h2 id="weapon-presets-heading">상황에 맞게 무기 전환</h2></div>
        <button type="button" className="secondary-button" onClick={onSave}>프리셋 3개 함께 저장</button>
      </div>
      <div className="weapon-preset-grid">
        {WEAPON_PRESETS.map(preset => {
          const saved = getWeaponPreset(input, preset.id);
          const preview = switchWeaponPreset(input, preset.id);
          const result = calculateDamageResult(preview);
          const ready = !!saved?.weapon.attackFlat.trim() && !result.issues.some(issue => issue.severity === "error");
          return <div className={`weapon-preset-card ${active === preset.id ? "is-active" : ""}`} key={preset.id}>
            <button type="button" className="weapon-preset-select" aria-pressed={active === preset.id}
              aria-label={`${preset.label} 프리셋 선택`} onClick={() => onSelect(preset.id)}>
              <strong>{preset.label}</strong><span>{preset.hint}</span>
              <small>{active === preset.id ? "편집 중" : ready ? "입력됨" : "무기 입력 필요"}</small>
            </button>
            <dl>
              <div><dt>최대 스탯공</dt><dd>{ready ? result.statAttack.toLocaleString("ko-KR") : "—"}</dd></div>
              <div><dt>대상별 환산공</dt><dd>{ready ? result.convertedAttack.toLocaleString("ko-KR") : "—"}</dd></div>
              <div><dt>몬스터 방어율</dt><dd>{preview.character.monsterDefense || "0"}%</dd></div>
            </dl>
            {ready && result.issues.some(issue => ["UNMET_LEVEL_REQUIREMENT", "UNMET_SUBSTAT_REQUIREMENT"].includes(issue.code)) && <p className="equipment-wear-warning">착용 불가 · 가정값</p>}
            {active !== preset.id && <button type="button" className="secondary-button" onClick={() => onCopy(preset.id)}
              aria-label={`현재 무기를 ${preset.label}에 복사`}>현재 무기 복사</button>}
          </div>;
        })}
      </div>
    </section>
  );
}
