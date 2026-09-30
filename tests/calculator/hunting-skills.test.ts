import { expect, it } from "vitest";
import { compareHuntingSkills } from "@/features/calculator/domain/huntingSkills";
import { compareCandidate, type PurchaseCandidate } from "@/features/calculator/domain/candidates";
import { createDefaultInput, emptyEquipment } from "@/features/calculator/domain/defaults";
import type { CalculationResult } from "@/features/calculator/domain/types";

function result(attack: number, damage: number): CalculationResult {
  return { mainStat: 4000, subStat: 100, extraStr: 0, totalAttack: attack,
    statAttack: 0, convertedAttack: 0, defenseMultiplier: 1, criticalMultiplier: 1,
    formulaInputs: { bossAndTotalDamage: damage }, pureMain: 1018, pureSub: 4, issues: [],
    windowStats: { totalDamagePercent: damage, bossDamagePercent: 0, ignoreDefensePercent: 0, criticalRate: 0 } };
}

it("compares the two potential tradeoffs with ammo excluded and summon attack independent", () => {
  const input = createDefaultInput("corsair"); input.equipment.buff!.attackFlat = "0"; // Fixed no-buff reference.
  input.equipment.projectile!.attackFlat = "20";
  const a = compareHuntingSkills(input, result(222, 21), result(252, 9));
  expect(a.map(row => [row.before, row.after])).toEqual([
    [425290, 440011], [138219, 143003], [127587, 132003], [61105, 55045],
  ]);
  expect(a[0].percent).toBeCloseTo(3.461, 2);
  expect(a[3].percent).toBeCloseTo(-9.918, 2);
  const b = compareHuntingSkills(input, result(222, 21), result(236, 15));
  expect(b.map(row => row.after)).toEqual([432216, 140470, 129664, 58075]);
});

it("recalculates summon DEX/STR, ignores boss damage, and never invents a rate from zero", () => {
  const input = createDefaultInput("corsair"); input.equipment.buff!.attackFlat = "0"; // Fixed no-buff reference.
  input.equipment.projectile!.attackFlat = "0";
  const before = result(222, 21), after = result(252, 21);
  expect(compareHuntingSkills(input, before, after)[3].difference).toBe(0);
  after.mainStat += 10;
  after.subStat += 2;
  after.windowStats!.bossDamagePercent = 999;
  expect(compareHuntingSkills(input, before, after)[3].after).toBe(61268);
  const zero = { ...before, totalAttack: 0, mainStat: 0, subStat: 0 };
  expect(compareHuntingSkills(input, zero, after).every(row => row.percent === null)).toBe(true);
});

function setup() {
  const input = createDefaultInput("corsair"); input.equipment.buff!.attackFlat = "0"; // Fixed no-buff reference.
  Object.assign(input.character, { level: "120", pureMain: "600", pureSub: "22", mapleWarrior: 0,
    guildAttackFlat: "0", guildBossPercent: "0", guildIgnorePercent: "0" });
  input.equipment.projectile!.attackFlat = "20";
  Object.assign(input.equipment.weapon!, { attackFlat: "100", attackPercent: "20", totalDamagePercent: "21", requiredLevel: "0", requiredSub: "0" });
  input.weaponPresets = { active: "hunting", entries: { boss: { weapon: { ...input.equipment.weapon! }, monsterDefense: "0" } } };
  const candidate: PurchaseCandidate = { id: "candidate", name: "test", job: "corsair", slot: "weapon", category: "건", price: "1",
    equipment: { ...input.equipment.weapon!, attackFlat: "130", totalDamagePercent: "9" } };
  return { input, candidate };
}

it("uses attack percent and preset state without modifying either loadout", () => {
  const { input, candidate } = setup(), original = JSON.stringify({ input, candidate });
  const comparison = compareCandidate(input, candidate);
  expect(comparison.status).toBe("ready");
  expect(comparison.before!.totalAttack).toBe(140);
  expect(comparison.after!.totalAttack).toBe(176);
  expect(comparison.huntingSkills).toHaveLength(4);
  expect(comparison.huntingSkills![0].before).toBe(38019);
  expect(comparison.huntingSkills![0].after).toBe(44523);
  expect(compareCandidate(input, candidate, "boss").huntingSkills).toBeUndefined();
  expect(JSON.stringify({ input, candidate })).toBe(original);
});

it("withholds skill values for incomplete, invalid, unwearable and legacy comparisons", () => {
  const { input, candidate } = setup();
  for (const equipment of [
    { ...candidate.equipment, requiredLevel: "" },
    { ...candidate.equipment, requiredLevel: "121" },
    { ...candidate.equipment, attackFlat: "-1" },
    { ...candidate.equipment, damagePercent: "10" },
  ]) expect(compareCandidate(input, { ...candidate, equipment }).huntingSkills).toBeUndefined();
  input.character.pureMain = "";
  expect(compareCandidate(input, candidate).huntingSkills).toBeUndefined();
});

it("shows hunting effects for shared gear too, but does not apply Corsair skills to other jobs", () => {
  const { input, candidate } = setup();
  input.equipment.gloves = { ...emptyEquipment(), mainFlat: "10", requiredLevel: "0", requiredSub: "0" };
  const gloves = { ...candidate, slot: "gloves" as const, category: "장갑", equipment: { ...input.equipment.gloves, mainFlat: "20" } };
  expect(compareCandidate(input, gloves).huntingSkills![3].difference).toBeGreaterThan(0);
  input.character.job = "marksman";
  expect(compareCandidate(input, { ...candidate, job: "marksman", category: "석궁" }).huntingSkills).toBeUndefined();
});
