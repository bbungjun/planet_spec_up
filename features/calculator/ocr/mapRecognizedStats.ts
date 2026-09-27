import { JOB_RULES } from "../domain/job-rules";
import type { JobId } from "../domain/types";
import type { ParsedTooltipStats, StatReplacement } from "./types";

function asFieldValue(value: number): string {
  return value === 0 ? "" : String(value);
}

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
  };
  for (const option of parsed.options) {
    const field = option.requirement
      ? option.label === subStat ? "requiredSub" : /^(LEV|LEVEL)$/.test(option.label) ? "requiredLevel" : undefined
      : option.label === "공격력" ? option.percent ? "attackPercent" : "attackFlat"
      : option.label === "총데미지" && option.percent ? "totalDamagePercent"
      : option.label === "보스데미지" && option.percent ? "bossDamagePercent"
      : option.label === "방어율무시" && option.percent ? "ignoreDefensePercent"
      : undefined;
    if (field) {
      result[field] = String(option.requirement ? option.value : Number(result[field] ?? 0) + option.value);
    }
  }
  return result;
}
