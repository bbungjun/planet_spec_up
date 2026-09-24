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
  };
  for (const option of parsed.options) {
    const field = option.requirement
      ? option.label === subStat ? "requiredSub" : undefined
      : option.label === "공격력" ? option.percent ? "attackPercent" : "attackFlat"
      : ["총데미지", "보스데미지"].includes(option.label) && option.percent ? "damagePercent"
      : undefined;
    if (field) {
      result[field] = String(option.requirement ? option.value : Number(result[field] ?? 0) + option.value);
    }
  }
  return result;
}
