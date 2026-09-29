import { expect, it } from "vitest";
import { applyRequirementRecovery, buildOcrReview, editedTextReview, mapReviewedStats, overrideReviewRequirement, resolveReviewLine, reviewBlocked, reviewQuestions, reviewText } from "@/features/calculator/ocr/reviewRecognition";
import { locateRequirementVerification } from "@/features/calculator/ocr/retryRequirements";
import { verifyRequirementRecovery } from "@/features/calculator/ocr/verifyRequirementRecovery";
import type { LocatedRequirement, OcrBounds, OcrReading, RequirementObservation } from "@/features/calculator/ocr/types";

const identity = { sourceId: "image", operationId: "operation" };
const box = { x: .2, y: .2, width: .4, height: .04 };
function discovery(text: string, pass: number, bounds: OcrBounds = box): OcrReading {
  return { text, pass, bounds, provenance: { ...identity, role: "discovery", viewId: `discovery-${pass}`, readingId: `discovery-${pass}-${bounds.y}` } };
}
function target(): LocatedRequirement {
  return { ...identity, field: "STR", rowId: "line-0", lineId: "line-0", rowBounds: box,
    crop: { x: .198, y: .196, width: .406, height: .048 }, complete: true };
}
function observations(value: number | string = 17, located = target()): RequirementObservation[] {
  return (["color", "luma"] as const).flatMap(mode => ([2, 3] as const).map(scale => {
    const viewId = `${mode}-${scale}`;
    return { ...identity, field: located.field, rowId: located.rowId, crop: located.crop, mode, scale, viewId,
      readings: [{ text: typeof value === "number" ? `REQ ${located.field}: ${value}` : value, pass: 30 + scale, bounds: located.rowBounds,
        provenance: { ...identity, role: "verification", field: located.field, rowId: located.rowId, viewId, readingId: viewId } }] };
  }));
}

it.each([0, 1, 17, 60, 80])("adopts the observed integer %i without voting against discovery errors", value => {
  const review = buildOcrReview([discovery("REQ STR: 3", 0), discovery("REQ STR: 8", 1)], ["원본 범위 확인"]);
  const finalized = applyRequirementRecovery(review, target(), observations(value));
  expect(mapReviewedStats(finalized, "corsair")).toEqual({ requiredSub: String(value) });
  expect(finalized.lines[0].status).toBe("recognized");
  expect(finalized.lines[0].recovery).toMatchObject({ status: "verified", value, reason: "initial-reading-superseded",
    supersededReadingIds: ["discovery-0-0.2", "discovery-1-0.2"] });
  expect(finalized.lines[0].readings.slice(0, 2)).toEqual(review.lines[0].readings);
  expect(finalized.initialReadings).toEqual(review.initialReadings);
  expect(finalized.warnings).toEqual(review.warnings);
  expect(reviewQuestions(finalized, "corsair")).toEqual([]);
  expect(reviewBlocked(finalized, "corsair")).toBe(true); // unrelated photo warning remains
  expect(reviewText(finalized)).toBe(`REQ STR : ${value}`);
});

it("corrects two matching discovery errors and fills a discovered label without a value", () => {
  for (const initial of ["REQ STR: 3", "REQ STR:"]) {
    const review = buildOcrReview([discovery(initial, 0), discovery(initial, 1)]);
    const finalized = applyRequirementRecovery(review, target(), observations(17));
    expect(mapReviewedStats(finalized, "corsair")).toEqual({ requiredSub: "17" });
    expect(reviewBlocked(finalized, "corsair")).toBe(false);
  }
});

it("supersedes an unlabeled discovery misread but preserves contradictory identified requirement labels", () => {
  for (const lostLabel of ["STR:60", "60", "Q"]) {
    const start = buildOcrReview([discovery("REQ STR:17", 0), discovery(lostLabel, 1)]);
    const finalized = applyRequirementRecovery(start, target(), observations(17));
    expect(mapReviewedStats(finalized, "corsair")).toEqual({ requiredSub: "17" });
    expect(finalized.lines[0].recovery?.status).toBe("verified");
    expect(finalized.lines[0].readings[1].text).toBe(lostLabel);
  }
  const conflictingLabels = buildOcrReview([discovery("REQ STR:17", 0), discovery("REQ LEV:17", 1)]);
  expect(locateRequirementVerification(conflictingLabels, identity, { width: 1000, height: 1000 })).toEqual([]);
  expect(applyRequirementRecovery(conflictingLabels, target(), observations(17))).toBe(conflictingLabels);
});

it("examines all four views but does not count an empty or non-numeric view as a vote", () => {
  for (const unread of [[], observations("REQ STR:Q")[3].readings]) {
    const evidence = observations(17); evidence[3].readings = unread;
    expect(verifyRequirementRecovery(target(), evidence)).toMatchObject({ status: "verified", value: 17 });
  }
  const diagonal = observations(17); diagonal[1].readings = []; diagonal[2].readings = [];
  expect(verifyRequirementRecovery(target(), diagonal)).toMatchObject({ status: "verified", value: 17 });
});

it("blocks a fourth conflicting value or malformed numeric fragment despite three agreeing values", () => {
  for (const conflict of ["REQ STR: 60", "REQ STR: 17 60", "REQ STR:17 Q", "REQ STR:8Q", "60", "O"]) {
    const evidence = observations(17); evidence[3].readings[0].text = conflict;
    expect(verifyRequirementRecovery(target(), evidence).status).toBe("unresolved");
  }
});

it("requires completed examination, both transformations and both scales", () => {
  const missingView = observations(17).slice(0, 3);
  expect(verifyRequirementRecovery(target(), missingView).reason).toBe("missing-verification-view");
  const onlyColor = observations(17); onlyColor[2].readings = []; onlyColor[3].readings = [];
  expect(verifyRequirementRecovery(target(), onlyColor).reason).toBe("missing-diverse-evidence");
  const only2x = observations(17); only2x[1].readings = []; only2x[3].readings = [];
  expect(verifyRequirementRecovery(target(), only2x).reason).toBe("missing-diverse-evidence");
  const failure = observations(17); failure[3].failure = "verification-failed";
  expect(verifyRequirementRecovery(target(), failure).status).toBe("unresolved");
  const duplicate = observations(17); duplicate[3] = duplicate[2];
  expect(verifyRequirementRecovery(target(), duplicate).reason).toBe("duplicate-verification-view");
  const duplicateId = observations(17); duplicateId[3].viewId = duplicateId[2].viewId;
  expect(verifyRequirementRecovery(target(), duplicateId).status).toBe("unresolved");
});

it("rejects different image, operation, field, row, crop and legacy reading provenance", () => {
  for (const key of ["sourceId", "operationId", "field", "rowId"] as const) {
    const evidence = observations(17); Object.assign(evidence[3], { [key]: "different" });
    expect(verifyRequirementRecovery(target(), evidence).status).toBe("unresolved");
    const wrongReading = observations(17); Object.assign(wrongReading[3].readings[0].provenance!, { [key]: "different" });
    expect(verifyRequirementRecovery(target(), wrongReading).status).toBe("unresolved");
  }
  const differentCrop = observations(17); differentCrop[3].crop = { ...differentCrop[3].crop, x: .19 };
  expect(verifyRequirementRecovery(target(), differentCrop).status).toBe("unresolved");
  const legacy = observations(17); legacy[3].readings[0].provenance = undefined;
  expect(verifyRequirementRecovery(target(), legacy).status).toBe("unresolved");
});

it("rejects clipped rows, lost labels, other fields, multiple values and non-integer formats", () => {
  expect(verifyRequirementRecovery({ ...target(), complete: false }, observations()).status).toBe("unresolved");
  for (const text of ["STR:17", "STR:", "REQ DEX:17", "REQ STR:17 REQ DEX:17", "REQ STR:17%", "REQ STR:-1", "REQ STR:1.7", "REQ STR:17 17", "REQ STR:10000"]) {
    const evidence = observations(text);
    expect(verifyRequirementRecovery(target(), evidence).status).toBe("unresolved");
  }
  const clipped = observations(17); clipped[3].readings[0].bounds = { ...box, x: target().crop.x };
  expect(verifyRequirementRecovery(target(), clipped).reason).toBe("clipped-reading");
  const wrongRow = observations(17); wrongRow[3].readings[0].bounds = { ...box, y: .245, height: .003 };
  expect(verifyRequirementRecovery(target(), wrongRow).status).toBe("unresolved");
});

it("clamps preferred margins to neighboring row midpoints without clipping the discovered row", () => {
  const review = buildOcrReview([discovery("REQ LEV:80", 0, { ...box, y: .169, height: .021 }), discovery("REQ LEV:80", 1, { ...box, y: .169, height: .021 }),
    discovery("REQ STR:17", 0, { ...box, y: .193, height: .021 }), discovery("REQ STR:17", 1, { ...box, y: .193, height: .021 })]);
  const located = locateRequirementVerification(review, identity, { width: 1000, height: 1000 });
  const requirement = located.find(item => item.field === "STR")!;
  expect(requirement.complete).toBe(true);
  expect(requirement.crop.y).toBe(.192);
  expect(requirement.crop.y).toBeGreaterThanOrEqual((.19 + .193) / 2);
  expect(requirement.crop.y).toBeLessThan(requirement.rowBounds.y);
  expect(verifyRequirementRecovery(target(), observations(9999))).toMatchObject({ status: "verified", value: 9999 });
});

it("shares one rasterized separator for fractional row coordinates without losing either source box", () => {
  const size = { width: 350, height: 351 };
  const upper = { ...box, y: 70.5 / size.height, height: 15 / size.height };
  const lower = { ...box, y: (86 + 1 / 3) / size.height, height: 15 / size.height };
  const review = buildOcrReview([discovery("REQ LEV:80", 0, upper), discovery("REQ LEV:80", 1, upper),
    discovery("REQ STR:17", 0, lower), discovery("REQ STR:17", 1, lower)]);
  const located = locateRequirementVerification(review, identity, size);
  const lev = located.find(item => item.field === "LEV")!, str = located.find(item => item.field === "STR")!;
  expect(lev.complete).toBe(true); expect(str.complete).toBe(true);
  expect((lev.crop.y + lev.crop.height) * size.height).toBeCloseTo(86);
  expect(str.crop.y * size.height).toBeCloseTo(86);
  expect((lev.crop.y + lev.crop.height) * size.height).toBeGreaterThanOrEqual(85.5);
  expect((lev.crop.y + lev.crop.height) * size.height).toBeLessThanOrEqual(lower.y * size.height);
  expect(str.crop.y * size.height).toBeGreaterThanOrEqual((upper.y + upper.height) * size.height);
});

it("rejects real overlapping rows and fractional gaps that have no shared pixel boundary", () => {
  const size = { width: 350, height: 351 }, upper = { ...box, y: 70.5 / 351, height: 15 / 351 };
  for (const lowerStart of [84.5, 85.75]) {
    const lower = { ...box, y: lowerStart / 351, height: 15 / 351 };
    const review = buildOcrReview([discovery("REQ LEV:80", 0, upper), discovery("REQ LEV:80", 1, upper),
      discovery("REQ STR:17", 0, lower), discovery("REQ STR:17", 1, lower)]);
    const located = locateRequirementVerification(review, identity, size);
    expect(located).toHaveLength(2);
    expect(located.every(item => !item.complete)).toBe(true);
  }
});

it("combines separate same-row label and value boxes while retaining every contradictory fragment", () => {
  const evidence = observations("REQ STR:");
  for (const observation of evidence) {
    const label = observation.readings[0]; label.bounds = { ...box, width: .25 };
    observation.readings.push({ ...label, text: "17", bounds: { ...box, x: .5, width: .05 },
      provenance: { ...label.provenance!, readingId: `${observation.viewId}-value` } });
  }
  expect(verifyRequirementRecovery(target(), evidence)).toMatchObject({ status: "verified", value: 17 });
  const observation = evidence[3];
  observation.readings.push({ ...observation.readings[0], text: "60", bounds: { ...box, x: .57, width: .02 },
    provenance: { ...observation.readings[0].provenance!, readingId: "contradiction" } });
  expect(verifyRequirementRecovery(target(), evidence).status).toBe("unresolved");
});

it("preserves DB unclip expansion into known artificial padding without treating it as source clipping", () => {
  const located = target(), evidence = observations(17);
  for (const observation of evidence) {
    observation.renderBounds = { x: .18, y: .17, width: .442, height: .1 };
    observation.readings[0].bounds = { x: .196, y: .193, width: .406, height: .051 };
  }
  expect(verifyRequirementRecovery(located, evidence)).toMatchObject({ status: "verified", value: 17 });
  expect(evidence[0].readings[0].bounds!.x).toBeLessThan(located.crop.x); // raw box retained
  const sourceClipped = { ...located, complete: false };
  expect(verifyRequirementRecovery(sourceClipped, evidence).status).toBe("unresolved");
  evidence[3].readings[0].bounds = { x: .18, y: .193, width: .42, height: .051 };
  expect(verifyRequirementRecovery(located, evidence).reason).toBe("clipped-reading");
});

it("verifies all identified requirements, rejects duplicate rows, and leaves legacy reviews unchanged", () => {
  const review = buildOcrReview([discovery("REQ STR:0", 0), discovery("REQ STR:0", 1)]);
  const located = locateRequirementVerification(review, identity, { width: 1000, height: 1000 });
  expect(located).toHaveLength(1); expect(located[0].complete).toBe(true);
  expect(locateRequirementVerification(buildOcrReview([{ text: "REQ STR:17", pass: 0, bounds: box }]), identity, { width: 1000, height: 1000 })).toEqual([]);
  const duplicateReview = buildOcrReview([...review.initialReadings!, discovery("REQ STR:17", 0, { ...box, y: .4 }), discovery("REQ STR:17", 1, { ...box, y: .4 })]);
  expect(locateRequirementVerification(duplicateReview, identity, { width: 1000, height: 1000 }).every(item => !item.complete)).toBe(true);
  const clippedReview = buildOcrReview([discovery("REQ STR:17", 0, { ...box, x: 0 }), discovery("REQ STR:17", 1, { ...box, x: 0 })]);
  expect(locateRequirementVerification(clippedReview, identity, { width: 1000, height: 1000 })[0].complete).toBe(false);
});

it("invalidates automatic proof on manual edits, exclusion and text replacement", () => {
  const start = buildOcrReview([discovery("REQ STR:3", 0), discovery("REQ STR:8", 1)]);
  const finalized = applyRequirementRecovery(start, target(), observations(17));
  const edited = resolveReviewLine(finalized, "line-0", "REQ STR:60");
  expect(edited.lines[0].recovery).toBeUndefined(); expect(edited.lines[0].status).toBe("confirmed");
  expect(mapReviewedStats(edited, "corsair")).toEqual({ requiredSub: "60" });
  expect(applyRequirementRecovery(edited, target(), observations(17))).toBe(edited);
  const ignored = resolveReviewLine(finalized, "line-0", null);
  expect(ignored.lines[0].recovery).toBeUndefined(); expect(mapReviewedStats(ignored, "corsair")).toEqual({});
  expect(editedTextReview(reviewText(finalized)).lines[0].recovery).toBeUndefined();
});

it("keeps agreeing discovery values unresolved when original verification has a contradiction", () => {
  const start = buildOcrReview([discovery("REQ STR:17", 0), discovery("REQ STR:17", 1)]);
  const evidence = observations(17); evidence[3].readings[0].text = "REQ STR:60";
  const finalized = applyRequirementRecovery(start, target(), evidence);
  expect(reviewBlocked(finalized, "corsair")).toBe(true); expect(mapReviewedStats(finalized, "corsair")).toEqual({});
  const legacy = buildOcrReview([0, 1].map(pass => ({ text: "REQ STR:60", pass, bounds: box })));
  expect(applyRequirementRecovery(legacy, target(), observations(17))).toBe(legacy);
});

it("leaves default reviews without experimental proof on their existing manual override path", () => {
  const legacy = buildOcrReview([0, 1].map(pass => ({ text: "REQ STR:Q", pass, bounds: box })));
  expect(overrideReviewRequirement(legacy, "corsair", "requiredSub", "60")).toBe(legacy);
  expect(reviewBlocked(legacy, "corsair")).toBe(true);
});
