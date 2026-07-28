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

  return {
    mainFlat: asFieldValue(main.flat + parsed.allStat.flat),
    subFlat: asFieldValue(sub.flat + parsed.allStat.flat),
    mainPercent: asFieldValue(main.percent + parsed.allStat.percent),
    subPercent: asFieldValue(sub.percent + parsed.allStat.percent),
  };
}
