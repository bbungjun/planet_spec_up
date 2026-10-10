import { parseTooltipOption, readTooltipRequirement } from "../../features/calculator/ocr/parseMapleTooltip";
import type { OcrBounds, OcrReview, OcrReviewLine } from "../../features/calculator/ocr/types";

export type NumericTarget = { id: string; lineId: string; field: "requiredLevel" | "requiredSub" | "mainFlat" | "subFlat"; kind: "requirement" | "bonus"; bounds: OcrBounds };
export type PixelPlane = { width: number; height: number; data: Uint8ClampedArray };
export type Rect = { x: number; y: number; width: number; height: number };
type Component = Rect & { area: number };

/** Frozen OCR rows locate fields; neither expected values nor filenames select pixels. */
export function selectNumericTargets(review: OcrReview): NumericTarget[] {
  const result: NumericTarget[] = [];
  for (const [label, field] of [["LEV", "requiredLevel"], ["STR", "requiredSub"]] as const) {
    const candidates = review.lines.filter(line => line.bounds && (line.suspectedRequirement?.labels.length === 1
      ? line.suspectedRequirement.labels[0] === label
      : line.readings.some(r => readTooltipRequirement(r.text)?.label === label)));
    if (candidates.length === 1) result.push({ id: field, lineId: candidates[0].id, field, kind: "requirement", bounds: candidates[0].bounds! });
  }
  const conflictingBonus = (line: OcrReviewLine) => {
    const options = line.readings.map(r => parseTooltipOption(r.text)).filter(o => o && !o.requirement && !o.percent && ["STR", "DEX"].includes(o.label));
    return new Set(options.map(o => o!.value)).size > 1 && new Set(options.map(o => o!.label)).size === 1 ? options[0]!.label : null;
  };
  for (const line of review.lines) {
    if (line.status !== "check" || !line.bounds || line.suspectedRequirement) continue;
    const label = conflictingBonus(line);
    if (label) { const field = label === "DEX" ? "mainFlat" : "subFlat"; result.push({ id: `${field}-${line.id}`, lineId: line.id, field, kind: "bonus", bounds: line.bounds }); }
  }
  return result;
}

/** Geometry-only colon separation. The resulting crop keeps the whole row height/right edge,
 * including faint digits; no character is reconstructed and no expected value is consulted. */
export function numericRegion(p: PixelPlane): { status: "located"; region: Rect; separator: Rect } | { status: "unavailable"; reason: string } {
  const fail = (reason: string) => ({ status: "unavailable" as const, reason });
  const { width: w, height: h } = p;
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 8 || h < 5 || w > 2048 || h > 256 || p.data.length !== w * h * 4) return fail("invalid-row");
  const luma = new Float32Array(w * h);
  for (let i = 0; i < luma.length; i++) luma[i] = p.data[i * 4] * .299 + p.data[i * 4 + 1] * .587 + p.data[i * 4 + 2] * .114;
  const sorted = [...luma].sort((a, b) => a - b), bg = sorted[Math.floor(sorted.length * .4)], top = sorted[Math.floor(sorted.length * .98)];
  if (top - bg < 30) return fail("low-contrast");
  const threshold = bg + (top - bg) * .4, seen = new Uint8Array(w * h), parts: Component[] = [];
  for (let start = 0; start < luma.length; start++) {
    if (seen[start] || luma[start] < threshold) continue;
    const queue = [start]; seen[start] = 1; let left = w, right = 0, y0 = h, y1 = 0, area = 0;
    for (let i = 0; i < queue.length; i++) {
      const at = queue[i], x = at % w, y = Math.floor(at / w);
      left = Math.min(left, x); right = Math.max(right, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); area++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, next = yy * w + xx;
        if (xx >= 0 && xx < w && yy >= 0 && yy < h && !seen[next] && luma[next] >= threshold) { seen[next] = 1; queue.push(next); }
      }
    }
    parts.push({ x: left, y: y0, width: right - left + 1, height: y1 - y0 + 1, area });
  }
  const dots = parts.filter(a => a.width <= h * .22 && a.height <= h * .25 && a.area >= 1 && a.x > w * .1 && a.x + a.width < w * .9);
  const pairs: Rect[] = [];
  for (const a of dots) for (const b of dots) {
    if (b.y <= a.y + a.height - 1 || Math.abs(a.x + a.width / 2 - b.x - b.width / 2) > 1.1) continue;
    const height = b.y + b.height - a.y;
    if (height < h * .22 || height > h * .7 || Math.abs(a.y + height / 2 - h / 2) > h * .3) continue;
    const x = Math.min(a.x, b.x), right = Math.max(a.x + a.width, b.x + b.width);
    pairs.push({ x, y: a.y, width: right - x, height });
  }
  const columns = [...new Set(pairs.map(p => p.x))];
  if (columns.length !== 1) return fail("separator-ambiguous-or-missing");
  const separator = pairs.find(p => p.x === columns[0])!;
  const start = separator.x + separator.width + 1;
  if (!parts.some(p => p.x + p.width < separator.x && p.area >= h * .5)) return fail("missing-label-pixels");
  if (!parts.some(p => p.x >= start && p.area >= 2)) return fail("missing-value-pixels");
  if (parts.some(p => p.x >= start && p.x + p.width === w)) return fail("value-touches-right-edge");
  if (start >= w - 2) return fail("empty-value-region");
  return { status: "located", separator, region: { x: start, y: 0, width: w - start, height: h } };
}
