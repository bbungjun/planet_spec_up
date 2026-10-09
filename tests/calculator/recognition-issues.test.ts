import { expect, it } from "vitest";
import { agreedLiteralValue, classifyRecognitionIssues, literalOptionValue } from "@/features/calculator/ocr/recognitionIssues";
import type { OcrReview, OcrReviewLine } from "@/features/calculator/ocr/types";

const line = (...texts: string[]): OcrReviewLine => ({ id: "row", text: texts[0], status: "check",
  bounds: { x: .1, y: .2, width: .6, height: .03 }, readings: texts.map((text, pass) => ({ text, pass })) });
const review = (row: OcrReviewLine): OcrReview => ({ category: null, warnings: [], lines: [row] });
it("separates a literal value from an unknown label without normalizing letters into digits", () => {
  expect(literalOptionValue("미식별 : +6% ")).toMatchObject({ labelText: "미식별", value: 6, percent: true });
  expect(literalOptionValue("DEX +6")).toMatchObject({ value: 6, percent: false });
  for (const invalid of ["DEX:+8O", "DEX:+Q", "DEX:+6% 7", "DEX:+", "DEX: -6", "6%", "DEX 6", "DEX:3+6%", "DEX+3+6%"]) {
    expect(literalOptionValue(invalid)).toBeNull();
  }
});
it("diagnoses name, value and unit failures independently and preserves the input", () => {
  const r = review(line("미식별:+8%", "미식별:+80")), before = structuredClone(r);
  expect(classifyRecognitionIssues(r).map(x => x.code)).toEqual(["label-unreadable", "value-conflict", "unit-conflict", "source-unavailable"]);
  expect(r).toEqual(before);
});
it("does not discard malformed numeric evidence or duplicate one pass to make agreement", () => {
  expect(agreedLiteralValue(line("미식별:+6%", "다른이름:+6%"))).toMatchObject({ value: 6, percent: true });
  expect(agreedLiteralValue(line("미식별:+6%", "미식별:+6Q"))).toBeNull();
  expect(agreedLiteralValue(line("미식별:+6%", "미식별:+6"))).toBeNull();
  expect(agreedLiteralValue(line("미식별:+6%", "미식별:+60%"))).toBeNull();
  const duplicate = line("미식별:+6%", "미식별:+6%");duplicate.readings[1].pass=0;
  expect(agreedLiteralValue(duplicate)).toBeNull();
});
it("does not misdiagnose a known label as unreadable merely because its number is missing", () => {
  expect(classifyRecognitionIssues(review(line("DEX:+Q", "DEX:+Q"))).map(x => x.code))
    .toEqual(["value-unreadable", "source-unavailable"]);
  expect(classifyRecognitionIssues(review(line("REQ STR:Q", "REQ STR:Q"))).map(x => x.code))
    .toEqual(["value-unreadable", "source-unavailable"]);
});
it("classifies a missing mandatory percent as a unit issue, not an unknown label", () => {
  expect(classifyRecognitionIssues(review(line("보스데미지:+6", "보스데미지:+6"))).map(x => x.code))
    .toEqual(["unit-unreadable", "source-unavailable"]);
});
it("separates conflicting known labels from agreement on their numbers", () => {
  expect(classifyRecognitionIssues(review(line("DEX:+6%", "STR:+6%"))).map(x=>x.code))
    .toEqual(["label-conflict","source-unavailable"]);
});
it("does not reclassify user-owned rows and records retry execution failures separately", () => {
  const r = review({ ...line("미식별:+6%"), status: "confirmed" });
  expect(classifyRecognitionIssues(r)).toEqual([]);
  r.recoveryObservations = [{ sourceId: "a", operationId: "b", lineId: "row", viewId: "c", mode: "color", scale: 3,
    bounds: { x: 0, y: 0, width: 1, height: 1 }, status: "failed", readings: [], reason: "recognition-failed" }];
  expect(classifyRecognitionIssues(r)).toEqual([expect.objectContaining({ code: "runtime-failed", detail: "recognition-failed" })]);
});
