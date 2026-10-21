import { readTooltipRequirement } from "../../features/calculator/ocr/parseMapleTooltip";
import type { OcrBounds, OcrReview, OcrReviewLine } from "../../features/calculator/ocr/types";

/** Fixed order of the tooltip requirement block. POP and the two ITEM rows close the
 * block; they are not read but must be present so a missing row cannot shift the order. */
export const blockOrder = ["LEV", "STR", "DEX", "INT", "LUK", "POP", "ITEM_LEV", "ITEM_EXP"] as const;
export const requirementFields = ["LEV", "STR", "DEX", "INT", "LUK"] as const;
export type RequirementField = typeof requirementFields[number];

export type BlockRow = { field: RequirementField; lineIds: string[]; bounds: OcrBounds };
export type RequirementBlock = { status: "located"; rows: BlockRow[]; anchors: number }
  | { status: "unavailable"; reason: string };

const WIDE = 0.15, COLUMN = 0.02, PITCH = 0.3, MARGIN = 0.02, REACH = 0.28;
type Row = { center: number; height: number; main: OcrReviewLine; lines: OcrReviewLine[] };

const center = (b: OcrBounds) => b.y + b.height / 2;

/**
 * Locates the requirement rows by geometry and assigns fields by row order, so a misread
 * label (FEQ, LE!, IHT) no longer decides which field a value belongs to. Reading labels
 * are used only as a veto: any row whose reading parses as a different requirement label
 * rejects the block. Exactly one stack of eight evenly spaced, left-aligned rows must exist.
 * No image ID, expected value or numeric output is consulted.
 */
export function locateRequirementBlock(review: OcrReview): RequirementBlock {
  const fail = (reason: string) => ({ status: "unavailable" as const, reason });
  const lines = review.lines.filter(line => line.bounds && line.status !== "ignored");
  const rows: Row[] = [];
  for (const line of [...lines].sort((a, b) => a.bounds!.y - b.bounds!.y)) {
    if (line.bounds!.width < WIDE) continue;
    const c = center(line.bounds!);
    const row = rows.find(r => Math.abs(r.center - c) < Math.min(r.height, line.bounds!.height) / 2);
    if (!row) rows.push({ center: c, height: line.bounds!.height, main: line, lines: [line] });
    else { row.lines.push(line); if (line.bounds!.x < row.main.bounds!.x) row.main = line; }
  }
  // Narrow fragments (a value split from its label) join the row they overlap.
  for (const line of lines) {
    if (line.bounds!.width >= WIDE) continue;
    const c = center(line.bounds!);
    rows.find(r => Math.abs(r.center - c) < Math.min(r.height, line.bounds!.height) / 2
      && line.bounds!.x > r.main.bounds!.x)?.lines.push(line);
  }

  const stacks: Row[][] = [];
  for (let i = 0; i < rows.length; i++) {
    const x0 = rows[i].main.bounds!.x, stack = [rows[i]];
    for (let j = i + 1; j < rows.length && Math.abs(rows[j].main.bounds!.x - x0) <= COLUMN; j++) stack.push(rows[j]);
    const gaps = stack.slice(1).map((r, k) => r.center - stack[k].center);
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    const even = [stack[0]];
    for (let k = 0; k < gaps.length && Math.abs(gaps[k] - median) <= median * PITCH; k++) even.push(stack[k + 1]);
    if (even.length === blockOrder.length) stacks.push(even);
  }

  const accepted: Array<{ stack: Row[]; anchors: number }> = [], vetoes: string[] = [];
  for (const stack of stacks) {
    let anchors = 0, veto: string | null = null;
    requirementFields.forEach((field, k) => {
      const labels = new Set(stack[k].lines.flatMap(line => line.readings.map(r => readTooltipRequirement(r.text)?.label)).filter(Boolean));
      if ([...labels].some(label => label !== field)) veto ??= `label-conflict-${field}`;
      if (labels.has(field)) anchors++;
    });
    if (veto) vetoes.push(veto);
    else if (anchors < 2) vetoes.push("too-few-label-anchors");
    else accepted.push({ stack, anchors });
  }
  if (accepted.length !== 1) return fail(accepted.length ? "multiple-blocks" : vetoes[0] ?? "block-not-found");

  const { stack, anchors } = accepted[0];
  const left = Math.min(...stack.map(r => r.main.bounds!.x));
  // Only lines starting inside the block column can widen a row; another column at the same height cannot.
  const own = (r: Row) => r.lines.filter(line => line.bounds!.x <= left + REACH);
  const right = Math.max(...stack.slice(0, requirementFields.length)
    .flatMap(r => own(r).map(line => line.bounds!.x + line.bounds!.width))) + MARGIN;
  return { status: "located", anchors, rows: requirementFields.map((field, k) => {
    const row = { lines: own(stack[k]) }, top = Math.min(...row.lines.map(l => l.bounds!.y));
    const bottom = Math.max(...row.lines.map(l => l.bounds!.y + l.bounds!.height));
    return { field, lineIds: row.lines.map(l => l.id), bounds: { x: left, y: top, width: right - left, height: bottom - top } };
  }) };
}

/** Accepts only a plain 1~3 digit integer. No O/Q/B substitution and no guessing. */
export function requirementValue(raw: string): number | null {
  const text = raw.normalize("NFKC").trim();
  return /^\d{1,3}$/.test(text) ? Number(text) : null;
}
