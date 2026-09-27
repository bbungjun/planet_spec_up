import { describe, expect, it } from "vitest";
import { calculateOptionEfficiency } from "@/features/calculator/domain/optionEfficiency";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { calculateDamageResult } from "@/features/calculator/domain/calculate";
import { switchWeaponPreset } from "@/features/calculator/domain/weapon-presets";

function fixture() {
  const input = createDefaultInput("corsair");
  Object.assign(input.character, {
    level: "199", pureMain: "1000", pureSub: "4", monsterDefense: "50",
    ignoreDefense: "20", guildIgnorePercent: "10", guildAttackFlat: "5", guildBossPercent: "5",
  });
  Object.assign(input.equipment.weapon!, {
    mainFlat: "100", mainPercent: "50", subFlat: "20", attackFlat: "100", attackPercent: "10",
    totalDamagePercent: "20", bossDamagePercent: "30", requiredLevel: "0", requiredSub: "0",
  });
  input.equipment.projectile!.attackFlat = "30";
  return input;
}

describe("option efficiency", () => {
  it("recalculates independent +1 options with fixed pure stats, existing floors and equipment-only attack%", () => {
    const input = fixture(), before = structuredClone(input);
    // DEX=1750, STR=24, attack=floor(100*1.1)+30+5=145.
    // Stat attack=9169; converted=floor(9169*1.55*0.8)=11369.
    expect(calculateDamageResult(input)).toMatchObject({ mainStat: 1750, subStat: 24, totalAttack: 145, convertedAttack: 11369 });
    const result = calculateOptionEfficiency(input);
    expect(result).toMatchObject({ estimated: false, unavailableReason: null });
    expect(result.rows.map(row => row.convertedAttackGain)).toEqual([8, 72, 79, 79, 73, 73, 142, 0]);
    expect(result.rows.map(row => row.equivalentMainStat)).toEqual([1, 9, 9.875, 9.875, 9.125, 9.125, 17.75, 0]);
    expect(result.rows[2].increasePercent).toBeCloseTo(79 / 11369 * 100, 12);
    expect(input).toEqual(before);
  });

  it("follows the active weapon and excludes boss damage when hunting", () => {
    const input = fixture();
    input.weaponPresets = { active: "boss", entries: { hunting: { weapon: { ...input.equipment.weapon!, attackFlat: "200" }, monsterDefense: "0" } } };
    const hunting = calculateOptionEfficiency(switchWeaponPreset(input, "hunting"));
    expect(hunting.rows.find(row => row.option === "bossAndTotalDamage")?.increasePercent).toBe(0);
    expect(hunting.rows.find(row => row.option === "totalDamagePercent")?.increasePercent).toBeGreaterThan(0);
    expect(hunting.rows.find(row => row.option === "ignoreDefense")?.increasePercent).toBe(0);
    expect(hunting.rows[2].increasePercent).not.toBe(calculateOptionEfficiency(input).rows[2].increasePercent);
  });

  it("includes current Sharp Eyes and skill conditions in critical efficiency", () => {
    const input = fixture();
    expect(calculateOptionEfficiency(input).rows[7].increasePercent).toBe(0);
    input.character.sharpEyes = "sharp_30";
    const buffed = calculateOptionEfficiency(input).rows[7].increasePercent;
    expect(buffed).toBeGreaterThan(0);
    input.character.skillPercent = "760";
    expect(calculateOptionEfficiency(input).rows[7].increasePercent).toBeLessThan(buffed);
  });

  it("stops adding defense efficiency once ignore covers the target", () => {
    const input = fixture();
    input.character.ignoreDefense = "40";
    expect(calculateOptionEfficiency(input).rows[6]).toMatchObject({ convertedAttackGain: 0, equivalentMainStat: 0 });
  });

  it("keeps estimated AP fixed and identifies estimates without changing saved input", () => {
    const input = fixture();
    delete input.character.pureMain; delete input.character.pureSub;
    input.equipment.weapon!.requiredSub = "100";
    const before = structuredClone(input);
    expect(calculateOptionEfficiency(input)).toMatchObject({ estimated: true, unavailableReason: null });
    expect(input).toEqual(before);
  });

  it.each(["missing", "invalid", "level", "sub", "zero"])("does not present efficiency for %s baseline", kind => {
    const input = fixture();
    if (kind === "missing") input.equipment.weapon!.attackFlat = "";
    if (kind === "invalid") input.equipment.hat!.mainPercent = "invalid";
    if (kind === "level") input.equipment.weapon!.requiredLevel = "220";
    if (kind === "sub") input.equipment.weapon!.requiredSub = "100";
    if (kind === "zero") { input.character.monsterDefense = "100"; input.character.ignoreDefense = "0"; input.character.guildIgnorePercent = "0"; }
    expect(calculateOptionEfficiency(input)).toMatchObject({ unavailableReason: expect.any(String), rows: [] });
  });

  it("leaves equivalent stats unavailable when +1 main stat is lost to rounding", () => {
    const input = createDefaultInput("corsair");
    input.equipment.projectile!.attackFlat = "0"; // Preserve the low-attack rounding boundary.
    Object.assign(input.character, { pureMain: "700", pureSub: "4", mapleWarrior: 0 });
    input.equipment.weapon!.attackFlat = "1";
    const result = calculateOptionEfficiency(input);
    expect(result.unavailableReason).toBeNull();
    expect(result.rows[0].increasePercent).toBe(0);
    expect(result.rows[2].increasePercent).toBeGreaterThan(0);
    expect(result.rows.every(row => row.equivalentMainStat === null)).toBe(true);
  });

  it.each(["marksman", "night_lord"] as const)("supports %s current stats without replacing Night Lord STR", job => {
    const input = createDefaultInput(job);
    Object.assign(input.character, { pureMain: "700", pureSub: "25", nightLordStrStat: "44" });
    input.equipment.weapon!.attackFlat = "100";
    const before = calculateDamageResult(input);
    const result = calculateOptionEfficiency(input);
    expect(result.rows[7].increasePercent).toBeGreaterThan(0);
    expect(result.rows[0].equivalentMainStat).toBe(1);
    expect(calculateDamageResult(input)).toEqual(before);
  });
});
