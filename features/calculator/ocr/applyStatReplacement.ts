import type { EquipmentInput } from "../domain/types";
import type { StatReplacement } from "./types";

export function applyStatReplacement(
  equipment: EquipmentInput,
  replacement: StatReplacement,
): EquipmentInput {
  return { ...equipment, ...Object.fromEntries(Object.entries(replacement).filter(([, value]) => value !== undefined)) };
}
