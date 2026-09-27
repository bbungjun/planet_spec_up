import { expect, it } from "vitest";
import { applyStatReplacement } from "@/features/calculator/ocr/applyStatReplacement";
import { mapRecognizedStats } from "@/features/calculator/ocr/mapRecognizedStats";
import { parseMapleTooltip } from "@/features/calculator/ocr/parseMapleTooltip";
import type { EquipmentInput } from "@/features/calculator/domain/types";
import { mergeRecognitionText } from "@/features/calculator/ocr/mergeRecognitionText";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { calculateDamageResult } from "@/features/calculator/domain/calculate";
import { deserializeSetup, serializeSetup } from "@/features/calculator/storage";

const clearedDamage = { damagePercent: "", totalDamagePercent: "", bossDamagePercent: "", ignoreDefensePercent: "" };

it("ignores leading bullet punctuation without repairing ambiguous digits or percentages", () => {
  const parsed = parseMapleTooltip(". DEX: +3\n_DEX:+6%\n. STR: +5\nDEX +2.5%\n0.5DEX:+9%\n.DEX.446%");
  expect(parsed.stats.DEX).toEqual({ flat: 3, percent: 8.5 });
  expect(parsed.stats.STR.flat).toBe(5);
  expect(parsed.unparsed).toEqual(["0.5DEX:+9%", ".DEX.446%"]);
});

const attachedTooltipText = [
  "STR +10",
  "DEX +21",
  "HP +15",
  "DEX +9%",
  "DEX +6%",
  "DEX +6%",
].join("\n");

const screenshotTooltipText = [
  "HBT #10",
  "DEX : +21",
  "HP: +15",
  "DEX + 49%",
  "| DEX.446%",
  "DEX #6%",
].join("\n");

it("does not invent values from ambiguous OCR digits or force a known screenshot result", () => {
  expect(mapRecognizedStats(parseMapleTooltip(screenshotTooltipText), "corsair"))
    .toEqual({
      ...clearedDamage,
      mainFlat: "21",
      subFlat: "",
      mainPercent: "49",
      subPercent: "",
    });
});

const weaponText = [
  "REQ LEV : 120", "REG STR : 120", "REQ DEX : 335",
  "ㆍ STR : +3", "ㆍ DEX : +7", "ㆍ 공격력 : +106",
  "ㆍ 명중률 : +5", "ㆍ흑수정 강화 공격력 +2",
  "ㆍ 총 데미지 : +9%", "ㆍ총 데미지 : +6%", "ㆍ총데미지 : +6%",
].join("\n");

it("recognizes weapon options, requirements and repeated potential lines independently", () => {
  const parsed = parseMapleTooltip(weaponText);
  expect(mapRecognizedStats(parsed, "corsair")).toEqual({
    ...clearedDamage,
    mainFlat: "7", subFlat: "3", mainPercent: "", subPercent: "",
    attackFlat: "106", requiredLevel: "120", requiredSub: "120", totalDamagePercent: "21",
  });
  expect(parsed.options).toContainEqual(expect.objectContaining({label: "명중률", value: 5}));
  expect(parsed.options).toContainEqual(expect.objectContaining({label: "흑수정 강화 공격력", value: 2}));
  expect(parsed.stats.STR.flat).toBe(3);
  expect(parsed.stats.DEX.flat).toBe(7);
});

it("keeps a standalone enhancement attack as reference data", () => {
  const parsed = parseMapleTooltip("흑수정 강화 공격력 +12\n명중률 +5");
  expect(mapRecognizedStats(parsed, "corsair")).not.toHaveProperty("attackFlat");
  expect(parsed.options).toHaveLength(2);
});

it("supports arbitrary numbers, percentages, all-stat and unknown option names", () => {
  const text = "INT +28\nLUK +32\nDEX +12%\nALL STAT +4.5%\nATK +177\n공격력 +12%\n보스 데미지 +35%\n이동속도 +14\nHP +300";
  const parsed = parseMapleTooltip(text);
  expect(mapRecognizedStats(parsed, "night_lord")).toEqual({
    ...clearedDamage,
    mainFlat: "32", subFlat: "", mainPercent: "4.5", subPercent: "16.5",
    attackFlat: "177", attackPercent: "12", bossDamagePercent: "35",
  });
  expect(parsed.options).toContainEqual(expect.objectContaining({label: "INT", value: 28}));
  expect(parsed.options).toContainEqual(expect.objectContaining({label: "이동속도", value: 14}));
  expect(parseMapleTooltip("DEX + 49%").stats.DEX.percent).toBe(49);
  expect(parseMapleTooltip("DEX.446%").unparsed).toEqual(["DEX.446%"]);
});

it("combines readable options across OCR passes without double counting potential lines", () => {
  const text = mergeRecognitionText(
    "STR +3\nㆍ06×%:+7\n공격력 +106\n총 데미지 +996\n총 데미지 +6%\n총 데미지 +6%",
    "578 1+3\nDEX +7\n공격력 +106\n총 데미지 +9%\n총 데미지 +6%\n총 데미지 +6%",
  );
  expect(mapRecognizedStats(parseMapleTooltip(text), "corsair")).toEqual({
    ...clearedDamage,
    mainFlat: "7", subFlat: "3", mainPercent: "", subPercent: "",
    attackFlat: "106", totalDamagePercent: "21",
  });
});

it("keeps flat and percentage options independently when one OCR pass misses a line", () => {
  const merged = mergeRecognitionText("DEX +20\nDEX +6%", "DEX +9%\nDEX +6%\nDEX +6%");
  expect(parseMapleTooltip(merged).stats.DEX).toEqual({flat: 20, percent: 21});
  expect(parseMapleTooltip("총 데미지 +996").options).toEqual([]);
});

it("keeps the equipment category when only the original OCR pass read it", () => {
  const merged = mergeRecognitionText("장비분류 : 어깨장식\n공격력 +5", "공격력 +5");
  expect(parseMapleTooltip(merged).category).toBe("어깨장식");
  expect(mapRecognizedStats(parseMapleTooltip(merged), "corsair").attackFlat).toBe("5");
});

it("stores equipment damage, recalculates it and never adds it twice on re-apply", () => {
  const input = createDefaultInput("corsair");
  input.character.bossAndTotalDamage = "10";
  const replacement = mapRecognizedStats(parseMapleTooltip(weaponText), "corsair");
  input.equipment.weapon = applyStatReplacement(input.equipment.weapon!, replacement);
  const first = calculateDamageResult(input);
  expect(first.totalAttack).toBe(111);
  expect(first.formulaInputs.bossAndTotalDamage).toBe(36);
  input.equipment.weapon = applyStatReplacement(input.equipment.weapon, replacement);
  expect(calculateDamageResult(input)).toEqual(first);
  const saved = deserializeSetup(serializeSetup(input));
  expect(saved).toMatchObject({ok: true, value: {input: {equipment: {weapon: {totalDamagePercent: "21"}}}}});
  const legacy = createDefaultInput("corsair");
  expect(deserializeSetup(serializeSetup(legacy))).toMatchObject({ok: true});
});

it("maps attached tooltip stats to the corsair main and substat fields", () => {
  expect(mapRecognizedStats(parseMapleTooltip(attachedTooltipText), "corsair"))
    .toEqual({
      ...clearedDamage,
      mainFlat: "21",
      subFlat: "10",
      mainPercent: "21",
      subPercent: "",
    });
});

it("fans out flat and percent all-stat totals for the night lord", () => {
  expect(mapRecognizedStats(
    parseMapleTooltip("올스탯 +5\nALL STAT +3%\nLUK +7%"),
    "night_lord",
  )).toEqual({
    ...clearedDamage,
    mainFlat: "5",
    subFlat: "5",
    mainPercent: "10",
    subPercent: "3",
  });
});

it("sums only matching duplicate noisy stat lines", () => {
  const parsed = parseMapleTooltip([
    "DEX : + 6 %",
    "dex:+4%",
    "STR : + 2",
    "HP : + 999",
    "not a stat line",
  ].join("\n"));

  expect(parsed.stats.DEX).toEqual({ flat: 0, percent: 10 });
  expect(parsed.stats.STR).toEqual({ flat: 2, percent: 0 });
  expect(parsed.stats.INT).toEqual({ flat: 0, percent: 0 });
  expect(parsed.stats.LUK).toEqual({ flat: 0, percent: 0 });
  expect(parsed.allStat).toEqual({ flat: 0, percent: 0 });
});

it("replaces only stat fields and preserves the equipment sentinel fields", () => {
  const equipment: EquipmentInput = {
    mainFlat: "1",
    subFlat: "2",
    mainPercent: "3",
    subPercent: "4",
    attackFlat: "5",
    attackPercent: "6",
    requiredSub: "7",
  };
  const replacement = {
    mainFlat: "21",
    subFlat: "10",
    mainPercent: "21",
    subPercent: "",
  } as const;

  expect(applyStatReplacement(equipment, replacement)).toEqual({
    ...equipment,
    ...replacement,
  });
  expect(equipment).toEqual({
    mainFlat: "1",
    subFlat: "2",
    mainPercent: "3",
    subPercent: "4",
    attackFlat: "5",
    attackPercent: "6",
    requiredSub: "7",
  });
});
