import { isWearBlocked } from "../domain/requirements";
import { calculateDamageResult } from "../domain/calculate";
import { activeWeaponPreset, getWeaponPreset, switchWeaponPreset, WEAPON_PRESETS } from "../domain/weapon-presets";
import type { CalculatorInput, WeaponPresetId } from "../domain/types";

type Props = {
  input: CalculatorInput;
  onSelect: (id: WeaponPresetId) => void;
  onSave: () => void;
};

export function WeaponPresetsPanel({ input, onSelect, onSave }: Props) {
  const active = activeWeaponPreset(input);
  return (
    <section className="panel weapon-presets" aria-labelledby="weapon-presets-heading">
      <div className="panel-heading">
        <div><h2 id="weapon-presets-heading">무기 프리셋</h2></div>
        <button type="button" className="secondary-button" onClick={onSave}>프리셋 저장</button>
      </div>
      <div className="weapon-preset-grid">
        {WEAPON_PRESETS.map(preset => {
          const saved = getWeaponPreset(input, preset.id);
          const preview = switchWeaponPreset(input, preset.id);
          const result = calculateDamageResult(preview);
          const hasWeaponInput = Object.values(saved?.weapon ?? {}).some(value => (value ?? "").trim() !== "");
          const ready = !!saved?.weapon.attackFlat.trim() && !result.issues.some(issue => issue.severity === "error");
          return <div className={`weapon-preset-card ${active === preset.id ? "is-active" : ""}`} key={preset.id}>
            <button type="button" className="weapon-preset-select" aria-pressed={active === preset.id}
              aria-label={`${preset.label} 프리셋 선택`} onClick={() => onSelect(preset.id)}>
              <strong>{preset.label}</strong><span>{preset.hint}</span>
              <small>{!hasWeaponInput ? "무기 미등록" : active === preset.id ? "편집 중" : ready ? "무기 등록됨" : "입력 확인"}</small>
            </button>
            <details className="weapon-preset-details"><summary>{preset.label} 수치</summary><dl>
              <div><dt>최대 스탯공</dt><dd>{ready ? result.statAttack.toLocaleString("ko-KR") : "—"}</dd></div>
              <div><dt>대상별 환산공</dt><dd>{ready ? result.convertedAttack.toLocaleString("ko-KR") : "—"}</dd></div>
              <div><dt>몬스터 방어율</dt><dd>{preview.character.monsterDefense || "0"}%</dd></div>
            </dl>
            {ready && result.issues.some(issue => isWearBlocked(issue)) && <p className="equipment-wear-warning">착용 불가 · 가정값</p>}
            </details>
          </div>;
        })}
      </div>
    </section>
  );
}
