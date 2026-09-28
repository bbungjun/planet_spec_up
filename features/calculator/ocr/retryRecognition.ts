import { parseEquipmentCategory, parseTooltipOption, readCombatOptionLabel, readTooltipRequirement } from "./parseMapleTooltip";
import { buildOcrReview, suggestReviewOptions } from "./reviewRecognition";
import { retryRequirementLabel } from "./retryRequirements";
import type { OcrBounds, OcrReview, OcrReviewLine } from "./types";

/** Only an identified field can be recovered automatically. A new OCR reading,
 * rather than a spelling suggestion or confidence score, must supply its value. */
export function retryRecognitionLabel(line: OcrReviewLine): string | null {
  if (line.status !== "check" || !line.bounds) return null;
  const requirement = retryRequirementLabel(line);
  if (requirement) return requirement;
  if (line.readings.some(reading => readTooltipRequirement(reading.text))) return null;
  const labels = new Set(line.readings.map(reading => readCombatOptionLabel(reading.text)).filter(Boolean));
  if (!labels.size) for (const text of suggestReviewOptions(line)) {
    const option = parseTooltipOption(text);
    if (option && !option.requirement) labels.add(option.label);
  }
  return labels.size === 1 ? [...labels][0]! : null;
}

const center = (bounds: OcrBounds) => bounds.y + bounds.height / 2;

/** Include a detached value on the same row and the value column evidenced by
 * nearby requirements. Never borrow its text/value, or cross another field. */
export function retryRecognitionBounds(review: OcrReview, line: OcrReviewLine): OcrBounds | null {
  const bounds = line.bounds;
  if (!bounds || !retryRecognitionLabel(line)) return null;
  const labelOnly = !line.readings.some(reading => parseTooltipOption(reading.text));
  const limit = Math.min(1, bounds.x + bounds.width * 1.8);
  let right = bounds.x + bounds.width;
  let stop = 1;
  for (const other of review.lines) {
    if (other === line || !other.bounds) continue;
    const box = other.bounds;
    const sameRow = Math.abs(center(box) - center(bounds)) < Math.min(box.height, bounds.height) * .65;
    const field = other.readings.some(reading => readTooltipRequirement(reading.text)
      || readCombatOptionLabel(reading.text) || parseEquipmentCategory(reading.text));
    if (sameRow && box.x >= bounds.x + bounds.width && field) stop = Math.min(stop, box.x);
    if (sameRow && !field && box.x >= bounds.x + bounds.width * .8
      && box.x + box.width <= limit) right = Math.max(right, box.x + box.width);
    if (labelOnly && retryRequirementLabel(line) && other.readings.some(reading => readTooltipRequirement(reading.text))
      && Math.abs(box.x - bounds.x) < bounds.width * .2 && Math.abs(center(box) - center(bounds)) < bounds.height * 8
      && box.x + box.width <= limit) right = Math.max(right, box.x + box.width);
  }
  // If the detector missed the digit entirely, leave a bounded value-sized area.
  if (labelOnly) right = Math.max(right, bounds.x + bounds.width * 1.45);
  return { ...bounds, width: Math.max(bounds.width, Math.min(right, stop, limit) - bounds.x) };
}

/** Local retries can repair missing/misspelled fields but cannot outvote any
 * conflicting numeric evidence. Preserve the other rows and repeated options. */
export function mergeRecognitionRetry(review: OcrReview, id: string, text: string, pass: number): OcrReview {
  const line = review.lines.find(line => line.id === id);
  if (!line || line.readings.some(reading => reading.pass === pass)) return review;
  const label = retryRecognitionLabel(line), option = parseTooltipOption(text);
  const requirement = !!retryRequirementLabel(line);
  if (!label || !option || option.label !== label || option.requirement !== requirement) return review;
  // An option above the equipment body may be a requirement with a lost prefix.
  if (!requirement && line.reason?.includes("요구 조건과 장비 옵션")) return review;
  const readings = [...line.readings, { text, pass, bounds: line.bounds }];
  // A repeated unknown spelling is not agreement for the recovered field.
  // Retain it as raw evidence, but require two actual readings of this label.
  const evidence = readings.filter(reading => {
    const parsed = parseTooltipOption(reading.text);
    return !parsed || (parsed.label === label && parsed.requirement === requirement);
  });
  const [updated, extra] = buildOcrReview(evidence).lines;
  if (!updated || extra) return review;
  // Even a misspelled option may carry a contradictory number or percent.
  // Correcting its label must not make that numeric evidence disappear.
  const unknownConflict = !requirement && readings.some(reading => {
    const parsed = parseTooltipOption(reading.text);
    return parsed && !parsed.requirement && parsed.label !== label
      && (parsed.value !== option.value || parsed.percent !== option.percent);
  });
  if (unknownConflict) {
    updated.status = "check";
    updated.reason = "같은 줄의 숫자·옵션 종류가 다르게 읽혔어요. 원본과 대조해주세요.";
  }
  return { ...review, lines: review.lines.map(item => item.id === id ? { ...updated, id, bounds: line.bounds, readings } : item) };
}
