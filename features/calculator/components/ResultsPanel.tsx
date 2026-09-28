import { isWearBlocked } from "../domain/requirements";
import { JOB_RULES, type JobRule } from "../domain/job-rules";
import { useMemo } from "react";
import { calculateDamageResult } from "../domain/calculate";
import { normalizeInput } from "../domain/normalize";
import { sumEquipment } from "../domain/equipment";
import { calculateTotalAttack } from "../domain/formulas";
import { emptyEquipment } from "../domain/defaults";
import { ATTACK_BUFF_PRESETS, STACKABLE_ATTACK_BUFFS, type StackableAttackBuffId } from "../domain/attack-buffs";
import type {
  CalculationResult,
  CalculatorInput,
  CharacterInput,
  EquipmentInput,
  EquipmentSlot,
  JobId,
} from "../domain/types";
import { getEquipmentSlotLabel } from "../domain/slots";
import { EQUIPMENT_FIELD_DEFINITIONS } from "./EquipmentEditor";
import { PresetStatWindow } from "./PresetStatWindow";
import { OptionEfficiencyPanel } from "./OptionEfficiencyPanel";
import { StackableBuffControls } from "./StackableBuffControls";
import { levelAchievementBonus } from "../domain/level";
import { cashEquipmentBonus } from "../domain/cash-equipment";

type ResultsPanelProps = {
  job: JobId;
  input: CalculatorInput;
  result: CalculationResult;
  onNavigate: (path: string) => void;
  onBuffSelect: (attack: number) => void;
  onStackableBuffChange: (buff: StackableAttackBuffId, enabled: boolean) => void;
};

const integerFormat = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 0,
});

const CHARACTER_FIELD_LABELS: Partial<Record<keyof CharacterInput, string>> = {
  level: "레벨",
  skillPercent: "타격당 평균 데미지 비율",
  monsterDefense: "몬스터 방어율",
  bossAndTotalDamage: "보스 공격력 및 총데미지",
  totalDamagePercent: "기타 총데미지%",
  bossDamagePercent: "기타 보스공격력%",
  ignoreDefense: "방어율 무시",
  criticalRate: "추가 크리티컬 확률",
  manualPureSub: "순수 부스탯 수동값",
  pureMain: "순수 주스탯",
  pureSub: "순수 부스탯",
  guildBossPercent: "길드 보스 공격력",
  guildIgnorePercent: "길드 방어율 무시",
  guildAttackFlat: "길드 공격력",
  guildAccuracyFlat: "길드 명중률",
  nightLordStrStat: "나이트로드 스탯창 STR",
};

function issueContext(path: string, rule: JobRule, input: CalculatorInput): string {
  const [group, candidate, fieldCandidate] = path.split(".");
  if (path === "cashEquipment.auroraRingCount") return "오로라 반지 개수";

  if (group === "equipment") {
    const slot = candidate as EquipmentSlot;
    const field = fieldCandidate as keyof EquipmentInput;
    const fieldDefinition = EQUIPMENT_FIELD_DEFINITIONS.find(
      (definition) => definition.field === field,
    );
    const slotLabel = getEquipmentSlotLabel(input, slot);
    if (field === "pendantId") return `${slotLabel} 종류`;
    if (slotLabel !== undefined && fieldDefinition !== undefined) {
      return `${slotLabel} ${
        fieldDefinition.suffix(rule.mainStat, rule.subStat)
      }`;
    }
  }

  if (group === "character") {
    return CHARACTER_FIELD_LABELS[candidate as keyof CharacterInput] ?? path;
  }

  return path;
}

export function ResultsPanel({
  job,
  input,
  result,
  onNavigate,
  onBuffSelect,
  onStackableBuffChange,
}: ResultsPanelProps) {
  const rule = JOB_RULES[job];
  const extraStat = job === "night_lord" ? " + STR" : "";
  const missingWeapon = result.issues.some(issue => issue.code === "MISSING_WEAPON_ATTACK");
  const activeBuffAttack = Number(input.equipment.buff?.attackFlat ?? "0");
  const activeBuff = ATTACK_BUFF_PRESETS.find(preset => preset.attack === activeBuffAttack);
  const invalidBuff = result.issues.some(issue => issue.path === "equipment.buff.attackFlat" && issue.severity === "error");
  const activeBuffLabels = [
    ...(activeBuffAttack > 0 ? [`${activeBuff?.label ?? "직접 입력 버프"} +${activeBuffAttack}`] : []),
    ...STACKABLE_ATTACK_BUFFS.filter(buff => input.attackBuffs?.[buff.id]).map(buff => `${buff.label} +${buff.attack}`),
  ];
  const buffSummary = invalidBuff ? "공격력 버프 입력을 확인해주세요"
    : activeBuffLabels.length === 0 ? "공격력 버프 없음"
    : `${activeBuffLabels.join(" · ")} 적용`;
  const buffComparisons = useMemo(() => ATTACK_BUFF_PRESETS.map(preset => ({
    ...preset,
    result: calculateDamageResult({
      ...input,
      equipment: {...input.equipment, buff: {...(input.equipment.buff ?? emptyEquipment()), attackFlat: String(preset.attack)}},
    }),
  })), [input]);
  const attackSources = useMemo(() => {
    const normalized = normalizeInput(input).value;
    const totals = sumEquipment(normalized.equipment, JOB_RULES[input.character.job], (input.customSlots ?? []).map(({id}) => id));
    const cashAttack = cashEquipmentBonus(normalized.cashEquipment).attack;
    const equipmentAttack = calculateTotalAttack(totals.percentEligibleAttack, 0, totals.attackPercent);
    return [
      ["장비 (% 적용 후)", equipmentAttack],
      ["캐시 장비 (% 적용 후)", calculateTotalAttack(totals.percentEligibleAttack + cashAttack, 0, totals.attackPercent) - equipmentAttack],
      ...(input.character.job === "aran" ? [["패시브·콤보 (공% 제외 가정)", normalized.character.aranFlatAttack] as const] : [["불릿·표창", normalized.equipment.projectile?.attackFlat ?? 0] as const]),
      ["정령의 축복", normalized.equipment.blessing_1?.attackFlat ?? 0],
      ["여제의 축복", normalized.equipment.blessing_2?.attackFlat ?? 0],
      ["공격력 버프", normalized.equipment.buff?.attackFlat ?? 0],
      ...STACKABLE_ATTACK_BUFFS.map(buff => [buff.label, input.attackBuffs?.[buff.id] ? buff.attack : 0] as const),
      ["길드 공격력", normalized.character.guildAttackFlat],
      ["레벨 달성 버프", levelAchievementBonus(normalized.character.level).attack],
    ] as const;
  }, [input]);

  return (
    <aside className="panel results-panel" aria-label="계산 결과" tabIndex={0}>
      <div className="game-window-heading result-window-heading"><span className="game-window-label" aria-hidden="true">CHARACTER STAT</span><span>능력치</span><i aria-hidden="true">▦</i></div>
      <PresetStatWindow input={input} result={result} buffSummary={buffSummary} />

      {result.issues.some(issue => isWearBlocked(issue)) && <p className="equipment-wear-warning" role="status">착용 불가 장비 포함 · 가정값</p>}

      <OptionEfficiencyPanel input={input} />

      <section className="buff-comparison" aria-label="버프별 스탯공 비교">
        <h3>버프별 최대 스탯공</h3>
        {buffComparisons.map(({label, attack, result: comparison}) => (
          <button key={label} type="button" className={`buff-comparison-option${!invalidBuff && activeBuffAttack === attack ? " is-active" : ""}`}
            aria-label={`${label} 버프 적용`} aria-pressed={!invalidBuff && activeBuffAttack === attack}
            onClick={() => onBuffSelect(attack)}>
            <span className="buff-comparison-label">{label} <small>+{attack}</small>
              {!invalidBuff && activeBuffAttack === attack && <span className="buff-applied-badge">적용 중</span>}
            </span>
            <output aria-label={`${label} 예상 스탯공`}>{missingWeapon || (input.character.job === "aran" && result.issues.some(issue => issue.severity === "error")) ? "—" : integerFormat.format(comparison.statAttack)}</output>
          </button>
        ))}

      </section>

      <section className="additional-buffs" aria-label="추가 버프">
        <h3>추가 버프 <small>중첩 가능</small></h3>
        <StackableBuffControls buffs={input.attackBuffs} label="추가 버프 선택" onChange={onStackableBuffChange} />
      </section>

      <details className="attack-breakdown">
        <summary>공격력 합산 내역 <strong>{integerFormat.format(result.totalAttack)}</strong></summary>
        <dl>{attackSources.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>+{integerFormat.format(value)}</dd></div>)}</dl>
      </details>

      <details className="preset-formula-details">
        <summary>계산 근거</summary>
        <p>최대 스탯공 = ⌊({rule.mainStat} × {input.character.job === "aran" ? input.character.aranWeaponConstant || "미확인" : rule.weaponConstant} + {rule.subStat}{extraStat}) × 공격력 ÷ 100⌋</p>
        <p>환산공 = ⌊스탯공 × (1 + 보공·총뎀% ÷ 100) × 방어율 배율 × 크리 배율⌋</p>
        <p>타격당 평균 데미지 {input.character.skillPercent || "0"}% 기준</p>
      </details>

      {result.issues.length > 0 && <section className="result-issues" aria-labelledby="issues-heading">
        <h3 id="issues-heading">확인할 항목</h3>

          <ul>
            {result.issues.map((issue, index) => {
              const severityLabel = issue.severity === "error" ? "오류" : "경고";
              const context = issueContext(issue.path, rule, input);

              return (
                <li key={`${issue.path}-${issue.code}-${index}`}>
                  <button
                    type="button"
                    className={`issue-button is-${issue.severity}`}
                    aria-label={`${severityLabel} ${context}: ${issue.message}`}
                    onClick={() => onNavigate(issue.path)}
                  >
                    <span>{severityLabel}</span>
                    <div>
                      <strong>{context}</strong>
                      {!isWearBlocked(issue) && <div>{issue.message}</div>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
      </section>}
    </aside>
  );
}
