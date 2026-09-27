import { expect, it } from "vitest";
import { buildOcrReview, mapReviewedStats, reviewBlocked, reviewQuestions } from "@/features/calculator/ocr/reviewRecognition";
import { mergeRequirementRetry, retryRequirementLabel } from "@/features/calculator/ocr/retryRequirements";

function review(first = "REQ STR : Q", second = "REQ STA : Q") {
  return buildOcrReview([first, second].map((text, pass) => ({ text, pass, bounds: { x: .4, y: .2, width: .3, height: .025 } })));
}

it("requires two distinct numeric readings before accepting an unread requirement", () => {
  const start = review(), id = start.lines[0].id;
  expect(retryRequirementLabel(start.lines[0])).toBe("STR");
  const once = mergeRequirementRetry(start, id, "REQ STR : 0", 2);
  expect(reviewBlocked(once, "corsair")).toBe(true);
  expect(mergeRequirementRetry(once, id, "REQ STR : 0", 2)).toBe(once);
  const agreed = mergeRequirementRetry(once, id, "REQ STA : 0", 3);
  expect(mapReviewedStats(agreed, "corsair")).toEqual({ requiredSub: "0" });
  expect(reviewBlocked(agreed, "corsair")).toBe(false);
  expect(retryRequirementLabel(agreed.lines[0])).toBeNull();
});

it("never outvotes a conflicting number with repeated identical retry results", () => {
  let result = review("REQ STR : 60", "REQ STR : BO");
  for (const pass of [2, 3, 4, 5]) result = mergeRequirementRetry(result, result.lines[0].id, "REQ STR : 80", pass);
  expect(mapReviewedStats(result, "corsair")).toEqual({});
  expect(reviewQuestions(result, "corsair")).toHaveLength(1);
  expect(result.lines[0].reason).toContain("다르게");
});

it("rejects different fields, unread glyphs, malformed numbers, and irrelevant requirements", () => {
  const start = review(), id = start.lines[0].id;
  for (const text of ["REQ LEV : 0", "STR +0", "REQ STR : Q", "REQ STR : 8Q", "REQ STR : -1", "REQ STR : 80%"])
    expect(mergeRequirementRetry(start, id, text, 2)).toBe(start);
  expect(retryRequirementLabel(review("REQ INT : Q", "REQ INT : Q").lines[0])).toBeNull();
  expect(retryRequirementLabel(review("REQ DEX : Q", "REQ DEX : Q").lines[0])).toBe("DEX");
  expect(retryRequirementLabel(buildOcrReview([{ text: "REQ STR : O", pass: 0 }]).lines[0])).toBeNull();
});

it("preserves unrelated options, crop warnings, and the original evidence bounds", () => {
  const start = review();
  start.warnings = ["원본 범위 확인"];
  start.lines.push(...buildOcrReview([0, 1].map(pass => ({ text: "DEX +6%", pass, bounds: { x: .1, y: .8, width: .3, height: .025 } }))).lines.map(l => ({ ...l, id: "potential" })));
  const next = mergeRequirementRetry(mergeRequirementRetry(start, start.lines[0].id, "REQ STR:0", 2), start.lines[0].id, "REQ STR:0", 3);
  expect(mapReviewedStats(next, "corsair")).toEqual({ requiredSub: "0", mainPercent: "6" });
  expect(next.warnings).toEqual(start.warnings);
  expect(next.lines[0].bounds).toEqual(start.lines[0].bounds);
  expect(next.lines[1]).toBe(start.lines[1]);
});
