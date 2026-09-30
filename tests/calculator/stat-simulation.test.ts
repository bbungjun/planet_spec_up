import { expect, it } from "vitest";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { emptySimulation, simulateStats } from "@/features/calculator/domain/statSimulation";
import { calculateOptionEfficiency, calculateSnapshotEfficiency } from "@/features/calculator/domain/optionEfficiency";
import { switchWeaponPreset } from "@/features/calculator/domain/weapon-presets";

export function fixture() {
  const input = createDefaultInput("corsair"); input.equipment.buff!.attackFlat = "0"; // Fixed no-buff reference.
  Object.assign(input.character, { level: "199", pureMain: "1000", pureSub: "4", monsterDefense: "50",
    ignoreDefense: "20", guildIgnorePercent: "10", guildAttackFlat: "5", guildBossPercent: "5" });
  Object.assign(input.equipment.weapon!, { mainFlat: "100", mainPercent: "50", subFlat: "20", attackFlat: "100",
    attackPercent: "10", totalDamagePercent: "20", bossDamagePercent: "30", requiredLevel: "0", requiredSub: "0" });
  input.equipment.projectile!.attackFlat = "30";
  return input;
}

it("starts at the exact existing result and reuses the same option-efficiency calculation", () => {
  const input = fixture(), result = simulateStats(input, emptySimulation());
  expect(result.before).toEqual(result.after);
  expect(result.stat!.percent).toBe(0);
  expect(calculateSnapshotEfficiency(result.snapshot!, false)).toEqual(calculateOptionEfficiency(input));
});

it("applies multiple signed deltas with existing floors, fixed pure stats, and separate attack pools", () => {
  const input = fixture(), original = structuredClone(input);
  const result = simulateStats(input, { ...emptySimulation(), equipmentMain: "10", mainPercent: "5",
    percentEligibleAttack: "10", attackPercent: "5", totalDamagePercent: "9", bossAndTotalDamage: "-10", ignoreDefense: "5" });
  expect(result.after).toMatchObject({ mainStat: 1820, subStat: 24, pureMain: 1000, pureSub: 4,
    totalAttack: 161, statAttack: 10587, convertedAttack: 15658 });
  expect(result.before.convertedAttack).toBe(12836);
  expect(result.converted!.percent).toBeCloseTo((15658 / 12836 - 1) * 100);
  expect(result.isolated!.percentEligibleAttack.percent).not.toBe(result.converted!.percent);
  expect(input).toEqual(original);
});

it("includes Captain equipment STR in isolated and combined attack without changing pure STR", () => {
  const input = fixture(), original = structuredClone(input);
  const added = simulateStats(input, { ...emptySimulation(), equipmentSub: "10" });
  expect(added.snapshot!.equipmentSub).toBe(30);
  expect(added.after!.subStat).toBe(34);
  expect(added.after!.pureSub).toBe(4);
  expect(added.stat!.difference).toBeGreaterThan(0);
  expect(added.isolated!.equipmentSub.difference).toBe(added.converted!.difference);
  const removed = simulateStats(input, { ...emptySimulation(), equipmentSub: "-10" });
  expect(removed.after!.subStat).toBe(14);
  expect(removed.stat!.difference).toBeLessThan(0);
  expect(simulateStats(input, { ...emptySimulation(), equipmentSub: "-21" }).errors.equipmentSub).toBeTruthy();
  expect(input).toEqual(original);
});

it("keeps total damage and boss damage separate when switching to hunting", () => {
  const input = fixture();
  input.weaponPresets = { active: "boss", entries: { hunting: { weapon: { ...input.equipment.weapon! }, monsterDefense: "0" } } };
  const hunting = switchWeaponPreset(input, "hunting");
  const boss = simulateStats(hunting, { ...emptySimulation(), bossAndTotalDamage: "30" });
  expect(boss.converted!.percent).toBe(0);
  expect(simulateStats(hunting, { ...emptySimulation(), totalDamagePercent: "30" }).converted!.percent).toBeGreaterThan(0);
});

it("rejects invalid changes and negative pools without adjusting or saving the original", () => {
  const input = fixture();
  for (const [field, value] of [["equipmentMain", "-101"], ["percentEligibleAttack", "-101"], ["attackPercent", "Infinity"],
    ["equipmentMain", "1.5"], ["ignoreDefense", "101"], ["mainPercent", "-51"]] as const) {
    const result = simulateStats(input, { ...emptySimulation(), [field]: value });
    expect(result.errors[field]).toBeTruthy();
    expect(result.after).toBeUndefined();
  }
  expect(simulateStats(input, { ...emptySimulation(), equipmentMain: "" }).stat!.percent).toBe(0);
  input.character.sharpEyes = "sharp_30"; input.character.criticalRate = "80";
  expect(simulateStats(input, { ...emptySimulation(), criticalRate: "6" }).errors.criticalRate).toContain("100%");
  const capped = simulateStats(input, { ...emptySimulation(), criticalRate: "5" });
  expect(calculateSnapshotEfficiency(capped.snapshot!, false).rows.find(row => row.option === "criticalRate")?.unavailableReason).toContain("100%");
});

it("blocks bad baselines and does not turn zero damage into a fabricated percentage", () => {
  const input = fixture();
  input.equipment.weapon!.requiredLevel = "200";
  expect(simulateStats(input, emptySimulation()).blocked).toContain("착용 조건");
  input.equipment.weapon!.requiredLevel = "0";
  input.equipment.weapon!.attackFlat = "";
  expect(simulateStats(input, emptySimulation()).blocked).toContain("무기");
  input.equipment.weapon!.attackFlat = "100"; input.equipment.weapon!.damagePercent = "3";
  expect(simulateStats(input, emptySimulation()).blocked).toContain("분리");
  input.equipment.weapon!.damagePercent = "";
  input.character.monsterDefense = "100"; input.character.ignoreDefense = "0"; input.character.guildIgnorePercent = "0";
  const result = simulateStats(input, { ...emptySimulation(), ignoreDefense: "10" });
  expect(result.before.convertedAttack).toBe(0);
  expect(result.after!.convertedAttack).toBeGreaterThan(0);
  expect(result.converted!.percent).toBeNull();
});

it("labels an unregistered pure-stat baseline as estimated but freezes its allocation", () => {
  const input = fixture(); delete input.character.pureMain; delete input.character.pureSub;
  const result = simulateStats(input, { ...emptySimulation(), equipmentMain: "50" });
  expect(result.estimated).toBe(true);
  expect(result.after!.pureMain).toBe(result.before.pureMain);
  expect(result.after!.pureSub).toBe(result.before.pureSub);
});
