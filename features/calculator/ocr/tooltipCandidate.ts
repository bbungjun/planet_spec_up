/**
 * 픽셀 탐지 후보가 하나의 온전한 장비 설명창을 담는지 검사한다.
 * 수치를 보정하거나 확정하지 않고, 선택한 영역은 기존 두 크기 판독·검토 경로로 보낸다.
 */
import { isKnownEquipmentCategory, parseEquipmentCategory, parseTooltipOption, readCombatOptionLabel, readTooltipRequirement } from "./parseMapleTooltip";
import type { OcrBounds, OcrReading, TooltipOption } from "./types";

type Row = { text: string; bounds: OcrBounds };
export type TooltipCandidateAssessment = {
  status: "complete" | "retry-color" | "rejected";
  reasons: string[];
  title?: Row;
  body: Array<Row & { option: TooltipOption }>;
};
export type AssessedTooltipCandidate = { region: OcrBounds; assessment: TooltipCandidateAssessment };

const centerY = (box: OcrBounds) => box.y + box.height / 2;
const validBounds = (box?: OcrBounds): box is OcrBounds => !!box && Object.values(box).every(Number.isFinite)
  && box.width > 0 && box.height > 0;
const windowHeading = /(?:\bINVENTORY\b|\bMINI\s*MAP\b|\bCHARACTER\s*(?:STAT|INFO)\b)/i;
const propertyMarker = /(?:고유\s*아이템|교환\s*불가|판매\s*불가|잠재\s*능력|(?:레어|에픽|유니크|레전드리|일반).*아이템)/;

/** 같은 회차의 물리적인 행만 묶는다. 이 텍스트는 후보 검사 전용이며 옵션 적용에 쓰지 않는다. */
function rows(readings: OcrReading[]): Row[] {
  const groups: OcrReading[][] = [];
  for (const reading of readings.filter(reading => reading.text.trim() && validBounds(reading.bounds)).sort((a, b) => a.bounds!.y - b.bounds!.y)) {
    const group = groups.find(group => Math.abs(centerY(group[0].bounds!) - centerY(reading.bounds!))
      < Math.min(group[0].bounds!.height, reading.bounds!.height) * .5);
    if (group) group.push(reading); else groups.push([reading]);
  }
  return groups.map(group => {
    group.sort((a, b) => a.bounds!.x - b.bounds!.x);
    const left = Math.min(...group.map(reading => reading.bounds!.x)), top = Math.min(...group.map(reading => reading.bounds!.y));
    return { text: group.map(reading => reading.text.trim()).join(" "), bounds: { x: left, y: top,
      width: Math.max(...group.map(reading => reading.bounds!.x + reading.bounds!.width)) - left,
      height: Math.max(...group.map(reading => reading.bounds!.y + reading.bounds!.height)) - top } };
  });
}

/**
 * 제목·요구 조건·분류·옵션의 배치와 잘림/다른 창 혼입을 검사한다.
 * 마스크에서 정보가 빠진 경우에만 원색 판독을 요청하며, 원색에서도 부족하면 후보를 제외한다.
 */
export function assessTooltipCandidate(readings: OcrReading[], image: { width: number; height: number }, mode: "mask" | "color" = "mask"): TooltipCandidateAssessment {
  if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0)
    return { status: "rejected", reasons: ["invalid-image-size"], body: [] };
  const lines = rows(readings), reasons: string[] = [];
  const classification = lines.find(line => {
    const category = parseEquipmentCategory(line.text);
    return !!category && isKnownEquipmentCategory(category);
  });
  const options = lines.flatMap(line => { const option = parseTooltipOption(line.text); return option ? [{ ...line, option }] : []; });
  const body = options.filter(line => !line.option.requirement);
  const missing = (reason: string): TooltipCandidateAssessment => ({ status: mode === "mask" ? "retry-color" : "rejected", reasons: [reason], body });
  if (lines.some(line => windowHeading.test(line.text))) return { status: "rejected", reasons: ["foreign-window-heading"], body };
  if (!classification || options.length < 2 || !body.length) return missing("missing-equipment-body");
  const requirements = lines.filter(line => readTooltipRequirement(line.text));
  const headerEnd = Math.min(classification.bounds.y, ...requirements.map(line => line.bounds.y));
  const title = lines.find(line => line.bounds.y < headerEnd && line.bounds.y <= .2
    && /[가-힣A-Za-z]/.test(line.text) && !propertyMarker.test(line.text)
    && !readTooltipRequirement(line.text) && !parseTooltipOption(line.text)
    && !readCombatOptionLabel(line.text)
    && !/^(?:REQ|REG|RER|ITEM|사용\s*가능|장비\s*분류)/i.test(line.text));
  if (!title) return missing("missing-top-title");
  // 임의의 화면 좌표가 아니라 현재 판독 이미지의 2px 경계를 사용한다.
  const edgeX = 2 / image.width, edgeY = 2 / image.height;
  if (title.bounds.x <= edgeX || title.bounds.x + title.bounds.width >= 1 - edgeX) reasons.push("clipped-title");
  if (title.bounds.y <= 0 || title.bounds.y + title.bounds.height >= headerEnd) reasons.push("invalid-header-layout");
  if (body.some(line => centerY(line.bounds) < centerY(classification.bounds))) reasons.push("options-above-classification");
  const anchors = [classification, ...body, ...requirements];
  if (anchors.some(line => line.bounds.x <= edgeX || line.bounds.x + line.bounds.width >= 1 - edgeX
    || line.bounds.y + line.bounds.height >= 1 - edgeY)) reasons.push("clipped-equipment-content");
  return { status: reasons.length ? mode === "mask" ? "retry-color" : "rejected" : "complete", reasons, title, body };
}

const toSource = (region: OcrBounds, box: OcrBounds): OcrBounds => ({ x: region.x + box.x * region.width,
  y: region.y + box.y * region.height, width: box.width * region.width, height: box.height * region.height });
const overlap = (a: OcrBounds, b: OcrBounds) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const samePosition = (a: OcrBounds, b: OcrBounds) => overlap(a, b) > Math.min(a.width * a.height, b.width * b.height) * .5;
const signature = (option: TooltipOption) => JSON.stringify([option.label, option.value, option.percent]);

/** 제목과 모든 옵션이 같은 원본 위치에 있을 때만 같은 설명창의 중복 crop으로 묶는다. */
function sameTooltip(a: AssessedTooltipCandidate, b: AssessedTooltipCandidate): boolean {
  const first = a.assessment, second = b.assessment;
  if (!first.title || !second.title || first.title.text.replace(/\s/g, "") !== second.title.text.replace(/\s/g, "")) return false;
  if (!samePosition(toSource(a.region, first.title.bounds), toSource(b.region, second.title.bounds))) return false;
  if (!first.body.length || first.body.length !== second.body.length) return false;
  return first.body.every(line => second.body.some(other => signature(line.option) === signature(other.option)
    && samePosition(toSource(a.region, line.bounds), toSource(b.region, other.bounds))));
}

/** 완전한 후보만 남기고 같은 원본 설명창의 중복 crop을 정리한다. 두 실제 장비는 그대로 모호하게 남긴다. */
export function distinctCompleteCandidates<T extends AssessedTooltipCandidate>(candidates: T[]): T[] {
  const complete: T[] = [];
  for (const candidate of candidates) if (candidate.assessment.status === "complete"
    && !complete.some(other => sameTooltip(other, candidate))) complete.push(candidate);
  return complete;
}

/** 원본 좌표가 같은 crop만 반복 판독을 생략한다. 많이 겹치는 별도 영역은 내용 검사 없이 버리지 않는다. */
export function sameCandidateRegion(a: OcrBounds, b: OcrBounds): boolean {
  return (Object.keys(a) as Array<keyof OcrBounds>).every(key => Math.abs(a[key] - b[key]) < 1e-8);
}
