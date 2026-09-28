import type { StatDraft } from "./parseStatWindow";
import type { OcrBounds, OcrReading } from "./types";

export type StatNumberLabel = "STR" | "DEX" | "INT" | "LUK" | "레벨" | "공격력"
  | "총데미지" | "보스데미지" | "방어율무시" | "크리확률" | "명중률";
export type StatNumberRegion = { label: StatNumberLabel; bounds: OcrBounds };

const labelPattern = /^(STR|DEX|INT|LUK|레벨|공격력|총데미지|보스데미지|보스공격력|방어율무시|방어무시|크리티컬확률|크리확률|명중률|명중율)(?=$|[:：\d(])/i;
const compact = (text: string) => text.normalize("NFKC").replace(/\s/g, "");
function labelMatch(text: string) {
  const match = compact(text).match(labelPattern);
  if (!match) return null;
  const name = match[1].toUpperCase();
  const label = ({ 보스공격력: "보스데미지", 방어무시: "방어율무시", 크리티컬확률: "크리확률", 명중율: "명중률" } as Record<string, StatNumberLabel>)[name] ?? name as StatNumberLabel;
  return { label, length: match[0].length };
}
const validBounds = (bounds?: OcrBounds): bounds is OcrBounds => !!bounds
  && Object.values(bounds).every(Number.isFinite) && bounds.x >= 0 && bounds.y >= 0
  && bounds.width > 0 && bounds.height > 0 && bounds.x + bounds.width <= 1.01 && bounds.y + bounds.height <= 1.01;

/** Use detected labels and nearby text on the same baseline, never screen coordinates. */
export function statNumberRegions(readings: OcrReading[], aspectRatio = 1): StatNumberRegion[] {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return [];
  const positioned = readings.filter((reading): reading is OcrReading & { bounds: OcrBounds } => validBounds(reading.bounds));
  const regions: StatNumberRegion[] = [];
  for (const anchor of positioned) {
    const match = labelMatch(anchor.text);
    if (!match || regions.some(region => region.label === match.label)) continue;
    const a = anchor.bounds, group = [anchor], horizontalUnit = a.height / aspectRatio;
    if (!compact(anchor.text).slice(match.length).match(/\d/)) {
      let right = a.x + a.width;
      const neighbors = positioned.filter(item => item !== anchor && item.bounds.x >= right - horizontalUnit * .1
        && Math.abs(item.bounds.y + item.bounds.height / 2 - a.y - a.height / 2) < Math.min(a.height, item.bounds.height) * .5)
        .sort((first, second) => first.bounds.x - second.bounds.x);
      for (const item of neighbors) {
        if (labelMatch(item.text) || /[가-힣]/.test(item.text) || item.bounds.x - right > horizontalUnit * (group.length === 1 ? 5 : 2)
          || item.bounds.x + item.bounds.width - a.x > horizontalUnit * 28) break;
        group.push(item); right = item.bounds.x + item.bounds.width;
      }
    }
    const x = Math.max(0, Math.min(...group.map(item => item.bounds.x)) - horizontalUnit * .15);
    const y = Math.max(0, Math.min(...group.map(item => item.bounds.y)) - a.height * .2);
    const right = Math.min(1, Math.max(...group.map(item => item.bounds.x + item.bounds.width)) + horizontalUnit * .2);
    const bottom = Math.min(1, Math.max(...group.map(item => item.bounds.y + item.bounds.height)) + a.height * .2);
    regions.push({ label: match.label, bounds: { x, y, width: right - x, height: bottom - y } });
  }
  return regions.slice(0, 12);
}

export function sameStatNumberRow(first: StatNumberRegion, second: StatNumberRegion): boolean {
  if (first.label !== second.label) return false;
  const a = first.bounds, b = second.bounds;
  const x = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return x > Math.min(a.width, b.width) * .5 && y > Math.min(a.height, b.height) * .5;
}

export function statNumberMissing(label: StatNumberLabel, draft: StatDraft): boolean {
  if (label === "STR" || label === "DEX" || label === "INT" || label === "LUK")
    return draft.pure[label] === undefined || draft.total[label] === undefined;
  if (label === "공격력") return draft.minAttack === undefined || draft.maxAttack === undefined;
  const key = { 레벨: "level", 총데미지: "totalDamagePercent", 보스데미지: "bossDamagePercent", 방어율무시: "ignoreDefensePercent", 크리확률: "criticalRate", 명중률: "accuracy" }[label] as keyof StatDraft;
  return draft[key] === undefined;
}

/** Find the light value cell inside a detected row; preserve red digits and parentheses. */
export function statValueStart(pixels: Uint8ClampedArray, width: number, height: number): number {
  if (width < 1 || height < 1 || pixels.length !== width * height * 4) return 0;
  const light: boolean[] = [];
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      if (Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >= 160) count++;
    }
    light.push(count >= height * .3);
  }
  // Bridge narrow glyph strokes, but never a full colored label cell.
  const gapLimit = Math.max(1, Math.floor(height * .2));
  for (let x = 0; x < width;) {
    if (light[x]) { x++; continue; }
    const start = x;
    while (x < width && !light[x]) x++;
    if (start > 0 && x < width && x - start <= gapLimit) light.fill(true, start, x);
  }
  let best = { start: 0, width: 0 };
  for (let x = 0; x < width;) {
    if (!light[x]) { x++; continue; }
    const start = x;
    while (x < width && light[x]) x++;
    if (x - start >= height * .6) best = { start, width: x - start };
  }
  return best.width ? Math.max(0, best.start - 2) : 0;
}

/** Attach only the detected field name. Never invent digits, signs or a missing %. */
export function statNumberText(label: StatNumberLabel, text: string): string | null {
  let value = compact(text).replace(/,/g, "");
  const match = labelMatch(value);
  if (match) {
    if (match.label !== label) return null;
    value = value.slice(match.length).replace(/^[:：]/, "");
  }
  if (!value || !/^[\d().+%~～〜–-]+$/.test(value)) return null;
  return `${label} ${value}`;
}

export function statNumberRows(readings: OcrReading[], regions: StatNumberRegion[]): string[] {
  const lines: string[] = [];
  for (const region of regions) {
    const box = region.bounds;
    const items = readings.filter(item => validBounds(item.bounds) && item.bounds.y >= box.y - box.height * .1
      && item.bounds.y + item.bounds.height <= box.y + box.height * 1.1)
      .sort((a, b) => a.bounds!.x - b.bounds!.x);
    const line = statNumberText(region.label, items.map(item => item.text).join(" "));
    if (line) lines.push(line);
  }
  return lines;
}
