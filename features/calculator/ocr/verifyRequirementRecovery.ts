/**
 * 원본 요구 조건의 출처·행 완전성·다양한 변환/배율의 일치를 검사하는 실험 검증기.
 * 실이미지의 희미한 일부 글자에서 활성화 기준을 통과하지 못했으며 기본 판독의 성공 보증으로 사용하지 않는다.
 */
import { parseTooltipOption, readCombatOptionLabel, readTooltipRequirement } from "./parseMapleTooltip";
import type { LocatedRequirement, OcrBounds, RequirementObservation, RequirementRecovery } from "./types";

const center = (box: OcrBounds) => box.y + box.height / 2;
const validBounds = (box: OcrBounds) => Object.values(box).every(Number.isFinite)
  && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
  && box.x + box.width <= 1 && box.y + box.height <= 1;
const sameBounds = (a: OcrBounds, b: OcrBounds) => (Object.keys(a) as Array<keyof OcrBounds>).every(key => Math.abs(a[key] - b[key]) < 1e-8);
const validExtent = (box: OcrBounds) => Object.values(box).every(Number.isFinite) && box.width > 0 && box.height > 0;
const overlap = (start: number, extent: number, otherStart: number, otherExtent: number) => Math.max(0, Math.min(start + extent, otherStart + otherExtent) - Math.max(start, otherStart));
const belongsToRenderedRow = (box: OcrBounds, crop: OcrBounds, rendered: OcrBounds) => validExtent(box) && validExtent(rendered)
  && box.x > rendered.x && box.y > rendered.y
  && box.x + box.width < rendered.x + rendered.width && box.y + box.height < rendered.y + rendered.height
  && box.x + box.width / 2 >= crop.x && box.x + box.width / 2 <= crop.x + crop.width
  && center(box) >= crop.y && center(box) <= crop.y + crop.height
  && overlap(box.x, box.width, crop.x, crop.width) > box.width / 2
  && overlap(box.y, box.height, crop.y, crop.height) > box.height / 2;

/**
 * 같은 원본 행의 4개 검증 뷰를 모두 검사하고 유효 숫자가 두 변환·두 배율에 걸쳐 일치하는지 확인한다.
 * 출처 불일치·행 잘림·다른 필드·충돌 숫자는 unresolved로 남긴다. 기본 탐지의 표 수나 엔진 신뢰도는 이 검증의 투표로 쓰지 않는다.
 * 빈 판독은 숫자를 만들지 않으며, 잘못된 숫자 조각이 남은 판독은 일치를 방해하는 증거로 보존한다.
 */
export function verifyRequirementRecovery(target: LocatedRequirement, observations: RequirementObservation[]): RequirementRecovery {
  const unresolved = (reason: string): RequirementRecovery => ({ rule: "requirement-original-v1", status: "unresolved",
    target, observations, reason, supersededReadingIds: [] });
  if (!target.complete || !validBounds(target.crop) || !validBounds(target.rowBounds)) return unresolved(target.reason ?? "incomplete-region");
  if (!target.sourceId || !target.operationId || !target.rowId || !["LEV", "STR", "DEX"].includes(target.field)) return unresolved("missing-target-identity");
  if (observations.length !== 4) return unresolved("missing-verification-view");
  const views = new Set<string>(), viewIds = new Set<string>(), readingIds = new Set<string>(), values: number[] = [];
  const modes = new Set<string>(), scales = new Set<number>();
  for (const observation of observations) {
    if (observation.sourceId !== target.sourceId || observation.operationId !== target.operationId
      || observation.field !== target.field || observation.rowId !== target.rowId || !sameBounds(observation.crop, target.crop)) return unresolved("different-target");
    if (!["color", "luma"].includes(observation.mode) || ![2, 3].includes(observation.scale)) return unresolved("invalid-verification-view");
    const view = `${observation.mode}-${observation.scale}`;
    if (!observation.viewId || views.has(view) || viewIds.has(observation.viewId)) return unresolved("duplicate-verification-view");
    views.add(view);
    viewIds.add(observation.viewId);
    if (observation.failure) return unresolved(observation.failure);
    if (!observation.readings.length) continue;
    const readings = [...observation.readings].sort((a, b) => (a.bounds?.x ?? 0) - (b.bounds?.x ?? 0));
    for (const reading of readings) {
      const origin = reading.provenance;
      if (!origin || origin.role !== "verification" || origin.sourceId !== target.sourceId || origin.operationId !== target.operationId
        || origin.field !== target.field || origin.rowId !== target.rowId || origin.viewId !== observation.viewId) return unresolved("different-reading-source");
      if (!origin.readingId || readingIds.has(origin.readingId)) return unresolved("duplicate-reading");
      readingIds.add(origin.readingId);
      // Paddle DB unclip polygons include empty pixels around the glyphs and
      // may extend into our known artificial padding. Keep the raw polygon;
      // source completeness is established by the target crop, while geometry
      // here checks the actual rendered extent and correspondence to its row.
      if (!reading.bounds || !belongsToRenderedRow(reading.bounds, target.crop, observation.renderBounds ?? target.crop)) return unresolved("clipped-reading");
      if (Math.abs(center(reading.bounds) - center(target.rowBounds)) > Math.max(reading.bounds.height, target.rowBounds.height) * .65) return unresolved("different-row");
      if (!reading.text.trim()) return unresolved("empty-fragment");
    }
    // Combine only fragments from this same isolated row. Keep every fragment,
    // including malformed or contradictory digits; never pick a preferred one.
    for (let index = 1; index < readings.length; index++) {
      const left = readings[index - 1].bounds!, right = readings[index].bounds!;
      if (right.x < left.x + left.width - Math.min(left.width, right.width) * .25) return unresolved("overlapping-fragments");
      if (Math.abs(center(left) - center(right)) > Math.min(left.height, right.height) * .65) return unresolved("different-fragment-row");
    }
    const text = readings.map(reading => reading.text.trim()).join(" ");
    const requirement = readTooltipRequirement(text), option = parseTooltipOption(text);
    if (requirement && requirement.label !== target.field) return unresolved("different-requirement-field");
    // An empty/non-numeric view supplies no vote. A malformed view containing
    // any numeric fragment still blocks, including a digit with a lost label.
    if (!option) {
      if (/\d/.test(text) || /^[OB\s]+$/i.test(text) || (requirement && /[OB]/i.test(requirement.valueText))) return unresolved("ambiguous-numeric-fragment");
      if (!requirement && readCombatOptionLabel(text)) return unresolved("lost-requirement-label");
      continue;
    }
    if (!/^(?:REQ|REG|RER|REIQ|RE[@®])/i.test(text.normalize("NFKC"))) return unresolved("lost-requirement-label");
    if (!requirement || !option.requirement || option.label !== target.field
      || option.percent || !Number.isSafeInteger(option.value) || option.value < 0 || option.value > 9999) return unresolved("ambiguous-requirement-value");
    values.push(option.value);
    modes.add(observation.mode); scales.add(observation.scale);
  }
  if (views.size !== 4) return unresolved("missing-verification-view");
  if (modes.size !== 2 || scales.size !== 2) return unresolved("missing-diverse-evidence");
  if (new Set(values).size !== 1) return unresolved("conflicting-verification-values");
  return { rule: "requirement-original-v1", status: "verified", target, observations, value: values[0],
    reason: "original-region-unanimous", supersededReadingIds: [] };
}
