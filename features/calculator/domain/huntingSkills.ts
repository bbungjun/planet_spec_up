import type { CalculationResult, CalculatorInput } from "./types";

// Pre-Big-Bang reference model (D-112/113), not a measured Planet skill formula.
// Elemental Boost adds 200 percentage points to Fire Burner / Cooling Effect.
export const HUNTING_SKILLS = [
  { id: "air-strike", label: "에어 스트라이크", detail: "Lv.30 · 1,200%", multiplier: 12 },
  { id: "fire-burner", label: "파이어 버너", detail: "Lv.30 · 속성강화 포함 390%", multiplier: 3.9 },
  { id: "cooling-effect", label: "쿨링 이펙트", detail: "Lv.30 · 속성강화 포함 360%", multiplier: 3.6 },
  { id: "octopus", label: "서포터 옥토퍼스", detail: "Lv.20 · 자체 공격력 500", multiplier: 5 },
] as const;

export type HuntingSkillChange = {
  id: typeof HUNTING_SKILLS[number]["id"];
  before: number;
  after: number;
  difference: number;
  percent: number | null;
};

/** One-target peak before defense, critical, element, capsule, DoT and damage cap.
 * Uses each loadout's final DEX/STR and equipment-attack% result; ammo is excluded.
 * Summon total damage is user-confirmed; its attack-independent base is a model.
 */
export function compareHuntingSkills(
  input: CalculatorInput,
  before: CalculationResult,
  after: CalculationResult,
): HuntingSkillChange[] {
  const ammo = Number(input.equipment.projectile?.attackFlat || 0);
  const damage = (result: CalculationResult, skill: typeof HUNTING_SKILLS[number]) => {
    // Keep decimal coefficients as integer ratios until the final floor.
    const numerator = skill.id === "octopus"
      ? (result.mainStat * 25 + result.subStat * 10) * 500
      : (result.mainStat * 36 + result.subStat * 10)
        * Math.max(0, result.totalAttack - ammo) * Math.round(skill.multiplier * 100);
    const denominator = skill.id === "octopus" ? 1000 : 100000;
    return Math.floor(numerator * (100 + (result.windowStats?.totalDamagePercent ?? 0)) / (denominator * 100));
  };
  return HUNTING_SKILLS.map(skill => {
    const previous = damage(before, skill), next = damage(after, skill);
    return { id: skill.id, before: previous, after: next, difference: next - previous,
      percent: previous > 0 ? (next / previous - 1) * 100 : null };
  });
}
