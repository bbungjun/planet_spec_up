import type { EquipmentInput, EquipmentSlot, JobId } from "../domain/types";

export const OCR_STAT_NAMES = ["STR", "DEX", "INT", "LUK"] as const;
export type OcrStatName = (typeof OCR_STAT_NAMES)[number];
export type StatTotals = { flat: number; percent: number };
export type ParsedTooltipStats = {
  stats: Record<OcrStatName, StatTotals>;
  allStat: StatTotals;
};
export type StatReplacement = Pick<
  EquipmentInput,
  "mainFlat" | "subFlat" | "mainPercent" | "subPercent"
>;
export type OcrTarget = { job: JobId; slot: EquipmentSlot };
