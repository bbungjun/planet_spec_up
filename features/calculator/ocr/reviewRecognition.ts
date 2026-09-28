import { JOB_RULES } from "../domain/job-rules";
import type { JobId } from "../domain/types";
import { isKnownEquipmentCategory, parseEquipmentCategory, parseTooltipOption, readCombatOptionLabel, readTooltipRequirement } from "./parseMapleTooltip";
import type { OcrBounds, OcrReading, OcrReview, OcrReviewLine, StatReplacement, TooltipOption } from "./types";

const combatLabels = new Set(["STR", "DEX", "INT", "LUK", "올스탯", "공격력", "총데미지", "보스데미지", "방어율무시"]);
const requirementLabel = (text: string): string | null => readTooltipRequirement(text)?.label ?? null;
const referenceLabel = /(?:HP|MP|마력|마법\s*공격력|방[어머미]력|방무력|명중|회피|이동|점프|피격|흑수정|업그레이드|가능\s*횟수)/i;
export function canConfirmReviewText(text: string): boolean {
  const option = parseTooltipOption(text);
  if (!option || !(option.requirement || combatLabels.has(option.label) || referenceLabel.test(option.label))) return false;
  // User-facing edits contain literal numbers. OCR lookalike repair belongs to
  // recognition; its raw letters must not become selectable numeric values.
  if (option.requirement) return /^\d+$/.test(readTooltipRequirement(text)?.valueText ?? "");
  return /(?:[:;]\s*\+?|\+)\s*\d+(?:\.\d+)?\s*%?\s*[;,.]?\s*$/.test(text.normalize("NFKC"));
}

export function normalizedReviewOption(text: string): string | null {
  const option = parseTooltipOption(text);
  if (!option || !(option.requirement || combatLabels.has(option.label) || referenceLabel.test(option.label))) return null;
  return option.requirement ? `REQ ${option.label} : ${option.value}` : `${option.label} +${option.value}${option.percent ? "%" : ""}`;
}

export function reviewInputText(line: OcrReviewLine): string {
  const normalized = normalizedReviewOption(line.text);
  if (normalized) return normalized;
  const requirement = readTooltipRequirement(line.text);
  if (requirement) return `REQ ${requirement.label} : `;
  const label = readCombatOptionLabel(line.text);
  return label ? `${label} : ` : line.text;
}

/** Suggestions are display-only. Even a unique label match needs the user's
 * explicit confirmation. Only the shared numeric normalization is used. */
export function suggestReviewOptions(line: OcrReviewLine): string[] {
  const suggestions = new Set<string>();
  for (const reading of line.readings) {
    const option = parseTooltipOption(reading.text);
    if (!option) continue;
    if (option.requirement) {
      suggestions.add(`REQ ${option.label} : ${option.value}`);
      continue;
    }
    if (combatLabels.has(option.label)) {
      suggestions.add(`${option.label} +${option.value}${option.percent ? "%" : ""}`);
      continue;
    }
    if (referenceLabel.test(option.label)) continue;
    const label = option.label.replace(/\s/g, "");
    const candidates = [...combatLabels].filter(known => known.length === label.length
      && [...known].filter((character, index) => character !== label[index]).length === 1);
    if (candidates.length === 1) suggestions.add(`${candidates[0]} +${option.value}${option.percent ? "%" : ""}`);
  }
  return [...suggestions].slice(0, 4);
}
const signature = (option: TooltipOption) => JSON.stringify([option.label, option.value, option.percent, option.requirement]);
const center = (bounds: OcrBounds) => bounds.y + bounds.height / 2;
const union = (a: OcrBounds, b: OcrBounds): OcrBounds => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
  width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x), height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y) });

/** Join only adjacent label/value fragments with supporting image coordinates. */
export function joinSpatialReadings(readings: OcrReading[]): OcrReading[] {
  const consumed = new Set<OcrReading>();
  const prefixed = readings.map(prefix => {
    const token = prefix.text.trim().match(/^(REQ|REG|RER|REIQ|RE[@®])[\s!:;.]*$/i)?.[1];
    if (!token || !prefix.bounds) return prefix;
    const candidate = readings.find(other => {
      if (other === prefix || consumed.has(other) || other.pass !== prefix.pass || !other.bounds) return false;
      const label = other.text.trim().replace(/^[\s!:;.]+/, "");
      return !!readTooltipRequirement(`${token} ${label}`)
        && Math.abs(center(prefix.bounds!) - center(other.bounds)) < Math.max(prefix.bounds!.height, other.bounds.height) * .45
        && other.bounds.x >= prefix.bounds!.x + prefix.bounds!.width * .5
        && other.bounds.x - (prefix.bounds!.x + prefix.bounds!.width) <= prefix.bounds!.width * .8;
    });
    if (!candidate) return prefix;
    consumed.add(candidate);
    return { ...prefix, text: `${token} ${candidate.text.trim().replace(/^[\s!:;.]+/, "")}`,
      bounds: union(prefix.bounds, candidate.bounds!), confidence: Math.min(prefix.confidence ?? 0, candidate.confidence ?? 0) };
  }).filter((_reading, index) => !consumed.has(readings[index]));
  const ordered = prefixed.sort((a, b) => a.pass - b.pass || (a.bounds?.y ?? 0) - (b.bounds?.y ?? 0) || (a.bounds?.x ?? 0) - (b.bounds?.x ?? 0));
  const joined: OcrReading[] = [];
  for (let i = 0; i < ordered.length; i++) {
    let current = ordered[i];
    const next = ordered[i + 1];
    const label = current.text.trim().replace(/^[\s._·ㆍ•|]+/, "");
    const splitValue = (/^(?:STR|DEX|INT|LUK|올스탯|공격력)\s*[:;]?$/i.test(label) || readTooltipRequirement(label)?.valueText === "")
      && /^\+?\s*\d+(?:\.\d+)?\s*%?\s*[;,.]?\s*$/.test(next?.text.trim() ?? "");
    const splitCategory = /^[장잠창참]비\s*분?$/.test(label) && /^류\s*[:;：]/.test(next?.text.trim() ?? "");
    if ((splitValue || splitCategory) && next?.pass === current.pass && current.bounds && next.bounds
      && next.bounds.y - (current.bounds.y + current.bounds.height) <= Math.max(current.bounds.height, next.bounds.height) * 1.2
      && next.bounds.x < current.bounds.x + current.bounds.width + .25) {
      current = { ...current, text: `${current.text.trim()} ${next.text.trim()}`, bounds: union(current.bounds, next.bounds),
        confidence: Math.min(current.confidence ?? 0, next.confidence ?? 0) };
      i++;
    }
    joined.push(current);
  }
  return joined;
}

export function buildOcrReview(input: OcrReading[], warnings: string[] = []): OcrReview {
  const readings = joinSpatialReadings(input);
  const groups: OcrReading[][] = [];
  for (const reading of readings) {
    if (!reading.text.trim()) continue;
    const group = reading.bounds && groups.find(group => {
      const anchor = group[0];
      return anchor.bounds && !group.some(item => item.pass === reading.pass)
        && Math.min(anchor.bounds.x + anchor.bounds.width, reading.bounds!.x + reading.bounds!.width) - Math.max(anchor.bounds.x, reading.bounds!.x)
          > Math.min(anchor.bounds.width, reading.bounds!.width) * .25
        && Math.abs(center(anchor.bounds) - center(reading.bounds!)) < Math.max(anchor.bounds.height, reading.bounds!.height) * .65;
    });
    if (group) group.push(reading); else groups.push([reading]);
  }
  const categories = readings.map(reading => ({ reading, value: parseEquipmentCategory(reading.text) })).filter(item => item.value && isKnownEquipmentCategory(item.value));
  const category = categories[0]?.value ?? null;
  const categoryY = Math.min(...categories.map(item => item.reading.bounds?.y ?? 1));
  const optionY = Math.min(...readings.filter(reading => {
    const option = parseTooltipOption(reading.text);
    return option && !option.requirement && combatLabels.has(option.label);
  }).map(reading => reading.bounds?.y ?? 1));
  const bodyY = Number.isFinite(categoryY) ? Math.min(categoryY, optionY) : 0;
  const lines: OcrReviewLine[] = groups.map((group, index) => {
    const parsed = group.map(reading => ({ reading, option: parseTooltipOption(reading.text) }));
    const valid = parsed.filter((item): item is typeof item & { option: TooltipOption } => item.option !== null);
    const ordered = [...valid].sort((a, b) => {
      const votes = (item: typeof a) => valid.filter(other => signature(other.option) === signature(item.option)).length;
      return votes(b) - votes(a) || (b.reading.confidence ?? 0) - (a.reading.confidence ?? 0);
    });
    const best = ordered[0];
    const combat = valid.some(item => item.option.requirement || combatLabels.has(item.option.label));
    const keys = new Set(valid.filter(item => item.option.requirement || combatLabels.has(item.option.label)).map(item => signature(item.option)));
    const agreement = best ? new Set(valid.filter(item => signature(item.option) === signature(best.option)).map(item => item.reading.pass)).size : 0;
    const bounds = group.reduce<OcrBounds | undefined>((bounds, item) => item.bounds ? bounds ? union(bounds, item.bounds) : item.bounds : bounds, undefined);
    const text = best?.reading.text.trim() ?? group.reduce((a, b) => (a.confidence ?? 0) >= (b.confidence ?? 0) ? a : b).text.trim();
    const inBody = bounds ? bounds.y >= bodyY - .02 : true;
    const unknown = inBody && !valid.some(item => referenceLabel.test(item.option.label))
      && !group.some(item => parseEquipmentCategory(item.text) || referenceLabel.test(item.text))
      && group.some(item => /[+%]\s*\d|\d\s*%|(?:STR|DEX|INT|LUK)\s*[:;+]/i.test(item.text));
    let reason: string | undefined;
    if (!valid.length && group.some(item => requirementLabel(item.text))) reason = "요구 조건의 숫자를 읽지 못했어요. 원본과 대조해주세요.";
    else if (best && combat && !best.option.requirement && bounds && Number.isFinite(categoryY) && center(bounds) < categoryY - .01) reason = "요구 조건과 장비 옵션을 구분하지 못했어요. 원본의 항목명을 확인해주세요.";
    else if (combat && keys.size > 1) reason = "같은 줄의 숫자·옵션 종류가 다르게 읽혔어요. 원본과 대조해주세요.";
    else if (best && !best.option.requirement && !best.option.percent && ["STR", "DEX", "INT", "LUK", "올스탯"].includes(best.option.label) && best.option.value >= 100) reason = "큰 고정 스탯으로 읽혔어요. % 표시가 빠지지 않았는지 확인해주세요.";
    else if (combat && agreement < 2) reason = "한 번만 읽힌 옵션이에요. 숫자와 %를 확인해주세요.";
    else if (!combat && inBody && group.some(item => readCombatOptionLabel(item.text))) reason = "옵션의 숫자를 읽지 못했어요. 원본과 대조해주세요.";
    else if (!combat && unknown && (!best || !referenceLabel.test(best.option.label))) reason = "옵션 이름이나 숫자를 정확히 읽지 못했어요.";
    return { id: `line-${index}`, bounds, readings: group, text, status: reason ? "check" : "recognized", reason };
  });
  lines.sort((a, b) => (a.bounds?.y ?? 0) - (b.bounds?.y ?? 0));
  const categoryConflict = new Set(categories.map(item => item.value)).size > 1;
  return { category: categoryConflict ? null : category, lines, warnings: [...warnings, ...(categoryConflict ? ["장비 부위가 서로 다르게 읽혔어요. 적용 위치를 선택해주세요."] : [])] };
}

export function reviewText(review: OcrReview): string {
  return [...(review.header ? [review.header.name, review.header.marker] : []),
    ...review.lines.filter(line => line.status !== "ignored").map(line => line.text), ...(review.category ? [`장비분류: ${review.category}`] : [])].join("\n");
}

/** Only observed or explicitly confirmed keys replace existing gear. */
export function mapReviewedStats(review: OcrReview, job: JobId): StatReplacement {
  const replacement: StatReplacement = {};
  const { mainStat, subStat } = JOB_RULES[job];
  for (const line of review.lines) {
    if (line.status === "check" || line.status === "ignored") continue;
    const option = parseTooltipOption(line.text);
    if (!option) continue;
    const fields: Array<keyof StatReplacement> = [];
    if (option.requirement) { if (option.label === subStat) fields.push("requiredSub"); else if (/^(LEV|LEVEL)$/.test(option.label)) fields.push("requiredLevel"); }
    else if (option.label === "올스탯") fields.push(option.percent ? "mainPercent" : "mainFlat", option.percent ? "subPercent" : "subFlat");
    else if (option.label === mainStat) fields.push(option.percent ? "mainPercent" : "mainFlat");
    else if (option.label === subStat) fields.push(option.percent ? "subPercent" : "subFlat");
    else if (option.label === "공격력") fields.push(option.percent ? "attackPercent" : "attackFlat");
    else if (option.percent && option.label === "총데미지") fields.push("totalDamagePercent");
    else if (option.percent && option.label === "보스데미지") fields.push("bossDamagePercent");
    else if (option.percent && option.label === "방어율무시") fields.push("ignoreDefensePercent");
    for (const field of fields) replacement[field] = String(option.requirement ? option.value : Number(replacement[field] ?? 0) + option.value);
  }
  return replacement;
}

export function resolveReviewLine(review: OcrReview, id: string, text: string | null): OcrReview {
  return { ...review, lines: review.lines.map(line => line.id !== id ? line : text === null ? { ...line, status: "ignored" }
    : { ...line, text, status: canConfirmReviewText(text) ? "confirmed" : "check", reason: canConfirmReviewText(text) ? undefined : "DEX +6%처럼 옵션 이름과 숫자를 입력해주세요." }) };
}

export function editedTextReview(text: string): OcrReview {
  const review = buildOcrReview(text.split(/\r?\n/).map(text => ({ text, pass: 0 })));
  return { ...review, lines: review.lines.map(line => canConfirmReviewText(line.text) ? { ...line, status: "confirmed" } : line) };
}

export function reviewQuestions(review: OcrReview, job: JobId): OcrReviewLine[] {
  return review.lines.filter(line => {
    if (line.status !== "check") return false;
    const options = line.readings.map(reading => parseTooltipOption(reading.text)).filter(option => option !== null);
    if (!options.length) {
      const labels = line.readings.map(reading => requirementLabel(reading.text)).filter(label => label !== null);
      if (labels.length) return labels.some(label => label === "LEV" || label === JOB_RULES[job].subStat);
      return true;
    }
    if (options.some(option => !combatLabels.has(option.label) && !referenceLabel.test(option.label))) return true;
    return options.some(option => Object.keys(mapReviewedStats({ category: null, warnings: [], lines: [{ ...line, text: option.raw, status: "confirmed" }] }, job)).length > 0);
  });
}

export function reviewBlocked(review: OcrReview, job: JobId): boolean {
  return reviewQuestions(review, job).length > 0 || (review.warnings.length > 0 && !review.imageConfirmed);
}

type EngineLine = { text: string; confidence?: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
export type EnginePage = { text: string; blocks?: Array<{ paragraphs: Array<{ lines: EngineLine[] }> }> | null };
export function pageReadings(data: EnginePage, width: number, height: number, pass: number): OcrReading[] {
  return data.blocks?.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.map(line => ({
    text: line.text, confidence: line.confidence, pass,
    bounds: { x: line.bbox.x0 / width, y: line.bbox.y0 / height, width: (line.bbox.x1 - line.bbox.x0) / width, height: (line.bbox.y1 - line.bbox.y0) / height },
  })))) ?? data.text.split(/\r?\n/).filter(Boolean).map(text => ({ text, pass }));
}
