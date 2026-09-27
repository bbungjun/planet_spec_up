import { afterEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { applyOcrBatch, existingDuplicate, imageFingerprint, tooltipIdentity } from "@/features/calculator/ocr/batch";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { calculateDamageResult } from "@/features/calculator/domain/calculate";
import { parseMapleTooltip } from "@/features/calculator/ocr/parseMapleTooltip";
import { mapRecognizedStats } from "@/features/calculator/ocr/mapRecognizedStats";
import { RING_SLOTS } from "@/features/calculator/domain/slots";

afterEach(() => vi.unstubAllGlobals());

it("detects identical image contents even when the filenames differ", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const first = await imageFingerprint(new File(["same image bytes"], "a.png"));
  expect(first).toHaveLength(64);
  expect(await imageFingerprint(new File(["same image bytes"], "copy.png"))).toBe(first);
  expect(await imageFingerprint(new File(["different bytes"], "a.png"))).not.toBe(first);
});

it("compares complete options and item names, not only equipment categories", () => {
  const a = "연금술사의 반지\n(유니크 아이템)\n장비분류: 반지\nDEX +1\nDEX +3%\nDEX +3%";
  const b = "연금술사의 반지\n(유니크 아이템)\n장비분류: 반지\nDEX +3%\nDEX : +1\nDEX +3%";
  expect(tooltipIdentity(a).signature).toBe(tooltipIdentity(b).signature);
  expect(tooltipIdentity(a).signature).not.toBe(tooltipIdentity(a.replace("DEX +1", "DEX +4")).signature);
  expect(tooltipIdentity(a).signature).not.toBe(tooltipIdentity(a.replace("연금술사의 반지", "다른 반지")).signature);
  expect(tooltipIdentity("장비분류: 반지").signature).toBeNull();
});

it("applies multiple new and existing gear records atomically without losing earlier additions", () => {
  const input = createDefaultInput("corsair");
  const make = (text: string) => mapRecognizedStats(parseMapleTooltip(text), "corsair");
  const entries = [
    {destination: "weapon" as const, label: "무기", replacement: make("공격력 +100")},
    {destination: "new" as const, label: "어깨장식", replacement: make("공격력 +5")},
    {destination: "new" as const, label: "벨트", replacement: make("DEX +10")},
  ];
  const result = applyOcrBatch(input, "corsair", entries);
  expect(result.error).toBeNull();
  expect(result.input!.customSlots).toHaveLength(2);
  expect(calculateDamageResult(result.input!).totalAttack).toBe(130); // gear 105 + guild 5 + projectile 20
  expect(input.customSlots).toBeUndefined();
  const invalid = applyOcrBatch(input, "corsair", [entries[1], entries[0], entries[0]]);
  expect(invalid.input).toBeNull();
  expect(invalid.error).toContain("적용 위치가 같습니다");
  expect(input.equipment.weapon!.attackFlat).toBe("");
  expect(applyOcrBatch(input, "night_lord", entries).input).toBeNull();
});

it("flags matching existing gear values only within a matching equipment category", () => {
  const input = createDefaultInput("corsair");
  input.equipment.weapon!.attackFlat = "100";
  const choices = [{slot: "weapon" as const, label: "무기", equipment: input.equipment.weapon!}];
  expect(existingDuplicate(parseMapleTooltip("장비분류: 건\n공격력 +100"), "corsair", choices)).toContain("이미 입력된 무기");
  expect(existingDuplicate(parseMapleTooltip("장비분류: 장갑\n공격력 +100"), "corsair", choices)).toBeNull();
});

it("keeps four equal rings distinct in calculation and rejects a fifth or a non-ring destination atomically", () => {
  const input = createDefaultInput("corsair");
  const replacement = mapRecognizedStats(parseMapleTooltip("장비분류: 반지\nDEX +5\nDEX +6%\nSTR +1"), "corsair");
  const entries = RING_SLOTS.map(destination => ({ destination, label: "반지", category: "반지", replacement }));
  const result = applyOcrBatch(input, "corsair", entries);
  expect(result.error).toBeNull();
  expect(RING_SLOTS.reduce((sum, slot) => sum + Number(result.input!.equipment[slot]!.mainFlat), 0)).toBe(20);
  expect(RING_SLOTS.reduce((sum, slot) => sum + Number(result.input!.equipment[slot]!.mainPercent), 0)).toBe(24);
  expect(existingDuplicate(parseMapleTooltip("장비분류: 반지\nDEX +5\nDEX +6%\nSTR +1"), "corsair",
    RING_SLOTS.map(slot => ({ slot, label: "반지", equipment: result.input!.equipment[slot]! })))).toBeNull();
  for (const destination of ["new", "hat"] as const) {
    const invalid = applyOcrBatch(input, "corsair", [...entries, { destination, label: "다른 이름", category: "반지", replacement }]);
    expect(invalid.input).toBeNull();
    expect(invalid.error).toContain("최대 4개");
  }
  expect(input.equipment.ring_1!.mainFlat).toBe("");
});
