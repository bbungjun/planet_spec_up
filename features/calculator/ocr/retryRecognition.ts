/**
 * 항목을 식별할 수 있으나 값이 불확실한 줄의 재시도 대상·영역·증거 병합을 담당한다.
 * 재인식으로 새 증거를 얻되 기존 숫자/% 충돌을 다수결로 덮어쓰지 않는다.
 */
import { parseEquipmentCategory, parseTooltipOption, readCombatOptionLabel, readTooltipRequirement } from "./parseMapleTooltip";
import { buildOcrReview, suggestReviewOptions } from "./reviewRecognition";
import { retryRequirementLabel } from "./retryRequirements";
import type { OcrBounds, OcrReview, OcrReviewLine } from "./types";

/**
 * 확인 필요 줄에서 요구 조건 또는 유일한 전투 옵션 이름을 식별한다.
 * 항목이 모호하거나 좌표가 없으면 null을 반환한다. 이름 제안만으로 숫자를 자동 확정하지 않는다.
 */
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

/**
 * 같은 줄에서 떨어진 숫자 조각과 인접 요구 조건의 숫자 열 위치를 고려해 재시도 범위를 넓힌다.
 * 다른 필드의 경계를 넘거나 그 필드의 숫자 자체를 가져오지 않는다.
 */
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

/**
 * 같은 항목의 새로운 판독 회차만 해당 줄에 추가해 검토 상태를 다시 계산한다.
 * 원래 줄과 다른 줄은 보존하며, 잘못 읽힌 이름에 남아 있는 숫자/% 충돌도 확인 필요 상태로 유지한다.
 */
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
