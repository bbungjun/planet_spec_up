import { expect, it } from "vitest";
import { applyStatReplacement } from "@/features/calculator/ocr/applyStatReplacement";
import { emptyEquipment } from "@/features/calculator/domain/defaults";
import { buildOcrReview, editedTextReview, joinSpatialReadings, mapReviewedStats, resolveReviewLine, reviewBlocked, reviewQuestions, suggestReviewOptions } from "@/features/calculator/ocr/reviewRecognition";
import { parseMapleTooltip, parseTooltipOption } from "@/features/calculator/ocr/parseMapleTooltip";
import type { OcrReading } from "@/features/calculator/ocr/types";

function line(text: string, y: number, pass: number, confidence = 90): OcrReading {
  return { text, pass, confidence, bounds: { x: .03, y, width: .55, height: .025 } };
}
function pair(text: string, y: number) { return [line(text, y, 0), line(text, y + .001, 1)]; }

it("suggests a nearby option name for review without changing digits, percent or saved stats", () => {
  const review = buildOcrReview(pair("홀스탯 +696", .5));
  expect(suggestReviewOptions(review.lines[0])).toEqual(["올스탯 +696"]);
  expect(reviewBlocked(review, "corsair")).toBe(true);
  expect(mapReviewedStats(review, "corsair")).toEqual({});
  expect(suggestReviewOptions(buildOcrReview(pair("몰스탯 +6%", .5)).lines[0])).toEqual(["올스탯 +6%"]);
  expect(suggestReviewOptions(buildOcrReview(pair("HP +100", .5)).lines[0])).toEqual([]);
});

it("matches an option despite different bullet glyphs and still blocks conflicting numbers", () => {
  const agreed = buildOcrReview([line(".DEX:+7%", .5, 0), line("_ DEX: +7%", .501, 1)]);
  expect(mapReviewedStats(agreed, "corsair")).toEqual({ mainPercent: "7" });
  expect(reviewBlocked(agreed, "corsair")).toBe(false);
  const conflict = buildOcrReview([line(".DEX:+7%", .5, 0), line("_ DEX: +704", .501, 1)]);
  expect(reviewBlocked(conflict, "corsair")).toBe(true);
  expect(mapReviewedStats(conflict, "corsair")).toEqual({});
});

it("accepts matching colon/semicolon bullets without weakening number and percent conflicts", () => {
  const agreed = buildOcrReview([line(": DEX: +6%", .5, 0), line(". DEX: +6%", .501, 1),
    line("； STR: +3", .6, 0), line("· STR: +3", .601, 1)]);
  expect(mapReviewedStats(agreed, "corsair")).toEqual({ mainPercent: "6", subFlat: "3" });
  expect(reviewBlocked(agreed, "corsair")).toBe(false);
  for (const alternative of ["DEX +6", "DEX +8%"]) {
    const conflict = buildOcrReview([line(": DEX: +6%", .5, 0), line(alternative, .501, 1)]);
    expect(reviewBlocked(conflict, "corsair")).toBe(true);
    expect(mapReviewedStats(conflict, "corsair")).toEqual({});
  }
});

it("blocks a percent-to-integer conflict while keeping the independently read flat stats", () => {
  const review = buildOcrReview([
    ...pair("장비분류: 장갑", .4), ...pair("DEX +3", .45), ...pair("DEX +10", .8), ...pair("DEX +9%", .7),
    line("DEX +604", .75, 0), line("DEX +6%", .751, 1),
  ]);
  expect(mapReviewedStats(review, "corsair")).toEqual({ mainFlat: "13", mainPercent: "9" });
  expect(reviewBlocked(review, "corsair")).toBe(true);
  const questions = reviewQuestions(review, "corsair");
  expect(questions).toHaveLength(1);
  const corrected = resolveReviewLine(review, questions[0].id, "DEX +6%");
  expect(reviewBlocked(corrected, "corsair")).toBe(false);
  expect(mapReviewedStats(corrected, "corsair")).toEqual({ mainFlat: "13", mainPercent: "15" });
});

it("requires a human check for large flat stats even when two OCR passes agree", () => {
  const review = buildOcrReview(pair("DEX +604", .6));
  expect(reviewBlocked(review, "corsair")).toBe(true);
  expect(mapReviewedStats(review, "corsair")).toEqual({});
  const confirmed = resolveReviewLine(review, review.lines[0].id, "DEX +604");
  expect(mapReviewedStats(confirmed, "corsair")).toEqual({ mainFlat: "604" });
});

it("uses line positions to preserve genuine repeated potentials without counting passes twice", () => {
  const review = buildOcrReview([...pair("DEX +9%", .7), ...pair("DEX +6%", .75), ...pair("DEX +6%", .8)]);
  expect(review.lines).toHaveLength(3);
  expect(mapReviewedStats(review, "corsair")).toEqual({ mainPercent: "21" });
});

it("flags unknown potential text and restores all-stat effects only after explicit correction", () => {
  const review = buildOcrReview([...pair("DEX +9%", .7), line("EAE : +696", .75, 0), line("몰스택 +66", .751, 1)]);
  expect(reviewBlocked(review, "corsair")).toBe(true);
  const corrected = resolveReviewLine(review, reviewQuestions(review, "corsair")[0].id, "올스탯 +6%");
  expect(mapReviewedStats(corrected, "corsair")).toEqual({ mainPercent: "15", subPercent: "6" });
});

it("joins nearby split labels/values using coordinates without joining unrelated distant lines", () => {
  const fragments = [line("STR:", .5, 0), line("+6", .53, 0), line("DEX", .6, 0), line("+9", .85, 0)];
  const joined = joinSpatialReadings(fragments);
  expect(joined[0].text).toBe("STR: +6");
  expect(joined).toHaveLength(3);
  const review = buildOcrReview([...fragments, line("STR +6", .51, 1)]);
  expect(mapReviewedStats(review, "corsair").subFlat).toBe("6");
});

it("preserves unrecognized saved fields and distinguishes explicit zero", () => {
  const old = { ...emptyEquipment(), mainFlat: "20", subFlat: "9", mainPercent: "12", attackFlat: "5" };
  const review = buildOcrReview(pair("DEX +25", .5));
  expect(applyStatReplacement(old, mapReviewedStats(review, "corsair"))).toMatchObject({ mainFlat: "25", subFlat: "9", mainPercent: "12", attackFlat: "5" });
  expect(applyStatReplacement(old, { subFlat: undefined })).toEqual(old);
  const cleared = editedTextReview("DEX +0");
  expect(applyStatReplacement(old, mapReviewedStats(cleared, "corsair")).mainFlat).toBe("0");
});

it("handles safe punctuation/category spelling without repairing ambiguous numbers", () => {
  expect(parseTooltipOption("DEX +4%;")).toMatchObject({ label: "DEX", value: 4, percent: true });
  expect(parseMapleTooltip("참비분류 : 멀굴장식").category).toBe("얼굴장식");
  expect(parseMapleTooltip("창비분류: 망토").category).toBe("망토");
  expect(parseTooltipOption("DEX.446%")).toBeNull();
  expect(parseTooltipOption("총데미지 +996")).toBeNull();
});

it("requires explicit image coverage confirmation when the crop may be incomplete", () => {
  const review = buildOcrReview(pair("DEX +9%", .6), ["사진 끝 확인"]);
  expect(reviewBlocked(review, "corsair")).toBe(true);
  expect(reviewBlocked({ ...review, imageConfirmed: true }, "corsair")).toBe(false);
});

it("normalizes a misread REQ LEU label without inventing or changing digits",()=>{
  expect(parseTooltipOption("REQ LEU : 120")).toMatchObject({label:"LEV",value:120,requirement:true});
  expect(parseTooltipOption("REQ STR : Q")).toBeNull();
  const review=buildOcrReview([line("REQ LEU : 120",.15,0),line("REQ LEV : 120",.151,1),...pair("REQ STR : 0",.2)]);
  expect(mapReviewedStats(review,"corsair")).toEqual({requiredLevel:"120",requiredSub:"0"});
  expect(reviewBlocked(review,"corsair")).toBe(false);
});
it("joins split level/value fragments and rejects conflicting requirement numbers",()=>{
  const parts=[line("REQ LEU :",.15,0),line("120",.17,0),line("REQ LEVEL : 120",.151,1)];
  expect(mapReviewedStats(buildOcrReview(parts),"corsair")).toEqual({requiredLevel:"120"});
  const review=buildOcrReview([line("REQ LEU : 120",.15,0),line("REQ LEV : 170",.151,1)]);
  expect(mapReviewedStats(review,"corsair")).toEqual({});expect(reviewBlocked(review,"corsair")).toBe(true);
  const corrected=resolveReviewLine(review,review.lines[0].id,"REQ LEV : 120");
  expect(mapReviewedStats(corrected,"corsair")).toEqual({requiredLevel:"120"});expect(reviewBlocked(corrected,"corsair")).toBe(false);
});

it("keeps unread REQ digits in OCR review without blocking irrelevant job requirements",()=>{
  const unread=buildOcrReview([...pair("REQ STR : Q",.15),...pair("장비분류: 건",.4)]);
  expect(reviewBlocked(unread,"corsair")).toBe(true);expect(mapReviewedStats(unread,"corsair").requiredSub).toBeUndefined();
  const corrected=resolveReviewLine(unread,reviewQuestions(unread,"corsair")[0].id,"REQ STR : 0");
  expect(mapReviewedStats(corrected,"corsair").requiredSub).toBe("0");expect(reviewBlocked(corrected,"corsair")).toBe(false);
  expect(reviewBlocked(buildOcrReview([...pair("REIQ INT : O",.15),...pair("REQ LUK : Q",.2)]),"corsair")).toBe(false);
});

it("uses the same requirement labels for parsing and missing-digit review", () => {
  const correct = buildOcrReview([line("REQ LEW : 75", .1, 0), line("REQ LEV : 75", .101, 1),
    line("REQ STA: : 80", .2, 0), line("REQ STR! : 80", .201, 1)]);
  expect(mapReviewedStats(correct, "corsair")).toEqual({ requiredLevel: "75", requiredSub: "80" });
  expect(reviewBlocked(correct, "corsair")).toBe(false);
  const wrong = buildOcrReview([...pair("REQ LEW : BQ", .1), ...pair("REQ STA : Q", .2)]);
  expect(reviewQuestions(wrong, "corsair")).toHaveLength(2);
  expect(mapReviewedStats(wrong, "corsair")).toEqual({});
  expect(parseTooltipOption("REQ STR80")).toMatchObject({ label: "STR", value: 80, requirement: true });
  for (const value of ["BQ", "1CI0", "Q", "IO", "80%", "80 0", "-80", ".80", "8.0"]) expect(parseTooltipOption(`REQ STR: ${value}`)).toBeNull();
});

it("does not pair a distant horizontal artifact with the matching potential line", () => {
  const review = buildOcrReview([line("DEX +9%", .8, 0),
    { ...line("A", .79, 1), bounds: { x: .86, y: .79, width: .05, height: .025 } }, line("DEX +9%", .801, 1),
    ...pair("DEX +6%", .85)]);
  expect(mapReviewedStats(review, "corsair")).toEqual({ mainPercent: "15" });
  expect(reviewBlocked(review, "corsair")).toBe(false);
});

it("blocks a known option whose digits vanished instead of silently treating it as absent", () => {
  for (const text of ["·보스 공격 시 데미지", "공격력 :", "올스탯 : +Q%", "DEX : +Q"]) {
    const review = buildOcrReview([...pair("장비분류: 건", .4), ...pair(text, .8)]);
    expect(reviewQuestions(review, "corsair")).toHaveLength(1);
    expect(mapReviewedStats(review, "corsair")).toEqual({});
  }
  expect(reviewBlocked(buildOcrReview(pair("공격속도:빠름", .7)), "corsair")).toBe(false);
});

it("preserves raw evidence, distinct-pass agreement, and conflicts after numeric normalization", () => {
  expect(parseTooltipOption("REQ STR : O")).toMatchObject({ label: "STR", value: 0, requirement: true, raw: "REQ STR : O" });
  const agreed = buildOcrReview([line("REQ STR : O", .1, 0), line("REQ STR : 0", .101, 1)]);
  expect(mapReviewedStats(agreed, "corsair")).toEqual({ requiredSub: "0" });
  expect(reviewBlocked(agreed, "corsair")).toBe(false);
  expect(agreed.lines[0].readings[0].text).toBe("REQ STR : O");
  expect(reviewBlocked(buildOcrReview([line("REQ STR : O", .1, 0)]), "corsair")).toBe(true);
  for (const conflicting of ["1", "17", "80"]) {
    const review = buildOcrReview([line("REQ STR : O", .1, 0), line(`REQ STR : ${conflicting}`, .101, 1)]);
    expect(reviewBlocked(review, "corsair")).toBe(true);
    expect(mapReviewedStats(review, "corsair")).toEqual({});
  }
  for (const text of ["REQ LEV : Q", "REQ DEX : I", "STR +O", "공격력 +O", "REQ STR : IO", "REQ STR :"])
    expect(parseTooltipOption(text)).toBeNull();
});

it("treats the value after a known numeric field delimiter as numeric and keeps percent units", () => {
  for (const text of ["STR : 00", "STR : OO", "STR : +OO"]) expect(parseTooltipOption(text)).toMatchObject({ label: "STR", value: 0, percent: false });
  for (const text of ["REQ LEV : BO", "REQ LEV : 8O", "REQ STR : 8O"]) expect(parseTooltipOption(text)).toMatchObject({ value: 80, requirement: true });
  expect(parseTooltipOption("REQ STR : 1O0")).toMatchObject({ value: 100, requirement: true });
  expect(parseTooltipOption("DEX : +B% ")).toMatchObject({ label: "DEX", value: 8, percent: true });
  expect(parseTooltipOption("공격력 : 1O0")).toMatchObject({ label: "공격력", value: 100, percent: false });
  expect(parseMapleTooltip("장비분류: 건").category).toBe("건");
  for (const text of ["공격속도: 빠름", "알수없는옵션: BO", "알수없는옵션 +BO", "REQ LEV : 8O%", "DEX : Q", "DEX :", "보스공격력 : 3O", "STR : 8 O"])
    expect(parseTooltipOption(text)).toBeNull();
  const agreed = buildOcrReview([line("REQ LEV : BO", .1, 0), line("REQ LEV : 8O", .101, 1)]);
  expect(mapReviewedStats(agreed, "corsair")).toEqual({ requiredLevel: "80" });
  const conflict = buildOcrReview([line("REQ STR : BO", .1, 0), line("REQ STR : 60", .101, 1)]);
  expect(reviewBlocked(conflict, "corsair")).toBe(true);
  expect(mapReviewedStats(conflict, "corsair")).toEqual({});
});

it("joins a split REQ prefix by row geometry before interpreting colon-delimited stats", () => {
  const review = buildOcrReview([
    { text: "REQ!", pass: 0, bounds: { x: .38, y: .2, width: .1, height: .035 } },
    { text: "STR : BO", pass: 0, bounds: { x: .47, y: .201, width: .17, height: .035 } },
    { text: "STR : 8O", pass: 1, bounds: { x: .47, y: .2, width: .17, height: .035 } },
    { text: "REQ", pass: 1, bounds: { x: .38, y: .201, width: .1, height: .035 } },
    ...pair("장비분류: 장갑", .5), ...pair("STR : 00", .6),
  ]);
  expect(mapReviewedStats(review, "corsair")).toEqual({ requiredSub: "80", subFlat: "0" });
  expect(reviewBlocked(review, "corsair")).toBe(false);
  const missingPrefix = buildOcrReview([...pair("STR : 80", .2), ...pair("장비분류: 장갑", .5), ...pair("STR : +5", .6)]);
  expect(mapReviewedStats(missingPrefix, "corsair")).toEqual({ subFlat: "5" });
  expect(reviewBlocked(missingPrefix, "corsair")).toBe(true);
});
