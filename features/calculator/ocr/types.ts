import type { EquipmentInput, EquipmentSlot, JobId } from "../domain/types";

export const OCR_STAT_NAMES = ["STR", "DEX", "INT", "LUK"] as const;
export type OcrStatName = (typeof OCR_STAT_NAMES)[number];
export type StatTotals = { flat: number; percent: number };
export type TooltipOption = {
  label: string;
  value: number;
  percent: boolean;
  requirement: boolean;
  raw: string;
};
export type ParsedTooltipStats = {
  stats: Record<OcrStatName, StatTotals>;
  allStat: StatTotals;
  options: TooltipOption[];
  unparsed: string[];
  category: string | null;
};
export type StatReplacement = Pick<
  EquipmentInput,
  "mainFlat" | "subFlat" | "mainPercent" | "subPercent"
> & Partial<Pick<EquipmentInput, "attackFlat" | "attackPercent" | "requiredSub" | "damagePercent" | "totalDamagePercent" | "bossDamagePercent" | "ignoreDefensePercent">>;
export type OcrTarget = { job: JobId; slot: EquipmentSlot };
