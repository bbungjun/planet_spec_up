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
/** Absent keys are unrecognized, never an instruction to clear saved gear. */
export type StatReplacement = Partial<Omit<EquipmentInput, "pendantId">>;
export type OcrTarget = { job: JobId; slot: EquipmentSlot };
export type OcrSource = { category: string | null; name: string | null; file: File | null; previewFile?: File | null; pendantId?: string };

export type OcrBounds = { x: number; y: number; width: number; height: number };
export type OcrReading = { text: string; confidence?: number; bounds?: OcrBounds; pass: number };
export type OcrReviewLine = {
  id: string;
  bounds?: OcrBounds;
  readings: OcrReading[];
  text: string;
  status: "recognized" | "check" | "confirmed" | "ignored";
  reason?: string;
};
export type OcrReview = {
  category: string | null;
  header?: { name: string; marker: string; readings: OcrReading[] };
  lines: OcrReviewLine[];
  warnings: string[];
  imageConfirmed?: boolean;
};
