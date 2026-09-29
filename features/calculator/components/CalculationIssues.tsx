import { isWearBlocked } from "../domain/requirements";
import { JOB_RULES, type JobRule } from "../domain/job-rules";
import { getEquipmentSlotLabel } from "../domain/slots";
import type { CalculatorInput, CalculationResult, CharacterInput, EquipmentInput, EquipmentSlot } from "../domain/types";
import { EQUIPMENT_FIELD_DEFINITIONS } from "./EquipmentEditor";

const CHARACTER_FIELD_LABELS: Partial<Record<keyof CharacterInput, string>> = {
  level: "레벨",
  aranWeaponConstant: "폴암 계수",
  aranFlatAttack: "기타·콤보 추가 공격력 (하이 마스터리 제외)",
  aranCombo: "현재 콤보",
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


export function CalculationIssues({ input, result, onNavigate }: { input: CalculatorInput; result: CalculationResult; onNavigate: (path: string) => void }) {
  if (!result.issues.length) return null;
  const rule = JOB_RULES[input.character.job];
  return (
    <section className="panel calculation-issues" aria-labelledby="issues-heading">
      <h3 id="issues-heading">확인할 항목</h3>
      {result.issues.some(isWearBlocked) && <p className="equipment-wear-warning" role="status">착용 불가 장비 포함 · 가정값</p>}
      <ul>
        {result.issues.map((issue, index) => {
          const severityLabel = issue.severity === "error" ? "오류" : "경고";
          const context = issueContext(issue.path, rule, input);
          return <li key={`${issue.path}-${issue.code}-${index}`}>
            <button type="button" className={`issue-button is-${issue.severity}`}
              aria-label={`${severityLabel} ${context}: ${issue.message}`} onClick={() => onNavigate(issue.path)}>
              <span>{severityLabel}</span>
              <div><strong>{context}</strong><div>{issue.message}</div></div>
            </button>
          </li>;
        })}
      </ul>
    </section>
  );
}
