import { describe, expect, it } from "vitest";
import { JOB_RULES } from "@/features/calculator/domain/job-rules";
import { createDefaultInput } from "@/features/calculator/domain/defaults";

describe("MVP job rules", () => {
  it.each([
    ["marksman", "DEX", "STR", "crossbow", 3.6, 4, 270],
    ["corsair", "DEX", "STR", "gun", 3.6, 4, 380],
    ["night_lord", "LUK", "DEX", "claw", 3.6, 25, 150],
  ] as const)(
    "%s has the frozen reference constants",
    (id, main, sub, weapon, weaponConstant, minimumSub, skillPercent) => {
      expect(JOB_RULES[id]).toMatchObject({
        mainStat: main,
        subStat: sub,
        weapon,
        weaponConstant,
        minimumSub,
        defaultSkillPercent: skillPercent,
      });
    },
  );

  it("creates equipment records with the projectile attack default", () => {
    const input = createDefaultInput("corsair");

    expect(input.character.level).toBe("160");
    expect(input.character.job).toBe("corsair");
    expect(input.character).toMatchObject({
      mapleWarrior: 20,
      skillPercent: "380",
      sharpEyes: "none",
      monsterDefense: "",
      bossAndTotalDamage: "",
      ignoreDefense: "",
      criticalRate: "",
      manualPureSub: "",
      nightLordStrStat: "",
      guildBossLevel: 0,
      guildIgnoreLevel: 0,
      guildAttackLevel: 0,
      guildActiveBoss: false,
    });
    expect(input.equipment.weapon).toBeDefined();
    expect(input.equipment.overall).toBeDefined();
    expect(input.equipment.top).toBeUndefined();
    expect(Object.keys(input.equipment)).toHaveLength(20);
    expect(Object.values(input.equipment)).toEqual(
      JOB_RULES.corsair.visibleSlots.map(slot => ({
        mainFlat: "",
        subFlat: "",
        mainPercent: "",
        subPercent: "",
        attackFlat: slot === "projectile" ? "20" : "",
        attackPercent: "",
        requiredSub: "",
      })),
    );
  });
});
