import { JOB_RULES } from "../domain/job-rules";
import { parseTooltipOption, readTooltipRequirement } from "./parseMapleTooltip";
import { buildOcrReview } from "./reviewRecognition";
import type { LocatedRequirement, OcrReview, OcrReviewLine, RequirementField } from "./types";

const usedRequirements = new Set(["LEV", ...Object.values(JOB_RULES).map(rule => rule.subStat)]);

export function identifiedRequirementLabel(line: OcrReviewLine): RequirementField | null {
  const labels = new Set(line.readings.map(reading => readTooltipRequirement(reading.text)?.label).filter(label => label !== undefined));
  if (labels.size !== 1) return null;
  const label = [...labels][0]!;
  return usedRequirements.has(label) ? label as RequirementField : null;
}

/** Locate every supported requirement, including matching discovery values.
 * Missing provenance belongs to the legacy review path and gains no override. */
export function locateRequirementVerification(review: OcrReview, identity: { sourceId: string; operationId: string }, size: { width: number; height: number }): LocatedRequirement[] {
  const center = (box: NonNullable<OcrReviewLine["bounds"]>) => box.y + box.height / 2;
  const candidates = review.lines.filter(line => identifiedRequirementLabel(line) && line.bounds
    && line.readings.every(reading => reading.provenance?.role === "discovery"
      && reading.provenance.sourceId === identity.sourceId && reading.provenance.operationId === identity.operationId));
  return candidates.map(line => {
    const field = identifiedRequirementLabel(line)!, bounds = line.bounds!;
    const labelOnly = !line.readings.some(reading => parseTooltipOption(reading.text));
    const limit = Math.min(1, bounds.x + bounds.width * 1.8);
    let right = bounds.x + bounds.width;
    let rightStop = 1, leftStop = 0, topStop = 0, bottomStop = 1;
    let leftNeighborEnd = 0, rightNeighborStart = 1, topNeighborEnd = 0, bottomNeighborStart = 1;
    let overlapDetected = false;
    for (const other of review.lines) {
      if (other === line || !other.bounds) continue;
      const box = other.bounds;
      const sameRow = Math.abs(center(box) - center(bounds)) < Math.min(box.height, bounds.height) * .65;
      const otherField = other.readings.some(reading => readTooltipRequirement(reading.text) || parseTooltipOption(reading.text));
      if (sameRow && otherField && box.x >= bounds.x + bounds.width) {
        rightStop = Math.min(rightStop, (bounds.x + bounds.width + box.x) / 2);
        rightNeighborStart = Math.min(rightNeighborStart, box.x);
      }
      if (sameRow && otherField && box.x + box.width <= bounds.x) {
        leftStop = Math.max(leftStop, (box.x + box.width + bounds.x) / 2);
        leftNeighborEnd = Math.max(leftNeighborEnd, box.x + box.width);
      }
      if (sameRow && !otherField && box.x >= bounds.x + bounds.width * .8 && box.x + box.width <= limit) right = Math.max(right, box.x + box.width);
      if (labelOnly && other.readings.some(reading => readTooltipRequirement(reading.text))
        && Math.abs(box.x - bounds.x) < bounds.width * .2 && Math.abs(center(box) - center(bounds)) < bounds.height * 8
        && box.x + box.width <= limit) right = Math.max(right, box.x + box.width);
      const horizontalOverlap = Math.min(bounds.x + bounds.width, box.x + box.width) > Math.max(bounds.x, box.x);
      if (horizontalOverlap && box.y + box.height <= bounds.y) {
        topStop = Math.max(topStop, (box.y + box.height + bounds.y) / 2);
        topNeighborEnd = Math.max(topNeighborEnd, box.y + box.height);
      }
      if (horizontalOverlap && box.y >= bounds.y + bounds.height) {
        bottomStop = Math.min(bottomStop, (bounds.y + bounds.height + box.y) / 2);
        bottomNeighborStart = Math.min(bottomNeighborStart, box.y);
      }
      if (horizontalOverlap && ((sameRow && otherField)
        || (!sameRow && box.y < bounds.y + bounds.height && box.y + box.height > bounds.y))) overlapDetected = true;
    }
    if (labelOnly) right = Math.max(right, bounds.x + bounds.width * 1.45);
    // Two pixels is a preferred margin, not permission to cross the midpoint
    // between adjacent rows. Both rows use the same nearest pixel separator,
    // rather than rounding their shared midpoint in opposite directions.
    // The separator must still lie in the actual gap and retain the entire
    // discovery box. Source-edge clipping remains incomplete.
    const preferredX = Math.floor(bounds.x * size.width) - 2, preferredY = Math.floor(bounds.y * size.height) - 2;
    const preferredEndX = Math.ceil(right * size.width) + 2, preferredEndY = Math.ceil((bounds.y + bounds.height) * size.height) + 2;
    const x = Math.max(preferredX, Math.round(leftStop * size.width)), y = Math.max(preferredY, Math.round(topStop * size.height));
    const endX = Math.min(preferredEndX, Math.round(rightStop * size.width)), endY = Math.min(preferredEndY, Math.round(bottomStop * size.height));
    const crop = { x: x / size.width, y: y / size.height, width: (endX - x) / size.width, height: (endY - y) / size.height };
    const duplicate = candidates.some(other => other !== line && identifiedRequirementLabel(other) === field);
    const complete = !duplicate && !overlapDetected && preferredX >= 0 && preferredY >= 0 && preferredEndX <= size.width && preferredEndY <= size.height
      && x <= bounds.x * size.width && y <= bounds.y * size.height
      && endX >= right * size.width && endY >= (bounds.y + bounds.height) * size.height
      && x >= leftNeighborEnd * size.width && endX <= rightNeighborStart * size.width
      && y >= topNeighborEnd * size.height && endY <= bottomNeighborStart * size.height;
    return { ...identity, field, rowId: line.id, lineId: line.id, rowBounds: bounds, crop, complete,
      reason: duplicate ? "multiple-requirement-rows" : overlapDetected ? "overlapping-field-or-row" : complete ? undefined : "incomplete-region" };
  });
}

export function retryRequirementLabel(line: OcrReviewLine): string | null {
  if (line.status !== "check" || !line.bounds) return null;
  return identifiedRequirementLabel(line);
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
