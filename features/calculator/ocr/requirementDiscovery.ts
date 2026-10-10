import { isKnownEquipmentCategory, parseEquipmentCategory, parseTooltipOption, readTooltipRequirement } from "./parseMapleTooltip";
import type { OcrBounds, OcrReviewLine, SuspectedRequirementLabel } from "./types";

const labels: SuspectedRequirementLabel[] = ["LEV", "STR", "DEX", "INT", "LUK"];
const validBounds = (b: OcrBounds) => Object.values(b).every(Number.isFinite) && b.x >= 0 && b.y >= 0
  && b.width > 0 && b.height > 0 && b.x + b.width <= 1.000001 && b.y + b.height <= 1.000001;
const center = (b: OcrBounds) => b.y + b.height / 2;

function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) return [...a].filter((c, i) => c !== b[i]).length <= 1;
  const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
  return [...longer].some((_, i) => longer.slice(0, i) + longer.slice(i + 1) === shorter);
}

/** Discovery hints only. Never returns an option or manufactures a numeric value. */
function candidate(text: string): { labels: SuspectedRequirementLabel[]; valueText: string } | null {
  const strict = readTooltipRequirement(text);
  if (strict && labels.includes(strict.label as SuspectedRequirementLabel)) {
    return { labels: [strict.label as SuspectedRequirementLabel], valueText: strict.valueText };
  }
  const match = text.normalize("NFKC").trim().toUpperCase()
    .match(/^([A-Z!@®1]{2,5})\s+([A-Z!1]{2,5})(?=\s|[:;]|\d|$)[\s:;]*(.*?)\s*$/);
  if (!match || (!oneEdit(match[1], "REQ") && !/^F[I1]EQ$/.test(match[1]))) return null;
  const possible = labels.filter(label => oneEdit(match[2], label));
  return possible.length ? { labels: possible, valueText: match[3] } : null;
}

/** Requires a source row above the equipment body, or a nearby known requirement column. */
export function discoverRequirementRows(lines: OcrReviewLine[]): OcrReviewLine[] {
  const categoryTop = Math.min(...lines.flatMap(line => line.bounds && line.readings.some(r => {
    const category = parseEquipmentCategory(r.text);
    return category && isKnownEquipmentCategory(category);
  }) ? [line.bounds.y] : []));
  return lines.map(line => {
    if (!line.bounds || !validBounds(line.bounds) || line.status === "confirmed" || line.status === "ignored") return line;
    // A known requirement already has the existing review/retry path. Preserve
    // that policy and any completed legacy recovery; discover only lost rows.
    if (line.readings.some(r => readTooltipRequirement(r.text))) return line;
    const observations = line.readings.map(r => candidate(r.text));
    if (!observations.some(Boolean) || !line.readings.some((r, i) => observations[i] && !readTooltipRequirement(r.text))) return line;
    const aboveBody = line.bounds.y + line.bounds.height <= categoryTop;
    const neighbor = lines.some(other => other !== line && other.bounds && validBounds(other.bounds)
      && other.readings.some(r => readTooltipRequirement(r.text))
      && Math.abs(other.bounds.x - line.bounds!.x) < Math.max(other.bounds.width, line.bounds!.width) * .25
      && Math.abs(center(other.bounds) - center(line.bounds!)) <= Math.max(other.bounds.height, line.bounds!.height) * 8);
    if (!aboveBody || (!Number.isFinite(categoryTop) && !neighbor)) return line;
    const possible = [...new Set(observations.flatMap(o => o?.labels ?? []))];
    return { ...line, suspectedRequirement: { labels: possible }, status: "check",
      reason: "요구 조건의 항목명이나 숫자를 읽지 못했어요. 원본과 대조해주세요." };
  });
}

/** A name hint is not permission to replace missing, malformed or conflicting original digits. */
export function suspectedRequirementRetryIssue(line: OcrReviewLine): string | null {
  const possible = line.suspectedRequirement?.labels;
  if (!possible || possible.length !== 1) return "요구 조건의 항목을 하나로 확인하지 못했어요.";
  const field = possible[0];
  const values: number[] = [];
  const agreeingPasses = new Set<number>();
  for (const reading of line.readings) {
    const hint = candidate(reading.text);
    if (!hint || !hint.labels.includes(field)) return "요구 조건의 서로 다른 항목이나 불완전한 판독이 남아 있어요.";
    // Literal digits are mandatory on this newly discovered path. In particular,
    // Q/O/B or a partial number cannot become numeric agreement via a label hint.
    if (!/^\d+$/.test(hint.valueText) || !Number.isSafeInteger(Number(hint.valueText))) {
      return "원래 요구 조건의 숫자를 온전히 확인하지 못했어요.";
    }
    values.push(Number(hint.valueText));
    const option = parseTooltipOption(reading.text);
    if (option?.requirement && option.label === field) agreeingPasses.add(reading.pass);
  }
  if (new Set(values).size !== 1) return "같은 요구 조건의 숫자가 다르게 읽혔어요. 원본과 대조해주세요.";
  return agreeingPasses.size >= 2 ? null : "요구 조건의 이름과 숫자를 두 판독에서 확인하지 못했어요.";
}
