import { agreedLiteralValue, isUnrecognizedOptionLabel, literalOptionValue } from "./recognitionIssues";
import { buildOcrReview, normalizedReviewOption } from "./reviewRecognition";
import { parseEquipmentCategory, parseTooltipOption, readCombatOptionLabel, readTooltipRequirement } from "./parseMapleTooltip";
import { locateSourceRegion, sourceBoundsToPrepared, validSourceFrame, type SourceFrame } from "./sourceFrame";
import { requirementVerificationView } from "./requirementView.client";
import { createLabelPixelReader } from "./labelPixelReader.client";
import { selectPixelLabel, singleGlyphCandidates, type LabelPixelCandidate, type PixelLabelEvidence } from "./labelPixels";
import type { EquipmentRecoveryDecision, EquipmentRecoveryObservation, OcrBounds, OcrReading, OcrReview, OcrReviewLine } from "./types";

export type LabelRecoveryObservation = EquipmentRecoveryObservation & {
  part: "row" | "label";
  sourceBounds: OcrBounds;
};
type Context = { frame: SourceFrame; signal: AbortSignal; apply?: boolean; onProgress?: (progress: number) => void };
type Reader = (file: File, view: LabelRecoveryObservation) => Promise<OcrReading[]>;
const active = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException("Cancelled", "AbortError"); };
const center = (b: OcrBounds) => b.y + b.height / 2;
const key = (o: { value: number; percent: boolean }) => `${o.value}:${o.percent}`;
const glyphWeight = (s: string) => [...s].reduce((n, c) => n + (/[가-힣]/.test(c) ? 1 : /\s/.test(c) ? .3 : .55), 0);
function partBounds(line: OcrReviewLine, part: "row" | "label"): OcrBounds {
  const value = agreedLiteralValue(line)!;
  const fraction = Math.min(.9, glyphWeight(value.labelText) / glyphWeight(value.labelText + " : +" + value.literal) + .04);
  return { ...line.bounds!, width: line.bounds!.width * (part === "row" ? 1 : fraction) };
}
const references: Record<string, string> = { HP: "HP", MAXHP: "MaxHP", MP: "MP", MAXMP: "MaxMP", 마력: "마력",
  물리방어력: "물리 방어력", 마법방어력: "마법 방어력", 명중률: "명중률", 회피율: "회피율", 이동속도: "이동속도", 점프력: "점프력" };
const pixelVocabulary = ["올스탯", "올스텟", "공격력", "총데미지", "보스데미지", "보스 공격 시 데미지", "방어율무시", "방어율 무시",
  "크리티컬확률", "크리티컬 확률", ...Object.values(references)];
const cleanLabel = (text: string) => text.normalize("NFKC").trim().replace(/^[\s._·ㆍᆞ•|:;]+/, "").replace(/[\s:;.]+$/, "");
type LabelRecoveryDecision = EquipmentRecoveryDecision & { pixelCandidates?: LabelPixelCandidate[] };

/** Recognize a complete observed label, never an edit-distance guess or a label containing another number. */
export function canonicalRecoveryLabel(text: string): string | null {
  const label = cleanLabel(text);
  if (!label || /[\d+%:;]/u.test(label)) return null;
  const compact=label.toUpperCase().replace(/\s/g, "");
  // These reference spellings are already recognized by reviewRecognition's
  // reference-label policy. They never become attack or ignore-defense stats.
  if(/^물리방[어머미]력$/.test(compact))return "물리 방어력";
  if(/^마법방[어머미]력$/.test(compact))return "마법 방어력";
  return readCombatOptionLabel(label) ?? references[compact] ?? null;
}

function rowText(readings: OcrReading[], target: OcrBounds, region: OcrBounds, labelOnly = false): { text: string; ids: string[] } | null {
  if (!readings.length || readings.some(r => !r.bounds || !Object.values(r.bounds).every(Number.isFinite)
    || r.bounds.width <= 0 || r.bounds.height <= 0)) return null;
  // A detector may emit a Korean glyph's horizontal stroke twice: once in
  // the word and once as a nested dash. Exclude only that contained punctuation
  // in a label crop. Whole-row numbers, units and signs are never filtered.
  const usable = labelOnly ? readings.filter(reading => !(/^[-–—_.·]+$/.test(reading.text.trim()) && readings.some(other => {
    if (other === reading || !/[가-힣A-Za-z]/.test(other.text)) return false;
    const a=reading.bounds!, b=other.bounds!;
    return a.x>=b.x && a.y>=b.y && a.x+a.width<=b.x+b.width && a.y+a.height<=b.y+b.height;
  }))) : readings;
  const rows: OcrReading[][] = [];
  for (const reading of [...usable].sort((a,b)=>center(a.bounds!)-center(b.bounds!))) {
    const same = rows.find(group => group.some(other => {
      const a=reading.bounds!,b=other.bounds!;
      const overlap=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
      return overlap>=Math.min(a.height,b.height)*.5 && Math.abs(center(a)-center(b))<=Math.min(a.height,b.height)*.65;
    }));
    if(same)same.push(reading);else rows.push([reading]);
  }
  const aligned=rows.filter(group=>{
    const top=Math.min(...group.map(r=>r.bounds!.y));
    const bottom=Math.max(...group.map(r=>r.bounds!.y+r.bounds!.height));
    return Math.min(bottom,target.y+target.height)-Math.max(top,target.y)>=target.height*.45;
  });
  if(aligned.length!==1)return null;
  // A short number/unit inside the selected row is still evidence, even if it
  // cannot be joined confidently. Only vertically disjoint rows may be excluded.
  if(rows.some(group=>group!==aligned[0]&&group.some(r=>aligned[0].some(s=>{
    const a=r.bounds!,b=s.bounds!;
    return Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>Math.min(a.height,b.height)*.1;
  }))))return null;
  const sorted = [...aligned[0]].sort((a, b) => a.bounds!.x - b.bounds!.x);
  if(sorted.some(r=>r.bounds!.x+r.bounds!.width/2<region.x || r.bounds!.x+r.bounds!.width/2>region.x+region.width))return null;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1].bounds!, b = sorted[i].bounds!;
    if (b.x < a.x + a.width - Math.min(a.width, b.width) * .25) return null;
  }
  return {text:sorted.map(r => r.text.trim()).filter(Boolean).join(" "),ids:sorted.map(r=>r.provenance!.readingId)};
}

/** Pure policy for the exact-label strategy. A fourth observation can veto the earlier three. */
export function evaluateLabelRecovery(line: OcrReviewLine, frame: SourceFrame,
  observations: LabelRecoveryObservation[], pixels?: PixelLabelEvidence): LabelRecoveryDecision {
  const unresolved = (reason: string): LabelRecoveryDecision => ({ status: "unresolved", reason, observations, ...(pixels ? { labelPixels: pixels } : {}) });
  const value = agreedLiteralValue(line);
  if (line.status !== "check" || !line.bounds || !value || !line.readings.some(r => isUnrecognizedOptionLabel(r.text))
    || line.readings.some(r => readTooltipRequirement(r.text) || /^(?:REQ|REG|RER|REIQ|RE[@®])\b/i.test(r.text.trim()))) return unresolved("not-label-only");
  if (!validSourceFrame(frame) || !frame.sourceId || !frame.operationId) return unresolved("invalid-source-frame");
  if (line.readings.some(r => !r.provenance?.readingId || r.provenance.role !== "discovery"
    || r.provenance.sourceId !== frame.sourceId || r.provenance.operationId !== frame.operationId)
    || new Set(line.readings.map(r => r.provenance!.readingId)).size !== line.readings.length) return unresolved("untracked-original-row");
  const seen = new Set<string>(), readingIds = new Set<string>(), labels: Array<string | null> = [], selectedReadingIds: string[] = [];
  const rowEvidence: OcrReading[] = [];
  const spellings: string[] = [];
  const exactRowLabels: string[] = [];
  for (const observation of observations) {
    const view = `${observation.part}-${observation.mode}`;
    if (!["row-color", "row-luma", "label-color", "label-luma"].includes(view)
      || !observation.viewId || seen.has(view) || seen.has(observation.viewId)) return unresolved("invalid-or-duplicate-view");
    seen.add(view);seen.add(observation.viewId);
    if (observation.sourceId !== frame.sourceId || observation.operationId !== frame.operationId || observation.lineId !== line.id
      || observation.status !== "read" || observation.scale !== 3) return unresolved("incomplete-or-different-source");
    const expected = locateSourceRegion(frame, partBounds(line, observation.part), 2);
    if (!expected || expected.clipped || (Object.keys(expected.bounds) as Array<keyof OcrBounds>)
      .some(k => !Number.isFinite(observation.sourceBounds[k]) || Math.abs(expected.bounds[k] - observation.sourceBounds[k]) > 1e-8)) return unresolved("different-source-region");
    for (const reading of observation.readings) {
      const p = reading.provenance;
      if (!p || p.role !== "verification" || p.sourceId !== frame.sourceId || p.operationId !== frame.operationId
        || p.rowId !== line.id || p.viewId !== observation.viewId || !p.readingId || readingIds.has(p.readingId)) return unresolved("different-reading-source");
      readingIds.add(p.readingId);
    }
    const selected = rowText(observation.readings, line.bounds, sourceBoundsToPrepared(frame, expected.bounds)!, observation.part === "label");
    if (!selected) return unresolved("empty-or-mixed-rows");
    selectedReadingIds.push(...selected.ids);
    const literal = observation.part === "row" ? literalOptionValue(selected.text) : null;
    if (observation.part === "row" && (!literal || key(literal) !== key(value))) return unresolved("numeric-or-unit-conflict");
    if(observation.part === "row")rowEvidence.push({text:selected.text,pass:300+rowEvidence.length,bounds:line.bounds});
    const label = canonicalRecoveryLabel(literal?.labelText ?? selected.text);
    if (observation.part === "row" && label) exactRowLabels.push(label);
    spellings.push(cleanLabel(literal?.labelText ?? selected.text));
    labels.push(label);
  }
  if (observations.length !== 4 || labels.length !== 4) return unresolved("missing-label-or-value-evidence");
  // An unread name must not prevent inspecting later numeric/unit evidence.
  if (new Set(labels.filter(Boolean)).size > 1) return unresolved("label-conflict");
  let label = labels[0];
  if (labels.some(label => !label)) {
    const candidates = singleGlyphCandidates(spellings, pixelVocabulary.map(text => ({ text, label: canonicalRecoveryLabel(text) })));
    if (!candidates.length) return unresolved("unresolved-label");
    if (!pixels) return { ...unresolved("unresolved-label"), pixelCandidates: candidates };
    const region = locateSourceRegion(frame, line.bounds, 1), b = pixels.sourceBounds;
    if (pixels.sourceId !== frame.sourceId || pixels.operationId !== frame.operationId || pixels.lineId !== line.id
      || !region || region.clipped || !b || !Object.values(b).every(Number.isFinite) || b.width <= 0 || b.height <= 0
      || b.x < region.bounds.x || b.y < region.bounds.y
      || b.x + b.width > region.bounds.x + region.bounds.width + 1e-8 || b.y + b.height > region.bounds.y + region.bounds.height + 1e-8)
      return unresolved("different-pixel-source");
    if (pixels.candidates.length !== candidates.length || new Set(pixels.candidates.map(c => c.text)).size !== candidates.length
      || candidates.some(expected => !pixels.candidates.some(c => c.text === expected.text && c.label === expected.label)))
      return unresolved("incomplete-pixel-candidates");
    const selected = selectPixelLabel(pixels, exactRowLabels[0]);
    if (!selected || labels.some(known => known && known !== selected.label)) return unresolved("unresolved-pixel-label");
    label = selected.label;
  }
  if (!label) return unresolved("unresolved-label");
  for (const reading of line.readings) {
    const existing = literalOptionValue(reading.text);
    const known = existing && canonicalRecoveryLabel(existing.labelText);
    if (known && known !== label) return unresolved("conflicting-original-label");
  }
  const option = parseTooltipOption(`${label} : +${value.literal}`);
  if (!option || option.requirement || !normalizedReviewOption(option.raw)) return unresolved("unsupported-recovered-option");
  const checked=buildOcrReview(rowEvidence.map(reading => ({ ...reading, text: `${label} : +${value.literal}` }))).lines;
  if(checked.length!==1||checked[0].status!=="recognized")return unresolved("review-policy-blocked");
  return { status: "recovered", reason: pixels ? (exactRowLabels.length ? "source-row-label-and-glyph-agreement-v1" : "source-glyph-and-row-agreement-v1") : "source-label-and-row-agreement-v1",
    observations, option, fieldHint: label, kind: "option", selectedReadingIds, ...(pixels ? { labelPixels: pixels } : {}) };
}

/** Bounded label recovery. Crop hints select pixels; text and source glyph evidence determine the label. */
export async function recoverLabelRows(review: OcrReview, context: Context, read: Reader): Promise<OcrReview> {
  active(context.signal);
  // A damaged requirement/header cannot become an equipment bonus. A category row anchors the body.
  const categoryRows = review.lines.filter(line => line.bounds && review.category
    && line.readings.some(r => parseEquipmentCategory(r.text) === review.category));
  if (!categoryRows.length) return review;
  const bodyTop = Math.max(...categoryRows.map(line => line.bounds!.y + line.bounds!.height));
  const targets = review.lines.filter(line => line.status === "check" && line.bounds && agreedLiteralValue(line)
    && center(line.bounds) > bodyTop && line.readings.some(r => isUnrecognizedOptionLabel(r.text))
    && !line.readings.some(r => readTooltipRequirement(r.text) || /^(?:REQ|REG|RER|REIQ|RE[@®])\b/i.test(r.text.trim()))
    // The shared per-row budget must not silently become legacy eight reads plus four more.
    && !review.recoveryObservations?.some(r => r.lineId === line.id)).slice(0, 12);
  let result = review;
  const pixelReader = createLabelPixelReader();
  try {
  for (const [index, line] of targets.entries()) {
    const observations: LabelRecoveryObservation[] = [];
    for (const part of ["row", "label"] as const) for (const mode of ["color", "luma"] as const) {
      active(context.signal);
      const bounds = partBounds(line, part);
      const region = locateSourceRegion(context.frame, bounds, 2);
      const observation: LabelRecoveryObservation = { sourceId: context.frame.sourceId, operationId: context.frame.operationId,
        lineId: line.id, viewId: `${context.frame.operationId}-${line.id}-split-label-${part}-${mode}`, part, mode, scale: 3,
        bounds: { ...bounds }, sourceBounds: region?.bounds ?? bounds, status: "unavailable", readings: [] };
      observations.push(observation);
      if (!region || region.clipped) { observation.reason = "incomplete-original-region";continue; }
      try {
        const view = await requirementVerificationView(context.frame.original, region.bounds, { mode, scale: 3 });
        active(context.signal);
        if (!view) { observation.reason = "unavailable-source-view";continue; }
        const readings = await read(view.file, observation);
        active(context.signal);
        observation.readings = readings.map(reading => {
          if (!reading.bounds) return reading;
          const b = reading.bounds;
          const source = { x: view.crop.x + (b.x * view.width - view.padding) / view.contentWidth * view.crop.width,
            y: view.crop.y + (b.y * view.height - view.padding) / view.contentHeight * view.crop.height,
            width: b.width * view.width / view.contentWidth * view.crop.width,
            height: b.height * view.height / view.contentHeight * view.crop.height };
          return { ...reading, bounds: sourceBoundsToPrepared(context.frame, source) ?? undefined };
        });
        observation.status = "read";
      } catch (error) {
        active(context.signal);
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        observation.status = "failed";observation.reason = "recognition-failed";
      }
    }
    let decision = evaluateLabelRecovery(line, context.frame, observations);
    if (decision.pixelCandidates?.length) {
      let pixels: PixelLabelEvidence;
      try { pixels = await pixelReader.read(context.frame, line, decision.pixelCandidates, context.signal); }
      catch (error) {
        active(context.signal);
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        pixels = { method: "font-pixels-v1", status: "unavailable", reason: "pixel-reading-failed",
          sourceId: context.frame.sourceId, operationId: context.frame.operationId, lineId: line.id, candidates: [] };
      }
      active(context.signal);
      decision = evaluateLabelRecovery(line, context.frame, observations, pixels);
    }
    const option = decision.option;
    result = { ...result, lines: result.lines.map(current => current.id !== line.id ? current : { ...current,
      equipmentRecovery: decision,
      ...(context.apply && decision.status === "recovered" && option ? {
        text: `${option.label} +${option.value}${option.percent ? "%" : ""}`, status: "recognized" as const, reason: undefined,
      } : {}) }), recoveryObservations: [...(result.recoveryObservations ?? []), ...observations] };
    context.onProgress?.((index + 1) / Math.max(1, targets.length));
  }
  active(context.signal);
  return result;
  } finally { pixelReader.dispose(); }
}
