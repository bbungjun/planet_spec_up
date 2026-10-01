/**
 * 이미지 좌표·판독 회차·검토 상태·부분 교체값의 공통 타입 계약.
 * 확인된 값과 미인식 키, 기본 판독과 실험 검증 출처를 구분해 경계 간 추정값 전파를 막는다.
 */
import type { EquipmentInput, EquipmentSlot, JobId } from "../domain/types";

export const OCR_STAT_NAMES = ["STR", "DEX", "INT", "LUK"] as const;
export type OcrStatName = (typeof OCR_STAT_NAMES)[number];
export type StatTotals = { flat: number; percent: number };
/**
 * 한 줄에서 해석한 옵션. requirement로 착용 조건과 장비가 주는 수치를 구분하고 raw를 원문 증거로 보존한다.
 */
export type TooltipOption = {
  label: string;
  value: number;
  percent: boolean;
  requirement: boolean;
  raw: string;
};
/**
 * 요구 조건을 제외한 스탯 합계, 전체 옵션 목록, 미해석 줄과 장비 분류를 함께 보관한다.
 */
export type ParsedTooltipStats = {
  stats: Record<OcrStatName, StatTotals>;
  allStat: StatTotals;
  options: TooltipOption[];
  unparsed: string[];
  category: string | null;
};
/**
 * 장비 입력에 교체할 필드의 부분 집합. 없는 키는 미인식이며 기존 값을 지우라는 지시가 아니다.
 */
export type StatReplacement = Partial<Omit<EquipmentInput, "pendantId">>;
export type OcrTarget = { job: JobId; slot: EquipmentSlot };
export type OcrSource = { category: string | null; name: string | null; file: File | null; previewFile?: File | null; pendantId?: string };

/**
 * 이미지 폭·높이에 대한 상대 좌표와 영역 크기. 기준 이미지는 각 호출 경로의 좌표 환산 계약을 따른다.
 */
export type OcrBounds = { x: number; y: number; width: number; height: number };
export type RequirementField = "LEV" | "STR" | "DEX";
/**
 * 사진·호출·행·뷰·판독 조각의 출처를 추적해 서로 다른 증거를 혼합하거나 재사용하지 않게 한다.
 */
export type OcrReadingProvenance = {
  role: "discovery" | "verification";
  sourceId: string;
  operationId: string;
  readingId: string;
  viewId: string;
  field?: RequirementField;
  rowId?: string;
};
/**
 * 한 회차의 줄 텍스트·위치·신뢰도·출처 증거. 신뢰도 자체는 정확성 확정값이 아니다.
 */
export type OcrReading = { text: string; confidence?: number; bounds?: OcrBounds; pass: number; provenance?: OcrReadingProvenance };
/**
 * 실험 검증 대상의 좌표는 분리된 원본 설명창 기준이며 모델 입력 확대 이미지 기준이 아니다.
 * complete는 주변 필드 침범·잘림 없이 요구 조건 행 전체를 포함하는지 나타낸다.
 */
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
/**
 * 실험 검증 뷰 하나의 출력과 원본 대응 좌표. 실패한 뷰도 관측 목록에서 숨기지 않는다.
 */
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
/**
 * 실험 검증의 verified/unresolved 결과와 대체된 기본 판독 ID를 원시 증거와 함께 보관한다.
 */
export type RequirementRecovery = {
  rule: "requirement-original-v1";
  status: "verified" | "unresolved";
  target: LocatedRequirement;
  observations: RequirementObservation[];
  value?: number;
  reason: string;
  supersededReadingIds: string[];
};
/**
 * 같은 원본 줄의 모든 회차 증거와 인식/확인 필요/사용자 확인/제외 상태를 묶는다.
 */
export type OcrReviewLine = {
  id: string;
  bounds?: OcrBounds;
  readings: OcrReading[];
  text: string;
  status: "recognized" | "check" | "confirmed" | "ignored";
  reason?: string;
  recovery?: RequirementRecovery;
  equipmentRecovery?: EquipmentRecoveryDecision;
};

/** Every real reread remains observable, including text the option parser cannot accept. */
export type EquipmentRecoveryObservation = {
  sourceId: string;
  operationId: string;
  lineId: string;
  viewId: string;
  mode: "gray" | "luma" | "color" | "soft";
  scale: number;
  bounds: OcrBounds;
  status: "read" | "unavailable" | "failed";
  readings: OcrReading[];
  reason?: string;
};
export type EquipmentRecoveryDecision = {
  status: "recovered" | "unresolved";
  reason: string;
  observations: EquipmentRecoveryObservation[];
  option?: TooltipOption;
  fieldHint?: string | null;
  kind?: "option" | "requirement";
};
/**
 * 장비 분류·헤더·줄 검토·이미지 경고를 담는 단일 결과 객체로 화면과 적용 판단을 일치시킨다.
 */
export type OcrReview = {
  category: string | null;
  initialReadings?: OcrReading[];
  header?: { name: string; marker: string; readings: OcrReading[] };
  lines: OcrReviewLine[];
  warnings: string[];
  imageConfirmed?: boolean;
  recoveryObservations?: EquipmentRecoveryObservation[];
};
