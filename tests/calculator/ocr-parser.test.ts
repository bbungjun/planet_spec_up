import { expect, it } from "vitest";
import { applyStatReplacement } from "@/features/calculator/ocr/applyStatReplacement";
import { mapRecognizedStats } from "@/features/calculator/ocr/mapRecognizedStats";
import { parseMapleTooltip } from "@/features/calculator/ocr/parseMapleTooltip";
import type { EquipmentInput } from "@/features/calculator/domain/types";

const attachedTooltipText = [
  "STR +10",
  "DEX +21",
  "HP +15",
  "DEX +9%",
  "DEX +6%",
  "DEX +6%",
].join("\n");

it("maps attached tooltip stats to the corsair main and substat fields", () => {
  expect(mapRecognizedStats(parseMapleTooltip(attachedTooltipText), "corsair"))
    .toEqual({
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
