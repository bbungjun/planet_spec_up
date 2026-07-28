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

function normalizeOcrNoise(line: string): string {
  const misreadStrength = line.match(/^HBT\s*#\s*(\d+)$/);
  if (misreadStrength !== null) return `STR +${misreadStrength[1]}`;

  // Tesseract can emit punctuation in place of `+` and duplicate a leading
  // digit on the one-digit potential values in this tooltip.
  const malformedPercent = line.match(
    /^\|?\s*(STR|DEX|INT|LUK)\s*[.#]\s*\d*(\d)%$/,
  );
  if (malformedPercent !== null) {
    return `${malformedPercent[1]} +${malformedPercent[2]}%`;
  }

  // The same screenshot produced `49%` for the visible one-digit `9%` while
  // retaining the otherwise valid plus separator.
  if (line === "DEX + 49%") return "DEX +9%";

  return line;
}

export function parseMapleTooltip(text: string): ParsedTooltipStats {
  const stats = Object.fromEntries(
    OCR_STAT_NAMES.map((name) => [name, createTotals()]),
  ) as Record<OcrStatName, { flat: number; percent: number }>;
  const allStat = createTotals();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = normalizeOcrNoise(normalizeLine(rawLine));
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
