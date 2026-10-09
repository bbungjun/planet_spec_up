/**
 * 서로 다른 판독의 같은 줄을 대조해 검토 상태와 직업별 적용값을 만드는 공통 경계.
 * 화면 안내·차단·텍스트·값 매핑이 같은 검토 객체를 사용하며, 숫자 충돌과 원시 판독 증거를 보존한다.
 */
import { JOB_RULES } from "../domain/job-rules";
import type { JobId } from "../domain/types";
import { isKnownEquipmentCategory, parseEquipmentCategory, parseTooltipOption, readCombatOptionLabel, readTooltipRequirement } from "./parseMapleTooltip";
import type { LocatedRequirement, OcrBounds, OcrReading, OcrReview, OcrReviewLine, RequirementObservation, StatReplacement, TooltipOption } from "./types";
import { verifyRequirementRecovery } from "./verifyRequirementRecovery";

const combatLabels = new Set(["STR", "DEX", "INT", "LUK", "올스탯", "공격력", "총데미지", "보스데미지", "방어율무시", "크리티컬확률"]);
const requirementLabel = (text: string): string | null => readTooltipRequirement(text)?.label ?? null;
const referenceLabel = /(?:HP|MP|마력|마법\s*공격력|방[어머미]력|방무력|명중|회피|이동|점프|피격|흑수정|업그레이드|가능\s*횟수)/i;
/**
 * 사용자가 확인할 수 있는 항목과 실제 숫자 표기인지 검사한다.
 * 수동 확인 입력에 남은 OCR 유사 문자 O/B 등을 숫자로 간주해 통과시키지 않는다.
 */
export function canConfirmReviewText(text: string): boolean {
  const option = parseTooltipOption(text);
  if (!option || !(option.requirement || combatLabels.has(option.label) || referenceLabel.test(option.label))) return false;
  if (option.label === "크리티컬확률" && option.value > 100) return false;
  // User-facing edits contain literal numbers. OCR lookalike repair belongs to
  // recognition; its raw letters must not become selectable numeric values.
  if (option.requirement) return /^\d+$/.test(readTooltipRequirement(text)?.valueText ?? "");
  return /(?:[:;]\s*\+?|\+)\s*\d+(?:\.\d+)?\s*%?\s*[;,.]?\s*$/.test(text.normalize("NFKC"));
}

/**
 * 해석 가능한 옵션을 표시용 숫자 표기로 정리한다. 이는 검토 상태의 자동 확정이 아니다.
 */
export function normalizedReviewOption(text: string): string | null {
  const option = parseTooltipOption(text);
  if (!option || !(option.requirement || combatLabels.has(option.label) || referenceLabel.test(option.label))) return null;
  return option.requirement ? `REQ ${option.label} : ${option.value}` : `${option.label} +${option.value}${option.percent ? "%" : ""}`;
}

/**
 * 줄 편집기에 해석된 숫자 또는 식별한 항목명과 빈 값의 초안을 제공한다.
 */
export function reviewInputText(line: OcrReviewLine): string {
  const normalized = normalizedReviewOption(line.text);
  if (normalized) return normalized;
  const requirement = readTooltipRequirement(line.text);
  if (requirement) return `REQ ${requirement.label} : `;
  const label = readCombatOptionLabel(line.text);
  return label ? `${label} : ` : line.text;
}

/**
 * 판독 증거에서 표시용 옵션 후보를 최대 4개 제안한다.
 * 유일한 글자 유사도 후보도 사용자 확인이 필요한 제안이며 숫자나 장비에 자동 적용하지 않는다.
 */
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

/**
 * 같은 판독 회차에서 위치가 뒷받침하는 요구 조건 접두사·항목명·숫자 조각을 연결한다.
 * 다른 회차나 멀리 떨어진 줄을 문자열 순서만으로 합치지 않는다.
 */
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

/**
 * 크기가 다른 판독을 정규화된 줄 위치로 묶어 중복 잠재 줄의 이중 합산을 막는다.
 * 같은 옵션의 회차 간 일치, 숫자/% 충돌, 요구 조건과 본문 구분, 큰 고정 스탯 등을 검사해 recognized/check 상태와 이유를 반환한다.
 */
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
    else if (best?.option.label === "크리티컬확률" && best.option.value > 100) reason = "크리티컬 확률은 0~100% 범위로 확인해주세요.";
    else if (combat && agreement < 2) reason = "한 번만 읽힌 옵션이에요. 숫자와 %를 확인해주세요.";
    else if (!combat && inBody && group.some(item => readCombatOptionLabel(item.text))) reason = "옵션의 숫자를 읽지 못했어요. 원본과 대조해주세요.";
    else if (!combat && unknown && (!best || !referenceLabel.test(best.option.label))) reason = "옵션 이름이나 숫자를 정확히 읽지 못했어요.";
    return { id: `line-${index}`, bounds, readings: group, text, status: reason ? "check" : "recognized", reason };
  });
  lines.sort((a, b) => (a.bounds?.y ?? 0) - (b.bounds?.y ?? 0));
  const categoryConflict = new Set(categories.map(item => item.value)).size > 1;
  return { category: categoryConflict ? null : category, lines,
    ...(input.some(reading => reading.provenance?.role === "discovery") ? { initialReadings: input } : {}),
    warnings: [...warnings, ...(categoryConflict ? ["장비 부위가 서로 다르게 읽혔어요. 적용 위치를 선택해주세요."] : [])] };
}

/**
 * 무시하지 않은 줄·확정 헤더·장비 분류를 내부 파싱용 텍스트로 조합한다.
 * 확인 필요 줄도 포함하므로 이 문자열을 파싱했다고 그 수치가 적용 가능한 것은 아니다.
 */
export function reviewText(review: OcrReview): string {
  return [...(review.header ? [review.header.name, review.header.marker] : []),
    ...review.lines.filter(line => line.status !== "ignored").map(line => line.text), ...(review.category ? [`장비분류: ${review.category}`] : [])].join("\n");
}

/**
 * 확인 필요/제외 줄을 빼고 인식 또는 사용자 확인된 줄만 직업별 교체 필드로 매핑한다.
 * 올스탯은 주·부스탯에 함께 반영하고 요구 조건은 장비 보너스와 분리한다. 없는 키를 임의의 0으로 만들지 않는다.
 */
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
    else if (option.percent && option.label === "크리티컬확률") fields.push("criticalRate");
    for (const field of fields) replacement[field] = String(option.requirement ? option.value : Number(replacement[field] ?? 0) + option.value);
  }
  return replacement;
}

/**
 * 한 줄을 사용자가 숫자로 확인하거나 명시적으로 제외한 새 검토 객체를 만든다.
 * 수동 변경이므로 해당 줄의 이전 자동 복구 증명은 제거하고 다른 줄은 보존한다.
 */
export function resolveReviewLine(review: OcrReview, id: string, text: string | null): OcrReview {
  return { ...review, lines: review.lines.map(line => line.id !== id ? line : text === null ? { ...line, status: "ignored", recovery: undefined, equipmentRecovery: undefined }
    : { ...line, text, recovery: undefined, equipmentRecovery: undefined, status: canConfirmReviewText(text) ? "confirmed" : "check", reason: canConfirmReviewText(text) ? undefined : "DEX +6%처럼 옵션 이름과 숫자를 입력해주세요." }) };
}

/**
 * 요구 레벨/부스탯 숫자 필드의 수동 편집도 실험 검증 증거보다 우선하는 명시적 변경으로 처리한다.
 * 검증 출처가 있는 해당 줄만 확인/제외하며 다른 요구 조건과 옵션은 유지한다.
 */
export function overrideReviewRequirement(review: OcrReview | null, job: JobId, field: keyof StatReplacement, value: string): OcrReview | null {
  if (!review) return review;
  if (field !== "requiredLevel" && field !== "requiredSub") {
    // An edited aggregate may include several recovered rows (all-stat also
    // contributes to two fields). Keep their original text, but invalidate the
    // automatic proof for every contributing row instead of inventing a split.
    let changed = false;
    const lines = review.lines.map(line => {
      if (!line.equipmentRecovery || mapReviewedStats({ ...review, lines: [line] }, job)[field] === undefined) return line;
      changed = true;
      return { ...line, equipmentRecovery: undefined };
    });
    return changed ? { ...review, lines } : review;
  }
  const label = field === "requiredLevel" ? "LEV" : JOB_RULES[job].subStat;
  let next = review;
  for (const line of review.lines) if ((line.recovery || line.equipmentRecovery || line.readings.some(reading => reading.provenance?.role === "verification"))
    && (line.recovery || line.equipmentRecovery?.kind === "requirement" || readTooltipRequirement(line.text))
    && (line.recovery?.target.field ?? line.equipmentRecovery?.option?.label ?? line.equipmentRecovery?.fieldHint ?? readTooltipRequirement(line.text)?.label) === label) {
    next = resolveReviewLine(next, line.id, value.trim() ? `REQ ${label} : ${value}` : null);
  }
  return next;
}

/**
 * 출처·행 좌표가 그대로인 실험 대상에 원본 검증 결과를 적용한다.
 * 사용자 확인/제외는 덮어쓰지 않고 기존 판독도 남긴다. 검증 실패는 확인 필요로 유지하며 기본 판독기 활성화 승인을 뜻하지 않는다.
 */
export function applyRequirementRecovery(review: OcrReview, target: LocatedRequirement, observations: RequirementObservation[]): OcrReview {
  const line = review.lines.find(line => line.id === target.lineId);
  if (!line || line.status === "confirmed" || line.status === "ignored" || !line.readings.length
    || target.rowId !== line.id || !line.bounds
    || (Object.keys(line.bounds) as Array<keyof OcrBounds>).some(key => Math.abs(line.bounds![key] - target.rowBounds[key]) > 1e-8)
    || line.readings.some(reading => !reading.provenance || reading.provenance.role !== "discovery"
      || reading.provenance.sourceId !== target.sourceId || reading.provenance.operationId !== target.operationId)) return review;
  const identifiedLabels = new Set(line.readings.map(reading => readTooltipRequirement(reading.text)?.label).filter(label => label !== undefined));
  if (identifiedLabels.size !== 1 || !identifiedLabels.has(target.field)) return review;
  const recovery = verifyRequirementRecovery(target, observations);
  if (recovery.status === "verified") {
    recovery.supersededReadingIds = line.readings.filter(reading => {
      const option = parseTooltipOption(reading.text);
      return !option?.requirement || option.label !== target.field || option.value !== recovery.value;
    }).map(reading => reading.provenance!.readingId);
    if (recovery.supersededReadingIds.length) recovery.reason = "initial-reading-superseded";
  }
  const updated: OcrReviewLine = { ...line, recovery, readings: [...line.readings, ...observations.flatMap(observation => observation.readings)],
    text: recovery.status === "verified" ? `REQ ${target.field} : ${recovery.value}` : line.text,
    status: recovery.status === "verified" ? "recognized" : "check",
    reason: recovery.status === "verified" ? undefined : "원본 영역의 요구 조건을 일치하게 확인하지 못했어요. 원본과 대조해주세요." };
  return { ...review, lines: review.lines.map(item => item.id === line.id ? updated : item) };
}

/**
 * 수동으로 편집한 내부 텍스트를 검토 객체로 만들고 유효한 숫자 옵션 줄만 확인 상태로 표시한다.
 */
export function editedTextReview(text: string): OcrReview {
  const review = buildOcrReview(text.split(/\r?\n/).map(text => ({ text, pass: 0 })));
  return { ...review, lines: review.lines.map(line => canConfirmReviewText(line.text) ? { ...line, status: "confirmed" } : line) };
}

/**
 * 확인 필요 줄 중 현재 직업의 입력에 영향을 주는 항목과 미식별 옵션을 추린다.
 * 다른 직업의 부스탯 요구치나 참고 전용 수치는 현재 직업 비교를 불필요하게 막지 않는다.
 */
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

/**
 * 직업별 미해결 질문 또는 아직 원본 확인되지 않은 이미지 경고가 있으면 적용을 보류한다.
 */
export function reviewBlocked(review: OcrReview, job: JobId): boolean {
  return reviewQuestions(review, job).length > 0 || (review.warnings.length > 0 && !review.imageConfirmed);
}

type EngineLine = { text: string; confidence?: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
export type EnginePage = { text: string; blocks?: Array<{ paragraphs: Array<{ lines: EngineLine[] }> }> | null };
/**
 * Tesseract의 블록/줄 좌표를 공통 정규화 판독으로 변환한다.
 * 블록 정보가 없으면 텍스트 줄만 반환하므로 호출자가 위치 증거 부족을 별도 경고해야 한다.
 */
export function pageReadings(data: EnginePage, width: number, height: number, pass: number): OcrReading[] {
  return data.blocks?.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.map(line => ({
    text: line.text, confidence: line.confidence, pass,
    bounds: { x: line.bbox.x0 / width, y: line.bbox.y0 / height, width: (line.bbox.x1 - line.bbox.x0) / width, height: (line.bbox.y1 - line.bbox.y0) / height },
  })))) ?? data.text.split(/\r?\n/).filter(Boolean).map(text => ({ text, pass }));
}
