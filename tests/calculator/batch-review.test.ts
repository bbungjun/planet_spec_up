import { expect, it } from "vitest";
import { createBatchReview } from "@/features/calculator/ocr/batchReview";
import { emptyEquipment } from "@/features/calculator/domain/defaults";
import type { OcrReview } from "@/features/calculator/ocr/types";
import type { OcrDestination } from "@/features/calculator/ocr/batch";
const cape = "방랑자의 망토\n(유니크 아이템)\n장비분류: 망토\nDEX +4";
const choices = [{ slot: "cape" as const, label: "망토", equipment: emptyEquipment() }];
const context = () => ({ kind: "initial" as const, choices, reserved: new Set<OcrDestination>(), peers: [] });

it("keeps unnamed exact-image detection in initial and retry placement", () => {
  const recognition = createBatchReview("장비분류: 반지\nDEX +4", undefined, "corsair")!;
  const initial = recognition.place({ ...context(), sameImage: "" });
  expect(initial).toMatchObject({ warning: "와 동일한 이미지입니다.", included: false });
  expect(recognition.place({ ...context(), kind: "retry", previous: initial, replacedFile: false, initialBusy: false, sameImage: "" })).toMatchObject({ warning: "와 동일한 이미지입니다.", included: false });
});

it("maps, validates, excludes semantic duplicates and reserves existing empty destinations through one interface", () => {
  const recognition = createBatchReview(cape, undefined, "corsair")!;
  expect(recognition.place(context())).toMatchObject({ replacement: { mainFlat: "4" }, destination: "cape", included: true });
  expect(recognition.place({ ...context(), reserved: new Set(["cape"]) }).destination).toBe("new");
  expect(recognition.place({ ...context(), peers: [{ name: "first.png", text: cape }] })).toMatchObject({ included: false, warning: "first.png와 이름·옵션이 같은 장비입니다. 중복 여부를 확인하세요.", destination: "new" });
  expect(createBatchReview("설명 없음", undefined, "corsair")).toBeNull();
});
it("keeps equal-option rings separate while exact images take warning priority", () => {
  const text = "장비분류: 반지\nDEX +4", recognition = createBatchReview(text, undefined, "corsair")!;
  const base = { ...context(), choices: [{ slot: "ring_1" as const, label: "반지 1", equipment: emptyEquipment() }], peers: [{ name: "ring.png", text }] };
  expect(recognition.place(base)).toMatchObject({ included: true, destination: "ring_1", warning: null });
  expect(recognition.place({ ...base, sameImage: "copy.png" })).toMatchObject({ included: false, destination: "new", warning: "copy.png와 동일한 이미지입니다." });
});
it.each([["방어율 무시 +5%\n보스공격력 +10%", "chaos"], ["보스공격력 +5%", "boss"], ["총데미지 +5%", "hunting"]])("assigns weapon preset from %s", (extra, preset) => {
  expect(createBatchReview(`장비분류: 건\n공격력 +100\n${extra}`, undefined, "corsair")!.place(context()).destination).toBe(`preset:${preset}`);
});
it("uses reviewed category/mapped values and keeps unresolved questions available for correction", () => {
  const review: OcrReview = { category: "망토", lines: [{ id: "q", text: "DEX +?", status: "check", readings: [{ text: "DEX +?", pass: 0 }] }], warnings: [] };
  expect(createBatchReview("장비분류: 건", review, "corsair")!.place(context())).toMatchObject({ category: "망토", review, destination: "cape" });
});
it("preserves retry destination, label, pendant choice and need flag only for unchanged category/file", () => {
  const text = "장비분류: 펜던트\nDEX +4", recognition = createBatchReview(text, undefined, "corsair")!;
  const previous = { category: "펜던트", destination: "pendant_2" as const, label: "내 선택", pendantChoice: "horntail", needsDestination: false };
  const retry = { ...context(), kind: "retry" as const, previous, replacedFile: false, initialBusy: true };
  expect(recognition.place(retry)).toMatchObject(previous);
  expect(recognition.place({ ...retry, replacedFile: true })).toMatchObject({ destination: "new", label: "펜던트", pendantChoice: undefined, needsDestination: true });
  expect(createBatchReview(cape, undefined, "corsair")!.place(retry)).toMatchObject({ destination: "cape", label: "망토", pendantChoice: undefined, needsDestination: true });
});
it("retains the existing polearm non-weapon destination behavior rather than adding a policy", () => {
  expect(createBatchReview("장비분류: 폴암\n공격력 +100", undefined, "aran")!.place(context()).destination).toBe("new");
});
