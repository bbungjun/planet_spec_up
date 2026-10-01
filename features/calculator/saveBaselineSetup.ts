import { calculateDamageResult } from "./domain/calculate";
import type { CalculatorInput, JobId, ValidationIssue } from "./domain/types";
import { captureWeaponPreset } from "./domain/weapon-presets";
import { applyOcrBatch, type OcrBatchEntry } from "./ocr/batch";

type SaveRequest = { kind: "preset" } | { kind: "ocr"; job: JobId; entries: OcrBatchEntry[]; loading: boolean };
type SaveFailure = { ok: false; message: string; focusPath?: string };
export type BaselineSaveResult = SaveFailure | { ok: true; input: CalculatorInput; savedAt: string; snapshot: string };

const failure = (message: string, issue?: ValidationIssue): SaveFailure => ({ ok: false, message, ...(issue ? { focusPath: issue.path } : {}) });

/** Prepare once, preserve purpose-specific validation order, then persist that exact raw setup.
 * UI commits only the successful result; this module never mutates input or temporary reviews.
 */
export function saveBaselineSetup(input: CalculatorInput, request: SaveRequest, persist: (input: CalculatorInput) => string): BaselineSaveResult {
  let prepared = input;
  if (request.kind === "ocr") {
    if (request.loading) return failure("저장된 캐릭터를 불러오는 중입니다. 잠시 기다려주세요.");
    const outcome = applyOcrBatch(input, request.job, request.entries);
    if (outcome.error) return failure(outcome.error);
    if (!outcome.input) return failure("인식 결과를 다시 확인하세요.");
    prepared = outcome.input;
  }
  const issues = calculateDamageResult(prepared).issues;
  const arrowError = prepared.character.job === "marksman"
    ? issues.find(issue => issue.severity === "error" && issue.path === "equipment.projectile.attackFlat") : undefined;
  if (arrowError) return failure(request.kind === "ocr"
    ? "화살 공격력을 0~2 사이의 정수로 입력한 뒤 저장하세요."
    : "화살 공격력을 0~2 사이의 정수로 입력한 뒤 저장해주세요.", arrowError);
  if (request.kind === "ocr") {
    const characterError = issues.find(issue => issue.severity === "error"
      && (issue.path.startsWith("character.") || issue.path.startsWith("cashEquipment.")));
    if (characterError) return failure(characterError.path.startsWith("cashEquipment.")
      ? "캐시 장비 입력값을 수정한 뒤 저장하세요."
      : "캐릭터 설정에 잘못된 값이 있습니다. 표시된 입력값을 수정한 뒤 저장하세요.", characterError);
  } else {
    const aranError = prepared.character.job === "aran" ? issues.find(issue => issue.severity === "error"
      && (issue.code === "ARAN_REFERENCE_REQUIRED" || issue.path.startsWith("character.aran"))) : undefined;
    if (aranError) return failure(aranError.message, aranError);
    const criticalError = issues.find(issue => issue.code === "CRITICAL_RATE_EXCEEDED"
      || (issue.severity === "error" && issue.path.endsWith(".criticalRate")));
    if (criticalError) return failure(criticalError.message, criticalError);
    const cashError = issues.find(issue => issue.severity === "error" && issue.path.startsWith("cashEquipment."));
    if (cashError) return failure("캐시 장비 입력값을 확인한 뒤 다시 저장해주세요.", cashError);
    const baseError = issues.find(issue => issue.severity === "error"
      && (issue.path === "character.pureMain" || issue.path === "character.pureSub"));
    if (baseError) return failure("순수 스탯을 확인한 뒤 다시 저장해주세요.", baseError);
  }
  const next = captureWeaponPreset(prepared);
  try {
    const savedAt = persist(next);
    return { ok: true, input: next, savedAt, snapshot: JSON.stringify(next) };
  } catch {
    return failure(request.kind === "ocr"
      ? "브라우저에 저장하지 못했습니다. 인식 목록은 유지됩니다. 브라우저 저장 공간·설정을 확인한 뒤 다시 눌러주세요."
      : "세팅을 저장할 수 없습니다.");
  }
}
