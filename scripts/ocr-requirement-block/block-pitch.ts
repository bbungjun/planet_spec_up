import { readTooltipRequirement } from "../../features/calculator/ocr/parseMapleTooltip";
import type { OcrBounds, OcrReview, OcrReviewLine } from "../../features/calculator/ocr/types";
import { requirementFields, type RequirementBlock } from "./block";

const COLUMN = 0.02, PITCH_AGREEMENT = 0.1, RESIDUAL = 0.25, MARGIN = 0.01, REACH = 0.28, PLACED_SPAN = 0.36;
type Anchor = { index: number; center: number; line: OcrReviewLine };

const center = (b: OcrBounds) => b.y + b.height / 2;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * Places the five requirement rows from the row spacing of anchors whose label was read
 * exactly (REQ STR, REQ DEX ...). Rows the detector missed entirely — red unmet
 * requirements, or blocks without ITEM rows — still get a position, and the caller must
 * find real glyph pixels there before reading a value. Anchors must agree on one column
 * and one pitch; any detected line whose reading names a different requirement at a
 * placed row rejects the block. No image ID, expected value or numeric output is used.
 */
export function locateRequirementBlockByPitch(review: OcrReview): RequirementBlock {
  const fail = (reason: string) => ({ status: "unavailable" as const, reason });
  const lines = review.lines.filter(line => line.bounds && line.status !== "ignored");
  const anchors: Anchor[] = [];
  for (const line of lines) {
    const labels = new Set(line.readings.map(r => readTooltipRequirement(r.text)?.label).filter(Boolean));
    if (labels.size !== 1) continue;
    const index = (requirementFields as readonly string[]).indexOf([...labels][0]!);
    if (index >= 0) anchors.push({ index, center: center(line.bounds!), line });
  }
  const byIndex = new Map<number, Anchor[]>();
  for (const anchor of anchors) byIndex.set(anchor.index, [...(byIndex.get(anchor.index) ?? []), anchor]);
  if ([...byIndex.values()].some(list => list.length > 1)) return fail("duplicate-anchor");
  if (anchors.length < 2) return fail("too-few-label-anchors");
  const left = Math.min(...anchors.map(a => a.line.bounds!.x));
  if (anchors.some(a => a.line.bounds!.x - left > COLUMN)) return fail("anchors-not-aligned");

  const pitches: number[] = [];
  for (const a of anchors) for (const b of anchors) if (b.index > a.index) pitches.push((b.center - a.center) / (b.index - a.index));
  const pitch = median(pitches);
  if (!(pitch > 0) || pitches.some(p => Math.abs(p - pitch) > pitch * PITCH_AGREEMENT)) return fail("pitch-disagreement");
  // Two anchors alone cannot reveal a misread label (INT read as LUK skews the pitch).
  // The pitch must match the spacing of detected lines in the same column.
  const column = lines.filter(line => line.bounds!.width >= .15 && Math.abs(line.bounds!.x - left) <= COLUMN)
    .map(line => center(line.bounds!)).sort((a, b) => a - b);
  const gaps = column.slice(1).map((c, i) => c - column[i]).filter(gap => gap > pitch * .5 && gap < pitch * 1.5);
  if (!gaps.length || Math.abs(median(gaps) - pitch) > pitch * .15) return fail("pitch-vs-spacing");
  const base = median(anchors.map(a => a.center - a.index * pitch));
  if (anchors.some(a => Math.abs(a.center - (base + a.index * pitch)) > pitch * RESIDUAL)) return fail("anchor-off-grid");

  const height = median(anchors.map(a => a.line.bounds!.height));
  const anchorRight = Math.max(...anchors.map(a => a.line.bounds!.x + a.line.bounds!.width));
  const rows = [];
  for (const [index, field] of requirementFields.entries()) {
    const c = base + index * pitch;
    const own = lines.filter(line => Math.abs(center(line.bounds!) - c) < pitch * .4
      && line.bounds!.x >= left - COLUMN && line.bounds!.x <= left + REACH);
    const named = new Set(own.flatMap(line => line.readings.map(r => readTooltipRequirement(r.text)?.label)).filter(Boolean));
    if ([...named].some(label => label !== field)) return fail(`label-conflict-${field}`);
    // A detected row ends at its own text. A row the detector missed may hold a longer value
    // than the anchors (REQ LEV : 120 beside REQ STR : 0), so it spans the block column and
    // the caller trims it at the first wide gap after the value.
    const right = own.length ? Math.max(...own.map(l => l.bounds!.x + l.bounds!.width)) + MARGIN : Math.max(anchorRight + MARGIN, left + PLACED_SPAN);
    rows.push({ field, lineIds: own.map(l => l.id), bounds: { x: left, y: c - height / 2, width: right - left, height } });
  }
  return { status: "located", anchors: anchors.length, rows };
}
