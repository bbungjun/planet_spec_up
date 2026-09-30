/**
 * 검토 객체가 없는 호환 판독이나 중복 비교에서 파싱 합계를 직업별 입력 필드로 변환한다.
 * 기본 Paddle의 실제 적용 경로는 미인식 키를 보존하는 mapReviewedStats를 우선 사용한다.
 */
import { JOB_RULES } from "../domain/job-rules";
import type { JobId } from "../domain/types";
import type { ParsedTooltipStats, StatReplacement } from "./types";

/**
 * 호환 합산 경로의 0 합계는 빈 문자열로 표시하고 그 외 값은 입력용 문자열로 바꾼다.
 */
function asFieldValue(value: number): string {
  return value === 0 ? "" : String(value);
}

/**
 * 파싱된 주·부스탯/올스탯과 공격력·%·요구 조건을 직업별 장비 필드로 매핑한다.
 * 호환 규칙상 주·부스탯 0 합계와 초기 데미지 필드는 빈 문자열을 포함한다. 미인식 키를 생략하는 검토 기반 매핑과 동일한 계약으로 취급하지 않는다.
 */
export function mapRecognizedStats(
  parsed: ParsedTooltipStats,
  job: JobId,
): StatReplacement {
  const { mainStat, subStat } = JOB_RULES[job];
  const main = parsed.stats[mainStat];
  const sub = parsed.stats[subStat];

  const result: StatReplacement = {
    mainFlat: asFieldValue(main.flat + parsed.allStat.flat),
    subFlat: asFieldValue(sub.flat + parsed.allStat.flat),
    mainPercent: asFieldValue(main.percent + parsed.allStat.percent),
    subPercent: asFieldValue(sub.percent + parsed.allStat.percent),
    // A reviewed screenshot replaces these options; omitted lines must not
    // retain the previous weapon's boss damage or ignore-defense.
    damagePercent: "",
    totalDamagePercent: "",
    bossDamagePercent: "",
    ignoreDefensePercent: "",
    criticalRate: "",
  };
  for (const option of parsed.options) {
    const field = option.requirement
      ? option.label === subStat ? "requiredSub" : /^(LEV|LEVEL)$/.test(option.label) ? "requiredLevel" : undefined
      : option.label === "공격력" ? option.percent ? "attackPercent" : "attackFlat"
      : option.label === "총데미지" && option.percent ? "totalDamagePercent"
      : option.label === "보스데미지" && option.percent ? "bossDamagePercent"
      : option.label === "방어율무시" && option.percent ? "ignoreDefensePercent"
      : option.label === "크리티컬확률" && option.percent ? "criticalRate"
      : undefined;
    if (field) {
      result[field] = String(option.requirement ? option.value : Number(result[field] ?? 0) + option.value);
    }
  }
  return result;
}
