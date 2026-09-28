import { expect, it } from "vitest";
import { buildOcrReview, mapReviewedStats, reviewBlocked } from "@/features/calculator/ocr/reviewRecognition";
import { mergeRecognitionRetry, retryRecognitionBounds, retryRecognitionLabel } from "@/features/calculator/ocr/retryRecognition";
import { tooltipHeader } from "@/features/calculator/ocr/tooltipHeader";
import { tooltipIdentity } from "@/features/calculator/ocr/batch";
import type { OcrBounds } from "@/features/calculator/ocr/types";

const pair = (text: string, bounds: OcrBounds) => [0, 1].map(pass => ({ text, bounds, pass }));
const box = { x: .39, y: .3, width: .19, height: .035 };

it("includes a detached unread digit and a nearby requirement value column, without copying a value", () => {
  const review = buildOcrReview([...pair("REQ STR:", box), ...pair("[", { x: .62, y: .303, width: .034, height: .03 }),
    ...pair("REQ LEV:80", { x: .39, y: .25, width: .28, height: .035 })]);
  const target = review.lines.find(line => line.text === "REQ STR:")!;
  const bounds = retryRecognitionBounds(review, target)!;
  expect(bounds.x).toBe(box.x);
  expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(.67);
  expect(bounds.y).toBe(box.y);
  expect(bounds.height).toBeCloseTo(box.height);
  expect(mapReviewedStats(review, "corsair")).toEqual({ requiredLevel: "80" });
  expect(reviewBlocked(review, "corsair")).toBe(true);
});

it("does not extend through another field, remote fragment or the next row", () => {
  const review = buildOcrReview([...pair("공격력:", box), ...pair("STR:+3", { x: .63, y: .3, width: .18, height: .035 }),
    ...pair("7", { x: .62, y: .38, width: .03, height: .035 }), ...pair("8", { x: .9, y: .3, width: .03, height: .035 })]);
  const bounds = retryRecognitionBounds(review, review.lines[0])!;
  expect(bounds.x + bounds.width).toBeCloseTo(.63);
  expect(bounds.height).toBeCloseTo(box.height);
});

it("recovers an unread combat option only after two matching local readings", () => {
  let review = buildOcrReview([...pair("장비분류:장갑", { ...box, y: .2 }), ...pair("공격력:", box)]);
  const target = review.lines.find(line => line.text === "공격력:")!;
  expect(retryRecognitionLabel(target)).toBe("공격력");
  expect(mergeRecognitionRetry(review, target.id, "마법 방어력:+20", 2)).toBe(review);
  review = mergeRecognitionRetry(review, target.id, "공격력:+7", 2);
  expect(reviewBlocked(review, "corsair")).toBe(true);
  expect(mergeRecognitionRetry(review, target.id, "공격력:+7", 2)).toBe(review);
  review = mergeRecognitionRetry(review, target.id, "공격력:+7", 3);
  expect(mapReviewedStats(review, "corsair")).toEqual({ attackFlat: "7" });
  expect(reviewBlocked(review, "corsair")).toBe(false);
});

it("can reread a misspelled label but never treats a spelling suggestion as numeric evidence", () => {
  let review = buildOcrReview(pair("몰스탯:+6%", box));
  const id = review.lines[0].id;
  expect(retryRecognitionLabel(review.lines[0])).toBe("올스탯");
  expect(mapReviewedStats(review, "corsair")).toEqual({});
  review = mergeRecognitionRetry(review, id, "올스탯:+6%", 2);
  expect(reviewBlocked(review, "corsair")).toBe(true);
  review = mergeRecognitionRetry(review, id, "올스탯:+6%", 3);
  expect(mapReviewedStats(review, "corsair")).toEqual({ mainPercent: "6", subPercent: "6" });
});

it("preserves numeric and percent conflicts, repeated options and crop warnings", () => {
  for (const conflict of ["DEX:+8%", "DEX:+6"]) {
    let review = buildOcrReview([{ text: "DEX:+6%", bounds: box, pass: 0 }, { text: conflict, bounds: box, pass: 1 },
      ...pair("DEX:+6%", { ...box, y: .6 })], ["원본 범위 확인"]);
    const id = review.lines[0].id;
    for (const pass of [2, 3, 4, 5]) review = mergeRecognitionRetry(review, id, "DEX:+6%", pass);
    expect(mapReviewedStats(review, "corsair")).toEqual({ mainPercent: "6" });
    expect(reviewBlocked(review, "corsair")).toBe(true);
    expect(review.lines[0].readings.some(reading => reading.text === conflict)).toBe(true);
    expect(review.warnings).toEqual(["원본 범위 확인"]);
  }
});

it("does not hide a contradictory number or missing percent behind a misspelled label", () => {
  for (const original of ["몰스탯:+696", "몰스탯:+8%", "몰스탯:+6"]) {
    let review = buildOcrReview(pair(original, box));
    const id = review.lines[0].id;
    for (const pass of [2, 3, 4, 5]) review = mergeRecognitionRetry(review, id, "올스탯:+6%", pass);
    expect(reviewBlocked(review, "corsair")).toBe(true);
    expect(mapReviewedStats(review, "corsair")).toEqual({});
    expect(review.lines[0].readings.some(reading => reading.text === original)).toBe(true);
  }
});

it("does not reclassify a requirement with a lost prefix as a bonus stat", () => {
  const review = buildOcrReview([...pair("STR:80", box), ...pair("장비분류:장갑", { ...box, y: .6 })]);
  expect(mergeRecognitionRetry(review, review.lines[0].id, "STR:80", 2)).toBe(review);
  expect(mapReviewedStats(review, "corsair")).toEqual({});
});

it("reads non-potential item titles only next to an explicit header marker", () => {
  const text = "달 토끼 견장 (+1)\n잠재능력 설정 불가\nREQ LEV:15\n장비분류:어깨장식\n공격력:+5";
  expect(tooltipIdentity(text).name).toBe("달 토끼 견장 (+1)");
  expect(tooltipHeader("2026년 10월까지 사용가능\n잠재능력 설정 불가")).toBeNull();
  expect(tooltipHeader("REQ STR:0\n잠재능력 설정 불가")).toBeNull();
  expect(tooltipHeader("장비분류:장갑\n공격력:+5")).toBeNull();
});
