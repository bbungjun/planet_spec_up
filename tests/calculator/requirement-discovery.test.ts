import { expect, it } from "vitest";
import { discoverRequirementRows } from "@/features/calculator/ocr/requirementDiscovery";
import { buildOcrReview, mapReviewedStats, overrideReviewRequirement, resolveReviewLine, reviewBlocked, reviewQuestions } from "@/features/calculator/ocr/reviewRecognition";
import { mergeRecognitionRetry, retryRecognitionBounds, retryRecognitionLabel } from "@/features/calculator/ocr/retryRecognition";
import { classifyRecognitionIssues } from "@/features/calculator/ocr/recognitionIssues";
import { parseTooltipOption } from "@/features/calculator/ocr/parseMapleTooltip";
import type { OcrBounds } from "@/features/calculator/ocr/types";

const box: OcrBounds = { x: .4, y: .2, width: .3, height: .025 };
const pair = (text: string, bounds = box) => [0, 1].map(pass => ({ text, pass, bounds }));
const category = () => pair("장비분류: 모자", { x: .1, y: .5, width: .4, height: .03 });
const start = (text: string) => buildOcrReview([...pair(text), ...category()]);

it.each(["FEQ STR : 0", "FIEQ STR : Q", "REQ LE! : 80", "FEQ LEU : 80"])("discovers %s without broadening the value parser", text => {
  expect(parseTooltipOption(text)).toBeNull();
  const review = start(text), row = review.lines[0];
  expect(row.status).toBe("check");
  expect(retryRecognitionLabel(row)).toBe(text.includes("STR") ? "STR" : "LEV");
  expect(mapReviewedStats(review, "corsair")).toEqual({});
  expect(reviewBlocked(review, "corsair")).toBe(true);
  expect(classifyRecognitionIssues(review)).toContainEqual(expect.objectContaining({ code: "requirement-unreadable", lineId: row.id }));
});

it("requires a header location or a nearby known requirement column", () => {
  for (const text of ["ITEM LEV : 80", "STR +80", "2026년 10월까지 사용가능", "공격력 증가량 80", "FREQ STR : 80"])
    expect(start(text).lines[0].suspectedRequirement).toBeUndefined();
  expect(buildOcrReview(pair("FEQ STR : 0")).lines[0].suspectedRequirement).toBeUndefined();
  const body = buildOcrReview([...category(), ...pair("FEQ STR : 0", { ...box, y: .7 })]);
  expect(body.lines.find(l => l.text.startsWith("FEQ"))?.suspectedRequirement).toBeUndefined();
  const neighbor = buildOcrReview([...pair("REQ LEV : 80", { ...box, y: .15 }), ...pair("FEQ STR : 0")]);
  expect(neighbor.lines.find(l => l.text.startsWith("FEQ"))?.suspectedRequirement?.labels).toEqual(["STR"]);
});

it("does not reopen a requirement already recovered by the existing review policy", () => {
  let review = buildOcrReview([{ ...pair("REQ LE! : 80")[0] }, { ...pair("REQ LEU : 80")[1] }, ...category()]);
  const id = review.lines[0].id;
  expect(review.lines[0].suspectedRequirement).toBeUndefined();
  review = mergeRecognitionRetry(review, id, "REQ LEV : 80", 2);
  expect(mapReviewedStats(review, "corsair").requiredLevel).toBe("80");
  expect(discoverRequirementRows(review.lines)).toEqual(review.lines);
});

it("keeps unsupported and other-job requirement hints out of unrelated questions", () => {
  for (const text of ["FIEQ INT : Q", "FEQ LUK : Q"]) {
    const review = start(text);
    expect(review.lines[0].status).toBe("check");
    expect(reviewQuestions(review, "corsair")).toEqual([]);
    expect(retryRecognitionLabel(review.lines[0])).toBeNull();
  }
  const dex = start("FEQ DEX : 0");
  expect(reviewQuestions(dex, "corsair")).toEqual([]);
  expect(reviewQuestions(dex, "aran")).toHaveLength(1);
});

it("does not choose between ambiguous fields or recover one from an unrelated reread", () => {
  const review = start("FEQ LEX : 80"), row = review.lines[0];
  expect(row.suspectedRequirement?.labels).toEqual(["LEV", "DEX"]);
  expect(retryRecognitionLabel(row)).toBeNull();
  expect(mergeRecognitionRetry(review, row.id, "REQ LEV : 80", 2)).toBe(review);
});

it("recovers literal digits only after two actual readings of the requirement name", () => {
  let review = start("FEQ STR : 40");
  const id = review.lines[0].id, original = JSON.stringify(review);
  review = mergeRecognitionRetry(review, id, "REQ STR : 40", 2);
  expect(mapReviewedStats(review, "corsair")).toEqual({});
  expect(mergeRecognitionRetry(review, id, "REQ STR : 40", 2)).toBe(review);
  review = mergeRecognitionRetry(review, id, "REQ STR : 40", 3);
  expect(mapReviewedStats(review, "corsair")).toEqual({ requiredSub: "40" });
  expect(reviewBlocked(review, "corsair")).toBe(false);
  expect(review.lines[0].readings.slice(0, 2).map(r => r.text)).toEqual(["FEQ STR : 40", "FEQ STR : 40"]);
  expect(JSON.stringify(start("FEQ STR : 40"))).toBe(original);
});

it.each(["FEQ STR : Q", "FEQ STR : O", "FEQ STR : 4O", "FEQ STR : 40%", "FEQ STR : 4 0", "FEQ STR :"])("does not overwrite incomplete original digits in %s", text => {
  let review = start(text); const id = review.lines[0].id;
  for (const pass of [2, 3, 4, 5]) review = mergeRecognitionRetry(review, id, "REQ STR : 40", pass);
  expect(reviewBlocked(review, "corsair")).toBe(true);
  expect(mapReviewedStats(review, "corsair")).toEqual({});
});

it.each(["REQ STR : 4", "REQ DEX : 40", "STR : 40", "REQ STR : Q", ""])("retains the veto from retry evidence %s", conflict => {
  let review = start("FEQ STR : 40"); const id = review.lines[0].id;
  review = mergeRecognitionRetry(review, id, conflict, 2);
  review = mergeRecognitionRetry(review, id, "REQ STR : 40", 3);
  review = mergeRecognitionRetry(review, id, "REQ STR : 40", 4);
  expect(reviewBlocked(review, "corsair")).toBe(true);
  expect(review.lines[0].readings.some(r => r.text === conflict)).toBe(true);
});

it("retains a contradictory number even when only the damaged label carried it", () => {
  let review = buildOcrReview([{ ...pair("FEQ STR : 40")[0] }, { ...pair("FIEQ STR : 41")[1] }, ...category()]);
  const id = review.lines[0].id;
  for (const pass of [2, 3]) review = mergeRecognitionRetry(review, id, "REQ STR : 40", pass);
  expect(mapReviewedStats(review, "corsair")).toEqual({});
  expect(reviewBlocked(review, "corsair")).toBe(true);
});

it("respects neighboring suspected columns and never borrows the next row's value", () => {
  const review = buildOcrReview([...pair("FEQ STR :", { ...box, width: .15 }),
    ...pair("FEQ DEX : 50", { ...box, x: .62, width: .25 }),
    ...pair("80", { x: .57, y: .3, width: .05, height: .02 }), ...category()]);
  const bounds = retryRecognitionBounds(review, review.lines[0])!;
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(.62);
  expect(bounds.y).toBe(box.y);
  expect(bounds.height).toBeCloseTo(box.height);
});

it("allows explicit correction or exclusion and never overwrites it with later recovery", () => {
  const review = start("FEQ STR : Q"), id = review.lines[0].id;
  for (const value of ["40", ""]) {
    const edited = overrideReviewRequirement(review, "corsair", "requiredSub", value)!;
    expect(reviewBlocked(edited, "corsair")).toBe(false);
    expect(edited.lines[0].suspectedRequirement).toBeUndefined();
    expect(mergeRecognitionRetry(edited, id, "REQ STR : 0", 2)).toBe(edited);
    expect(discoverRequirementRows(edited.lines)).toEqual(edited.lines);
  }
  const ignored = resolveReviewLine(review, id, null);
  expect(ignored.lines[0].readings).toEqual(review.lines[0].readings);
});
