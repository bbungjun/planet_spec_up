import { JOB_RULES } from "./job-rules";
import { levelAchievementBonus } from "./level";
import { calculateTotalStat, mapleWarriorRate } from "./formulas";
import { getEquipmentSlotLabel, getVisibleEquipmentSlots } from "./slots";
import type { NormalizedCalculatorInput } from "./normalize";
import type { CalculatorInput, EquipmentSlot, ValidationIssue } from "./types";

const nonEquipment = new Set(["projectile", "blessing_1", "blessing_2", "buff"]);
const known = (raw: string | undefined) => raw !== undefined && raw.trim() !== "" && Number.isInteger(Number(raw)) && Number(raw) >= 0 && Number(raw) <= 9999;

/** Emit only proven deficits. Unknown requirements are not failures or persisted zeroes.
 * For a deficit proof, give unknown support gear every benefit of the doubt. If even
 * that reachable upper bound is insufficient, the recognized requirement fails.
 * Known locked items cannot lend their own flat/% stats or unlock a cycle. */
export function checkEquipmentRequirements(input: CalculatorInput, normalized: NormalizedCalculatorInput): ValidationIssue[] {
  const character = normalized.character, sub = JOB_RULES[character.job].subStat;
  if (!Number.isInteger(character.level) || character.level < 1) return [];
  const slots = getVisibleEquipmentSlots(input).filter(slot => !nonEquipment.has(slot) && Object.values(input.equipment[slot] ?? {}).some(value => value?.trim()));
  const rawPureSub = character.pureSub !== null ? input.character.pureSub : input.character.manualPureSub;
  const pureSub = character.pureSub ?? character.manualPureSub;
  const hasPureSub = pureSub !== null && known(rawPureSub) && Number(rawPureSub) === pureSub;
  const worn = new Set<EquipmentSlot>();
  const levelPasses = (slot: EquipmentSlot) => !known(input.equipment[slot]?.requiredLevel) || normalized.equipment[slot]!.requiredLevel <= character.level;
  const available = () => calculateTotalStat(pureSub ?? 0,
    levelAchievementBonus(character.level).allStat + [...worn].reduce((sum, slot) => sum + (normalized.equipment[slot]?.subFlat ?? 0), 0),
    [...worn].reduce((sum, slot) => sum + (normalized.equipment[slot]?.subPercent ?? 0), 0), mapleWarriorRate(character.mapleWarrior));
  if (hasPureSub) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const slot of slots) {
        if (worn.has(slot) || !levelPasses(slot)) continue;
        if (!known(input.equipment[slot]?.requiredSub) || normalized.equipment[slot]!.requiredSub <= available()) {
          worn.add(slot); changed = true;
        }
      }
    }
  }
  const availableSub = available();
  return slots.flatMap((slot): ValidationIssue[] => {
    const gear = normalized.equipment[slot]!, label = getEquipmentSlotLabel(input, slot);
    if (!levelPasses(slot)) return [{ severity: "warning", path: `equipment.${slot}.requiredLevel`, code: "UNMET_LEVEL_REQUIREMENT",
      message: `${label} 착용 불가: 요구 레벨 ${gear.requiredLevel}, 현재 ${character.level} (레벨 ${gear.requiredLevel - character.level} 부족).` }];
    if (!hasPureSub || !known(input.equipment[slot]?.requiredSub) || gear.requiredSub === 0 || worn.has(slot)) return [];
    return [{ severity: "warning", path: `equipment.${slot}.requiredSub`, code: "UNMET_SUBSTAT_REQUIREMENT",
      message: `${label} 착용 불가: 요구 ${sub} ${gear.requiredSub}, 장비 제외 ${sub} ${availableSub} (${gear.requiredSub - availableSub} 부족).` }];
  });
}
