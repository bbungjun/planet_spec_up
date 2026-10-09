import { normalizedReviewOption } from "./reviewRecognition";
import { readCombatOptionLabel, readTooltipRequirement } from "./parseMapleTooltip";
import { locateSourceRegion, type SourceFrameMetadata } from "./sourceFrame";
import type { OcrBounds, OcrReview, OcrReviewLine } from "./types";

export type RecognitionIssueCode = "label-unreadable" | "label-conflict" | "value-unreadable" | "value-conflict"
  | "unit-conflict" | "unit-unreadable" | "crop-incomplete" | "source-unavailable" | "runtime-failed";
export type RecognitionIssue = { code: RecognitionIssueCode; lineId?: string; bounds?: OcrBounds; detail?: string };
export type LiteralOptionValue = { labelText: string; value: number; percent: boolean; literal: string };
const percentOnly = new Set(["총데미지", "보스데미지", "방어율무시", "크리티컬확률"]);
export const isUnrecognizedOptionLabel = (text: string): boolean => !readCombatOptionLabel(text)
  && !readTooltipRequirement(text) && !normalizedReviewOption(text);

/** Read only literal digits and the actually observed unit, independently of the option vocabulary. */
export function literalOptionValue(text: string): LiteralOptionValue | null {
  const match = text.normalize("NFKC").trim().match(/^(.*?)(?:[:;]\s*\+?\s*|\+\s*)(\d+(?:\.\d+)?)(\s*%?)\s*[;,.]?\s*$/u);
  if (!match || !match[1].trim() || /[\d+%:;]/u.test(match[1]) || !Number.isFinite(Number(match[2]))) return null;
  return { labelText: match[1].trim(), value: Number(match[2]), percent: match[3].includes("%"), literal: match[2] + (match[3].includes("%") ? "%" : "") };
}

/** Non-parsed numeric evidence is not silently dropped in favour of a readable value. */
export function agreedLiteralValue(line: OcrReviewLine): LiteralOptionValue | null {
  if (line.readings.length < 2 || new Set(line.readings.map(r => r.pass)).size < 2) return null;
  const values = line.readings.map(r => literalOptionValue(r.text));
  if (values.some(v => !v)) return null;
  const first = values[0]!;
  return values.every(v => v!.value === first.value && v!.percent === first.percent) ? first : null;
}

/** Diagnostics never alter review status, values, warnings or the user's confirmation. */
export function classifyRecognitionIssues(review: OcrReview, frame?: SourceFrameMetadata): RecognitionIssue[] {
  const issues: RecognitionIssue[] = [];
  for (const line of review.lines) {
    if (line.status !== "check") continue;
    const add = (code: RecognitionIssueCode, detail?: string) => issues.push({ code, lineId: line.id, bounds: line.bounds, ...(detail ? { detail } : {}) });
    const values = line.readings.map(r => literalOptionValue(r.text));
    if (values.some(v => !v) || !values.length) add("value-unreadable");
    if (line.readings.some(r => isUnrecognizedOptionLabel(r.text))) add("label-unreadable");
    const labels=line.readings.map(r=>readCombatOptionLabel(r.text)
      ?? (readTooltipRequirement(r.text)?`REQ ${readTooltipRequirement(r.text)!.label}`:null)).filter(Boolean);
    if(new Set(labels).size>1)add("label-conflict");
    const valid = values.filter((v): v is LiteralOptionValue => !!v);
    if (new Set(valid.map(v => v.value)).size > 1) add("value-conflict");
    if (new Set(valid.map(v => v.percent)).size > 1) add("unit-conflict");
    if (valid.some(v => !v.percent && percentOnly.has(readCombatOptionLabel(v.labelText) ?? ""))) add("unit-unreadable");
    if (!frame) add("source-unavailable");
    else if (!line.bounds) add("crop-incomplete", "missing-row-bounds");
    else {
      const region = locateSourceRegion(frame, line.bounds);
      if (!region || region.clipped) add("crop-incomplete", "outside-original-pixels");
    }
  }
  for (const attempt of review.recoveryObservations ?? []) {
    if (attempt.status !== "read") issues.push({ code: "runtime-failed", lineId: attempt.lineId,
      bounds: attempt.bounds, detail: attempt.reason ?? attempt.status });
  }
  return issues;
}
