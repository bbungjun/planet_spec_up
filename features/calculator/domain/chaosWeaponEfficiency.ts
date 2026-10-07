import { calculateDefenseMultiplier } from "./formulas";

/** 120-level unique weapon boss/IED options confirmed in the reference calculator. */
export const CHAOS_WEAPON_REFERENCE = {
  weaponLevel: 120,
  guildBoss: 5,
  guildIgnore: 10,
  bosses: [
    { id: "zakum", label: "카오스 자쿰", defense: 60 },
    { id: "horntail", label: "카오스 혼테일", defense: 80 },
  ],
} as const;

type PotentialOption = { id: string; label: string; boss: number; ignore: number };
export type ChaosWeaponCombination = {
  id: string;
  label: string;
  boss: number;
  ignore: number;
};
export type ChaosWeaponBossId = typeof CHAOS_WEAPON_REFERENCE.bosses[number]["id"];
export type ChaosWeaponBaselineId = "boss90" | "blank" | "best";

const boss20 = { id: "boss20", label: "보공20", boss: 20, ignore: 0 };
const boss30 = { id: "boss30", label: "보공30", boss: 30, ignore: 0 };
const ignore30 = { id: "ignore30", label: "방무30", boss: 0, ignore: 30 };
const ignore15 = { id: "ignore15", label: "방무15", boss: 0, ignore: 15 };
const firstLine: PotentialOption[] = [boss20, boss30, ignore30];
const otherLines: PotentialOption[] = [...firstLine, ignore15];
const combinations = new Map<string, ChaosWeaponCombination>();

for (const first of firstLine) for (const second of otherLines) for (const third of otherLines) {
  const lines = [first, second, third].sort((a, b) => b.ignore - a.ignore || b.boss - a.boss);
  const id = lines.map(line => line.id).join("-");
  if (!combinations.has(id)) combinations.set(id, {
    id,
    label: lines.map(line => line.label).join(" · "),
    boss: lines.reduce((sum, line) => sum + line.boss, 0),
    ignore: lines.reduce((sum, line) => sum + line.ignore, 0),
  });
}

export const CHAOS_WEAPON_COMBINATIONS: readonly ChaosWeaponCombination[] = [...combinations.values()];
export const CHAOS_WEAPON_BASELINES = [
  { id: "boss90", label: "보공30 · 보공30 · 보공30", boss: 90, ignore: 0 },
  { id: "blank", label: "무잠재", boss: 0, ignore: 0 },
  { id: "best", label: "방무30 · 방무30 · 보공30", boss: 30, ignore: 60 },
] as const;

type PotentialTotals = Pick<ChaosWeaponCombination, "boss" | "ignore">;

// Continuous reference efficiency, independent of character inputs and integer attack rounding.
const referenceMultiplier = (potential: PotentialTotals, defense: number) =>
  (1 + (potential.boss + CHAOS_WEAPON_REFERENCE.guildBoss) / 100)
  * calculateDefenseMultiplier(defense, potential.ignore + CHAOS_WEAPON_REFERENCE.guildIgnore);

export function chaosWeaponGain(potential: PotentialTotals, defense: number, baseline: ChaosWeaponBaselineId) {
  const reference = CHAOS_WEAPON_BASELINES.find(item => item.id === baseline)!;
  return (referenceMultiplier(potential, defense) / referenceMultiplier(reference, defense) - 1) * 100;
}

export function rankChaosWeaponCombinations(bossId: ChaosWeaponBossId) {
  const defense = CHAOS_WEAPON_REFERENCE.bosses.find(boss => boss.id === bossId)!.defense;
  const sorted = [...CHAOS_WEAPON_COMBINATIONS].sort((a, b) =>
    referenceMultiplier(b, defense) - referenceMultiplier(a, defense) || b.boss - a.boss);
  return sorted.map(combination => ({
    ...combination,
    rank: sorted.findIndex(other => Math.abs(referenceMultiplier(other, defense) - referenceMultiplier(combination, defense)) < 1e-10) + 1,
  }));
}

export function chaosWeaponDefense(potential: PotentialTotals, defense: number) {
  const totalIgnore = potential.ignore + CHAOS_WEAPON_REFERENCE.guildIgnore;
  return { totalIgnore, remaining: Math.max(0, defense - totalIgnore), excess: Math.max(0, totalIgnore - defense) };
}
