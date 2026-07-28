import {
  OCR_STAT_NAMES,
  type OcrStatName,
  type ParsedTooltipStats,
} from "./types";

function createTotals() {
  return { flat: 0, percent: 0 };
}

function normalizeLine(line: string): string {
  return line
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLabel(label: string): string {
  return label.replace(/[^\p{L}\p{N}]/gu, "");
}

export function parseMapleTooltip(text: string): ParsedTooltipStats {
  const stats = Object.fromEntries(
    OCR_STAT_NAMES.map((name) => [name, createTotals()]),
  ) as Record<OcrStatName, { flat: number; percent: number }>;
  const allStat = createTotals();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = normalizeLine(rawLine);
    const match = line.match(/^(.+?)\s*:?\s*\+\s*(\d+(?:\.\d+)?)\s*(%)?$/);
    if (match === null) continue;

    const label = normalizeLabel(match[1]);
    const value = Number(match[2]);
    if (!Number.isFinite(value)) continue;
    const totals = label === "ALLSTAT" || label === "올스탯"
      ? allStat
      : stats[label as OcrStatName];
    if (totals === undefined) continue;

    if (match[3] === "%") totals.percent += value;
    else totals.flat += value;
  }

  return { stats, allStat };
}
