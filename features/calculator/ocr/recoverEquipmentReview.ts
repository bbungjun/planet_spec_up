/**
 * Source-row recovery experiment. Target selection does not require a parsed label;
 * spelling hints never become values. The application default does not apply this
 * candidate until real-image, completeness and information-loss gates pass.
 */
import { parseEquipmentCategory, parseTooltipOption, readTooltipRequirement } from "./parseMapleTooltip";
import { buildOcrReview, normalizedReviewOption } from "./reviewRecognition";
import { retryRecognitionBounds, retryRecognitionLabel } from "./retryRecognition";
import { RECOVERY_VIEWS, requirementView, type RecoveryView } from "./requirementView.client";
import type { EquipmentRecoveryDecision, EquipmentRecoveryObservation, OcrBounds, OcrReading, OcrReview, OcrReviewLine, TooltipOption } from "./types";
import { recoverLabelRows } from "./recoverLabels";
import type { SourceFrame } from "./sourceFrame";

export type EquipmentRecoveryTarget = { lineId: string; bounds: OcrBounds; label: string | null; kind: "option" | "requirement"; complete: boolean; reason?: string };
const valid = (b: OcrBounds) => Object.values(b).every(Number.isFinite) && b.x >= 0 && b.y >= 0
  && b.width > 0 && b.height > 0 && b.x + b.width <= 1 && b.y + b.height <= 1;
const center = (b: OcrBounds) => b.y + b.height / 2;
const overlaps = (a: OcrBounds, b: OcrBounds) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x)
  && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
const key = (o: TooltipOption) => JSON.stringify([o.label, o.value, o.percent, o.requirement]);

/** Unknown labels are first-class targets. Numeric evidence is never manufactured here. */
export function locateEquipmentRecoveryTargets(review: OcrReview): EquipmentRecoveryTarget[] {
  const unreadRequirementFields = (line: OcrReviewLine) => [...new Set(line.readings.flatMap(reading => {
    if (parseTooltipOption(reading.text)) return [];
    const token = reading.text.normalize("NFKC").toUpperCase().match(/^(?:REQ|REG|RER|REIQ|RE[@®])\s+([A-Z!]{2,5})(?=\s|[:;]|\d|$)/)?.[1];
    if (!token) return [];
    // Locating a suspected field is not normalization of its label or value.
    return ["LEV", "STR", "DEX", "INT", "LUK"].filter(field => token.startsWith(field)
      || (token.length === field.length && [...field].filter((letter, index) => token[index] !== letter).length <= 1));
  }))];
  const unreadRequirement = (line: OcrReviewLine) => unreadRequirementFields(line).length > 0;
  return review.lines.filter(line => line.bounds && line.status !== "confirmed" && line.status !== "ignored"
    && (line.status === "check" || unreadRequirement(line))).map(line => {
    const hints = unreadRequirementFields(line);
    const label = retryRecognitionLabel(line) ?? (hints.length === 1 ? hints[0] : null);
    const bounds = retryRecognitionBounds(review, line) ?? line.bounds!;
    const mixed = review.lines.some(other => other !== line && other.bounds && overlaps(bounds, other.bounds)
      && Math.abs(center(bounds) - center(other.bounds)) < Math.max(bounds.height, other.bounds.height)
      && other.readings.some(r => parseTooltipOption(r.text) || parseEquipmentCategory(r.text)));
    const complete = valid(bounds) && !mixed;
    const kind = unreadRequirement(line) || line.readings.some(r => readTooltipRequirement(r.text)) ? "requirement" as const : "option" as const;
    return { lineId: line.id, bounds, label, kind, complete, reason: !valid(bounds) ? "invalid-source-row" : mixed ? "overlapping-field-or-row" : undefined };
  });
}

/** All values, units, fields and failed attempts participate; duplicate views cannot vote. */
export function evaluateEquipmentRecovery(line: OcrReviewLine, target: EquipmentRecoveryTarget,
  observations: EquipmentRecoveryObservation[]): EquipmentRecoveryDecision {
  const unresolved = (reason: string): EquipmentRecoveryDecision => ({ status: "unresolved", reason, observations });
  if (!target.complete || !line.bounds || line.id !== target.lineId) return unresolved(target.reason ?? "incomplete-source-row");
  if (line.status === "confirmed" || line.status === "ignored") return unresolved("user-owned-line");
  const views = new Set<string>(), modes = new Set<string>(), values: TooltipOption[] = [];
  const numericConstraints: Array<{ value: number; percent: boolean }> = [];
  const identity = observations[0];
  if (!identity?.sourceId || !identity.operationId) return unresolved("missing-source-identity");
  if (!line.readings.length || line.readings.some(r => !r.provenance || r.provenance.sourceId !== identity.sourceId
    || r.provenance.operationId !== identity.operationId)) return unresolved("untracked-original-row");
  const readingIds = new Set<string>();
  for (const observation of observations) {
    if (observation.sourceId !== identity.sourceId || observation.operationId !== identity.operationId
      || observation.lineId !== target.lineId || !observation.viewId
      || !valid(observation.bounds) || (Object.keys(target.bounds) as Array<keyof OcrBounds>).some(k => Math.abs(target.bounds[k] - observation.bounds[k]) > 1e-8)) return unresolved("different-source-row");
    if (!["gray", "luma", "color", "soft"].includes(observation.mode) || ![3, 4].includes(observation.scale)) return unresolved("invalid-view");
    const view = `${observation.mode}-${observation.scale}`;
    if (views.has(view) || views.has(observation.viewId)) return unresolved("duplicate-view");
    views.add(view); views.add(observation.viewId);
    if (observation.status !== "read") return unresolved(observation.reason ?? "unavailable-view");
    for (const reading of observation.readings) {
      const origin = reading.provenance;
      if (!origin || origin.role !== "verification" || origin.sourceId !== identity.sourceId || origin.operationId !== identity.operationId
        || origin.rowId !== target.lineId || origin.viewId !== observation.viewId || !origin.readingId) return unresolved("different-reading-source");
      if (readingIds.has(origin.readingId)) return unresolved("duplicate-reading");
      readingIds.add(origin.readingId);
      if (!reading.bounds || !valid(reading.bounds)) return unresolved("incomplete-reading");
    }
    const ordered = [...observation.readings].sort((a, b) => a.bounds!.x - b.bounds!.x);
    for (let index = 1; index < ordered.length; index++) {
      const first = ordered[index - 1].bounds!, next = ordered[index].bounds!;
      if (Math.abs(center(first) - center(next)) > Math.min(first.height, next.height) * .65) return unresolved("different-reading-rows");
      if (next.x < first.x + first.width - Math.min(first.width, next.width) * .25) return unresolved("overlapping-reading-fragments");
    }
    // Multiple/empty/fractured rows do not supply agreement, including numeric
    // fragments that a full-line option parser cannot interpret.
    const text = ordered.map(r => r.text.trim()).filter(Boolean).join(" ");
    const option = parseTooltipOption(text);
    if (!option || !normalizedReviewOption(text)) {
      // A misspelled name is no label vote. A complete literal value still
      // constrains later readings; partial/malformed digits remain a veto.
      const literal = text.normalize("NFKC").match(/[:;]\s*\+?\s*(\d+(?:\.\d+)?)\s*(%)?\s*$/);
      if (option) numericConstraints.push(option);
      else if (literal) numericConstraints.push({ value: Number(literal[1]), percent: !!literal[2] });
      else if (/\d/.test(text)) return unresolved("unparsed-numeric-evidence");
      continue;
    }
    if (target.label && option.label !== target.label) return unresolved("different-field");
    if ((target.kind === "requirement") !== option.requirement) return unresolved("different-field-kind");
    if (line.reason?.includes("요구 조건과 장비 옵션") && !option.requirement) return unresolved("lost-requirement-prefix");
    const requirements = line.readings.map(r => readTooltipRequirement(r.text)?.label).filter(Boolean);
    if (requirements.length && (!option.requirement || requirements.some(label => label !== option.label))) return unresolved("different-requirement-field");
    values.push(option); modes.add(observation.mode);
  }
  if (values.length < 2 || !modes.has("color") || !["gray", "luma"].some(mode => modes.has(mode))) return unresolved("missing-diverse-evidence");
  if (new Set(values.map(key)).size !== 1) return unresolved("conflicting-rereads");
  const option = values[0];
  if (numericConstraints.some(r => r.value !== option.value || r.percent !== option.percent)) return unresolved("conflicting-unidentified-value");
  // A new spelling must not hide a different original number or a lost %.
  for (const reading of line.readings) {
    const original = parseTooltipOption(reading.text);
    if (original && (original.value !== option.value || original.percent !== option.percent
      || (normalizedReviewOption(reading.text) && (original.label !== option.label || original.requirement !== option.requirement)))) return unresolved("conflicting-original-evidence");
    if (!original && /\d/.test(reading.text)) {
      // An unread label with a complete literal value can constrain a reread;
      // a trailing letter, lost unit or a partial digit cannot be discarded.
      const literal = reading.text.normalize("NFKC").match(/[:;]\s*\+?\s*(\d+(?:\.\d+)?)\s*(%)?\s*$/);
      if (!literal) return unresolved("unparsed-original-numeric-evidence");
      if (Number(literal[1]) !== option.value || !!literal[2] !== option.percent) return unresolved("conflicting-original-evidence");
    }
  }
  // This candidate deliberately does not supersede original conflicts. The old
  // failed requirement verifier is not a safe exception for combat values.
  const evidence = observations.flatMap((observation, index) => observation.readings.map(reading => ({
    ...reading, pass: 100 + index, bounds: line.bounds,
  })));
  const checked = buildOcrReview(evidence).lines;
  if (checked.length !== 1 || checked[0].status !== "recognized") return unresolved("review-policy-blocked");
  return { status: "recovered", reason: "exact-original-row-rereads", observations, option };
}

type RecoveryContext = { file: File; sourceId: string; operationId: string; signal: AbortSignal; apply?: boolean;
  labelSource?: SourceFrame;
  onProgress?: (progress: number) => void; createView?: (file: File, bounds: OcrBounds, view: RecoveryView) => Promise<File | null> };
type RecoveryReader = (file: File, view: { lineId: string; mode: RecoveryView["mode"]; scale: number; viewId: string }) => Promise<OcrReading[]>;
const active = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException("Cancelled", "AbortError"); };

/** Same interface is exercised by the image experiment and integration tests. */
export async function recoverEquipmentReview(review: OcrReview, context: RecoveryContext, read: RecoveryReader): Promise<OcrReview> {
  active(context.signal);
  if (context.labelSource) return recoverLabelRows(review, { frame: context.labelSource, signal: context.signal,
    apply: context.apply, onProgress: context.onProgress }, read);
  const targets = locateEquipmentRecoveryTargets(review), selected = targets.slice(0, 12);
  let result = review;
  for (const [index, target] of selected.entries()) {
    active(context.signal); context.onProgress?.(index / Math.max(1, selected.length));
    const observations: EquipmentRecoveryObservation[] = [];
    const line = review.lines.find(line => line.id === target.lineId)!;
    if (target.complete) for (const [viewIndex, view] of RECOVERY_VIEWS.entries()) {
      active(context.signal);
      const observation: EquipmentRecoveryObservation = { ...view, sourceId: context.sourceId, operationId: context.operationId,
        lineId: target.lineId, viewId: `${context.operationId}-${target.lineId}-${view.mode}-${view.scale}`,
        bounds: { ...target.bounds }, status: "unavailable", readings: [] };
      observations.push(observation);
      try {
        const image = await (context.createView ?? requirementView)(context.file, target.bounds, view);
        active(context.signal);
        if (!image) { observation.reason = "unavailable-source-view"; continue; }
        observation.readings = await read(image, observation);
        active(context.signal); observation.status = "read";
        // Stop only after an actual color + non-color pair is sufficient. Any
        // observed bad/empty evidence is retained and prevents certification.
        const decision = evaluateEquipmentRecovery(line, target, observations);
        if (decision.status === "recovered" && viewIndex >= 4) break;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        active(context.signal); observation.status = "failed"; observation.reason = "recognition-failed";
      }
    }
    const decision = { ...evaluateEquipmentRecovery(line, target, observations), fieldHint: target.label, kind: target.kind };
    const text = decision.option ? decision.option.requirement ? `REQ ${decision.option.label} : ${decision.option.value}`
      : `${decision.option.label} +${decision.option.value}${decision.option.percent ? "%" : ""}` : line.text;
    result = { ...result, lines: result.lines.map(current => current.id !== line.id ? current : { ...current, equipmentRecovery: decision,
      ...(context.apply && decision.status === "recovered" ? { text, status: "recognized" as const, reason: undefined }
        : context.apply && target.kind === "requirement" ? { status: "check" as const, reason: "요구 조건의 값을 원본에서 일치하게 읽지 못했어요." } : {}) }),
      recoveryObservations: [...(result.recoveryObservations ?? []), ...observations] };
  }
  if (targets.length > selected.length) result = { ...result, warnings: [...result.warnings, "자동 재인식 한도를 넘는 미해결 항목이 있어요."] };
  active(context.signal); context.onProgress?.(1); return result;
}
