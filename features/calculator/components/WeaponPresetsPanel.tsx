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
        <div><p className="panel-kicker">무기 프리셋</p><h2 id="weapon-presets-heading">상황에 맞게 무기 전환</h2></div>
        <button type="button" className="secondary-button" onClick={onSave}>프리셋 3개 함께 저장</button>
      </div>
      <p className="panel-description">방어구·캐릭터·버프는 공통입니다. 무기 옵션과 몬스터 방어율만 따로 유지하며, 저장하면 새로고침 후에도 복원됩니다.</p>
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
            {active !== preset.id && <button type="button" className="secondary-button" onClick={() => onCopy(preset.id)}
              aria-label={`현재 무기를 ${preset.label}에 복사`}>현재 무기 복사</button>}
          </div>;
        })}
      </div>
      <p className="panel-description">카오스 기본 방어율은 혼테일 기준 80%, 나머지는 0%입니다. 상세 전투 설정에서 대상에 맞게 수정하세요. 서로 다른 대상의 환산공은 무기 우열을 직접 뜻하지 않습니다.</p>
    </section>
  );
}
