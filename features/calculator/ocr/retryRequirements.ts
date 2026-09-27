import { JOB_RULES } from "../domain/job-rules";
import { parseTooltipOption, readTooltipRequirement } from "./parseMapleTooltip";
import { buildOcrReview } from "./reviewRecognition";
import type { OcrReview, OcrReviewLine } from "./types";

const usedRequirements = new Set(["LEV", ...Object.values(JOB_RULES).map(rule => rule.subStat)]);

export function retryRequirementLabel(line: OcrReviewLine): string | null {
  if (line.status !== "check" || !line.bounds) return null;
  const labels = new Set(line.readings.map(reading => readTooltipRequirement(reading.text)?.label).filter(label => label !== undefined));
  if (labels.size !== 1) return null;
  const label = [...labels][0]!;
  return usedRequirements.has(label) ? label : null;
}

/** A reread contributes evidence only for the same observed requirement row.
 * Existing conflicting numbers remain blocking; no majority vote overrides them. */
export function mergeRequirementRetry(review: OcrReview, id: string, text: string, pass: number): OcrReview {
  const line = review.lines.find(line => line.id === id);
  if (!line || line.readings.some(reading => reading.pass === pass)) return review;
  const label = retryRequirementLabel(line);
  const option = parseTooltipOption(text);
  if (!label || !option?.requirement || option.label !== label) return review;
  const readings = [...line.readings, { text, pass, bounds: line.bounds }];
  const [updated, extra] = buildOcrReview(readings).lines;
  if (!updated || extra) return review;
  return { ...review, lines: review.lines.map(item => item.id === id ? { ...updated, id, bounds: line.bounds } : item) };
}
