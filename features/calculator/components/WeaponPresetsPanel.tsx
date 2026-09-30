import { isWearBlocked } from "../domain/requirements";
import { calculateDamageResult } from "../domain/calculate";
import { activeWeaponPreset, getWeaponPreset, switchWeaponPreset, WEAPON_PRESETS } from "../domain/weapon-presets";
import type { CalculatorInput, WeaponPresetId } from "../domain/types";

type Props = {
  input: CalculatorInput;
  onSelect: (id: WeaponPresetId) => void;
  onSave: () => void;
  savedAt: string | null;
  hasUnsavedChanges: boolean;
  storageError: string | null;
};

export function WeaponPresetsPanel({ input, onSelect, onSave, savedAt, hasUnsavedChanges, storageError }: Props) {
  const active = activeWeaponPreset(input);
  return (
    <section className="panel weapon-presets" aria-labelledby="weapon-presets-heading">
      <div className="panel-heading"><h2 id="weapon-presets-heading">무기 프리셋</h2></div>
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
            <div className="weapon-preset-metrics"><dl>
              <div><dt>최대 스탯공</dt><dd>{ready ? result.statAttack.toLocaleString("ko-KR") : "—"}</dd></div>
              <div><dt>환산 공격력</dt><dd>{ready ? result.convertedAttack.toLocaleString("ko-KR") : "—"}</dd></div>
            </dl>
            {ready && result.issues.some(issue => isWearBlocked(issue)) && <p className="equipment-wear-warning">착용 불가 · 가정값</p>}
            </div>
          </div>;
        })}
      </div>
      <button type="button" className="secondary-button preset-save-button" onClick={onSave}>프리셋 저장</button>
      {storageError === null ? (
        <p role="status" aria-label="저장 상태" className="preset-storage-status">
          {hasUnsavedChanges ? "저장하지 않은 변경 있음" : savedAt === null ? "저장된 세팅 없음" : <>저장됨 <time dateTime={savedAt}>{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(savedAt))}</time></>}
        </p>
      ) : <p role="alert" className="preset-storage-status">{storageError}</p>}
    </section>
  );
}
