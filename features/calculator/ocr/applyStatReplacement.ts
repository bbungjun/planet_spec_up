/**
 * 검토한 OCR 필드만 기존 장비 입력에 덮어쓰는 적용 경계.
 * 옵션을 기존 값에 다시 더하지 않으며, 없는 필드와 명시적인 0을 구분한다.
 */
import type { EquipmentInput } from "../domain/types";
import type { StatReplacement } from "./types";

/**
 * replacement에 실제로 존재하는 값만 새 장비 객체에 반영한다.
 * undefined는 기존 값을 유지하고, "0"이나 빈 문자열은 명시적인 교체값으로 적용한다.
 */
export function applyStatReplacement(
  equipment: EquipmentInput,
  replacement: StatReplacement,
): EquipmentInput {
  return { ...equipment, ...Object.fromEntries(Object.entries(replacement).filter(([, value]) => value !== undefined)) };
}
