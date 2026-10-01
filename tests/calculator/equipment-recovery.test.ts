import { expect, it, vi } from "vitest";
import { evaluateEquipmentRecovery, locateEquipmentRecoveryTargets, recoverEquipmentReview } from "@/features/calculator/ocr/recoverEquipmentReview";
import { buildOcrReview, mapReviewedStats, resolveReviewLine, overrideReviewRequirement } from "@/features/calculator/ocr/reviewRecognition";
import type { EquipmentRecoveryObservation, OcrBounds, OcrReading, OcrReviewLine } from "@/features/calculator/ocr/types";

const bounds: OcrBounds = { x: .1, y: .5, width: .4, height: .035 };
const reading = (text: string, pass = 0, box = bounds): OcrReading => ({ text, pass, bounds: box,
  provenance: { role: "discovery", sourceId: "photo", operationId: "operation", viewId: `initial-${pass}`, readingId: `initial-${pass}-${text}` } });
const reviewOf = (text = "미식별:+6%") => buildOcrReview([reading(text), reading(text, 1)]);
const observation = (text: string, mode: EquipmentRecoveryObservation["mode"] = "gray", scale = 3, lineId = "line-0"): EquipmentRecoveryObservation => {
  const viewId = `${mode}-${scale}`;
  return { sourceId: "photo", operationId: "operation", lineId, viewId, mode, scale, bounds, status: "read",
    readings: [{ text, pass: 100, bounds: { x: .1, y: .3, width: .8, height: .4 },
      provenance: { role: "verification", sourceId: "photo", operationId: "operation", rowId: lineId, viewId, readingId: `reading-${viewId}` } }] };
};
const decide = (line: OcrReviewLine, observations: EquipmentRecoveryObservation[]) => evaluateEquipmentRecovery(line,
  { lineId: line.id, bounds, label: null, kind: "option", complete: true }, observations);

it("selects unknown labels without manufacturing a suggested option", () => {
  const review = reviewOf();
  expect(locateEquipmentRecoveryTargets(review)).toEqual([{ lineId: "line-0", bounds: review.lines[0].bounds, label: null, kind: "option", complete: true, reason: undefined }]);
  expect(mapReviewedStats(review, "corsair")).toEqual({});
});
it("locates unread requirement labels that the ordinary review never flagged", () => {
  const review = reviewOf("REQ LEVT:100");
  expect(review.lines[0].status).toBe("recognized");
  const [target] = locateEquipmentRecoveryTargets(review);
  expect(target).toMatchObject({ kind: "requirement", label: "LEV", complete: true });
  expect(evaluateEquipmentRecovery(review.lines[0], target, [observation("DEX:+100"), observation("DEX:+100", "color")]).reason).toBe("different-field");
  expect(evaluateEquipmentRecovery(review.lines[0], target, [observation("REQ LEV:100"), observation("REQ LEV:100", "color")]).status).toBe("recovered");
});
it("keeps a still-unread requirement blocked in apply experiments and permits an explicit field edit", async () => {
  const result = await recoverEquipmentReview(reviewOf("REQ LEVT:100"), { file: new File(["photo"], "photo.png"), sourceId: "photo", operationId: "operation",
    signal: new AbortController().signal, apply: true, createView: async () => null }, async () => []);
  expect(result.lines[0]).toMatchObject({ status: "check", equipmentRecovery: { kind: "requirement", fieldHint: "LEV", status: "unresolved" } });
  expect(overrideReviewRequirement(result, "corsair", "requiredLevel", "100")?.lines[0]).toMatchObject({ status: "confirmed", equipmentRecovery: undefined });
});
it("requires actual color and non-color readings and preserves an original typo", () => {
  const review = reviewOf();
  expect(decide(review.lines[0], [observation("올스탯:+6%")]).status).toBe("unresolved");
  expect(decide(review.lines[0], [observation("올스탯:+6%"), observation("올스탯:+6%", "color")])).toMatchObject({ status: "recovered", option: { label: "올스탯", value: 6, percent: true } });
  expect(review.lines[0].readings[0].text).toBe("미식별:+6%");
});
it.each(["미식별:+8%", "미식별:+6", "미식별:+696", "DEX:+8", "DEX:+6%"])('preserves original number/unit conflicts in %s', text => {
  const review = reviewOf(text);
  expect(decide(review.lines[0], [observation("올스탯:+6%"), observation("올스탯:+6%", "color")]).status).toBe("unresolved");
});
it.each(["미식별:+17x", "미식별:+I7", "미식별:+80?", "REQ LEV:10ú"])("does not hide an unparsed numeric fragment in %s", text => {
  const review = reviewOf(text);
  expect(decide(review.lines[0], [observation("DEX:+7"), observation("DEX:+7", "color")]).status).toBe("unresolved");
});
it("rejects duplicate, foreign, clipped, failed and contradictory evidence", () => {
  const line = reviewOf().lines[0], good = [observation("올스탯:+6%"), observation("올스탯:+6%", "color")];
  for (const bad of [good[0], { ...good[1], sourceId: "other" }, { ...good[1], operationId: "other" },
    { ...good[1], lineId: "other" }, { ...good[1], scale: 1 }, { ...good[1], status: "failed" as const },
    { ...good[1], readings: [] }, observation("올스탯:+8%", "color"), observation("몰스탯:+6%", "color"),
    { ...good[1], readings: [{ ...good[1].readings[0], bounds: { ...bounds, x: -.1 } }] }]) {
    expect(decide(line, [good[0], bad]).status).toBe("unresolved");
  }
});
it("keeps an unread spelling as a value constraint, never as a second label vote", () => {
  const line = reviewOf().lines[0];
  const unread = observation("미식별:+6%", "luma");
  const good = [observation("올스탯:+6%"), observation("올스탯:+6%", "color")];
  expect(decide(line, [unread, good[0]]).status).toBe("unresolved");
  expect(decide(line, [unread, ...good]).status).toBe("recovered");
  expect(decide(line, [observation("미식별:+8%", "luma"), ...good]).reason).toBe("conflicting-unidentified-value");
});
it("rejects percent signs and numeric fragments borrowed from another row", () => {
  const line = reviewOf("DEX:+6").lines[0];
  const split = observation("DEX:+6", "color");
  split.readings.push({ ...split.readings[0], text: "%", bounds: { x: .1, y: .8, width: .1, height: .05 },
    provenance: { ...split.readings[0].provenance!, readingId: "other-fragment" } });
  expect(decide(line, [observation("DEX:+6%"), split]).reason).toBe("different-reading-rows");
});
it("refuses legacy evidence without provenance and overlapping source fields", () => {
  const line = reviewOf().lines[0];
  expect(decide({ ...line, readings: [{ text: "미식별:+6%", pass: 0, bounds }] }, [observation("올스탯:+6%"), observation("올스탯:+6%", "color")]).reason).toBe("untracked-original-row");
  const review = buildOcrReview([reading("미식별:+6%"), reading("DEX:+4", 0, { ...bounds, x: .4 })]);
  expect(locateEquipmentRecoveryTargets(review).every(t => !t.complete)).toBe(true);
});
it("observe mode keeps values and all rejected attempts without applying a spelling hint", async () => {
  const review = reviewOf(), read = vi.fn().mockResolvedValue([{ text: "모르는 문장", pass: 100 }]);
  const result = await recoverEquipmentReview(review, { file: new File(["photo"], "photo.png"), sourceId: "photo", operationId: "operation",
    signal: new AbortController().signal, createView: async () => new File(["view"], "view.png") }, read);
  expect(read).toHaveBeenCalledTimes(8);
  expect(result.recoveryObservations).toHaveLength(8);
  expect(result.recoveryObservations?.every(o => o.readings[0].text === "모르는 문장")).toBe(true);
  expect(result.lines[0].text).toBe(review.lines[0].text);
  expect(mapReviewedStats(result, "corsair")).toEqual({});
});
it("cannot commit a cancelled reread or replace user-owned input", async () => {
  const controller = new AbortController(), review = reviewOf();
  await expect(recoverEquipmentReview(review, { file: new File(["photo"], "photo.png"), sourceId: "photo", operationId: "operation",
    signal: controller.signal, createView: async () => new File(["view"], "view.png") }, async () => {
    controller.abort(); return [reading("DEX:+6")];
  })).rejects.toMatchObject({ name: "AbortError" });
  expect(decide({ ...review.lines[0], status: "confirmed" }, [observation("DEX:+6"), observation("DEX:+6", "color")]).reason).toBe("user-owned-line");
});
it("clears recovery proof on manual edits and requirement override", () => {
  const review = reviewOf(), proof = decide(review.lines[0], [observation("올스탯:+6%"), observation("올스탯:+6%", "color")]);
  const withProof = { ...review, lines: [{ ...review.lines[0], equipmentRecovery: proof }] };
  expect(resolveReviewLine(withProof, "line-0", "DEX:+4").lines[0].equipmentRecovery).toBeUndefined();
  const requirement = { ...withProof, lines: [{ ...withProof.lines[0], text: "REQ LEV:100", equipmentRecovery: { ...proof, option: { label: "LEV", value: 100, percent: false, requirement: true, raw: "REQ LEV:100" } } }] };
  expect(overrideReviewRequirement(requirement, "corsair", "requiredLevel", "80")?.lines[0]).toMatchObject({ text: "REQ LEV : 80", status: "confirmed", equipmentRecovery: undefined });
});
it("propagates reader cancellation immediately even when the caller signal was not aborted", async () => {
  const read = vi.fn().mockRejectedValue(new DOMException("Worker terminated", "AbortError"));
  await expect(recoverEquipmentReview(reviewOf(), { file: new File(["photo"], "photo.png"), sourceId: "photo", operationId: "operation",
    signal: new AbortController().signal, createView: async () => new File(["view"], "view.png") }, read)).rejects.toMatchObject({ name: "AbortError" });
  expect(read).toHaveBeenCalledTimes(1);
});
