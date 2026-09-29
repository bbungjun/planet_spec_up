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
export type RequirementField = "LEV" | "STR" | "DEX";
export type OcrReadingProvenance = {
  role: "discovery" | "verification";
  sourceId: string;
  operationId: string;
  readingId: string;
  viewId: string;
  field?: RequirementField;
  rowId?: string;
};
export type OcrReading = { text: string; confidence?: number; bounds?: OcrBounds; pass: number; provenance?: OcrReadingProvenance };
/** Coordinates refer to the unprocessed, prepared tooltip, never a model view. */
export type LocatedRequirement = {
  sourceId: string;
  operationId: string;
  field: RequirementField;
  rowId: string;
  lineId: string;
  rowBounds: OcrBounds;
  crop: OcrBounds;
  complete: boolean;
  reason?: string;
};
export type RequirementObservation = {
  sourceId: string;
  operationId: string;
  field: RequirementField;
  rowId: string;
  viewId: string;
  mode: "color" | "luma";
  scale: 2 | 3;
  crop: OcrBounds;
  /** Includes artificial canvas padding, expressed in original coordinates. */
  renderBounds?: OcrBounds;
  readings: OcrReading[];
  failure?: string;
};
export type RequirementRecovery = {
  rule: "requirement-original-v1";
  status: "verified" | "unresolved";
  target: LocatedRequirement;
  observations: RequirementObservation[];
  value?: number;
  reason: string;
  supersededReadingIds: string[];
};
export type OcrReviewLine = {
  id: string;
  bounds?: OcrBounds;
  readings: OcrReading[];
  text: string;
  status: "recognized" | "check" | "confirmed" | "ignored";
  reason?: string;
  recovery?: RequirementRecovery;
};
export type OcrReview = {
  category: string | null;
  initialReadings?: OcrReading[];
  header?: { name: string; marker: string; readings: OcrReading[] };
  lines: OcrReviewLine[];
  warnings: string[];
  imageConfirmed?: boolean;
};
