import { describe, expect, it } from "vitest";
import {
  calculateDamageResult,
  calculateFromSnapshot,
} from "@/features/calculator/domain/calculate";
import { createDefaultInput } from "@/features/calculator/domain/defaults";

const common = {
  level: 160,
  mapleWarrior: 20 as const,
  equipmentMain: 100,
  equipmentSub: 50,
  mainPercent: 50,
  subPercent: 10,
  nightLordStrStat: 0,
  percentEligibleAttack: 100,
  flatAttack: 30,
  attackPercent: 10,
  bossAndTotalDamage: 20,
  monsterDefense: 60,
  ignoreDefense: 30,
  sharpEyes: "none" as const,
  guildBossLevel: 0 as const,
  guildIgnoreLevel: 0 as const,
  guildAttackLevel: 0 as const,
  guildActiveBoss: false,
};

describe("2026-07-27 행성.com frozen cases", () => {
  it.each([
    ["marksman", 7430, 7165],
    ["corsair", 7430, 6241],
    ["night_lord", 7300, 8176],
  ] as const)("matches %s", (job, statAttack, convertedAttack) => {
    expect(calculateFromSnapshot({
      ...common,
      job,
      nightLordStrStat: job === "night_lord" ? 4 : 0,
      skillPercent: job === "marksman" ? 270 : job === "corsair" ? 380 : 150,
    })).toMatchObject({ statAttack, convertedAttack });
  });
});

it.each([
  ["usable", 2.075],
  ["sharp_30", 2.32],
] as const)("applies the %s Sharp Eyes bonuses", (sharpEyes, criticalMultiplier) => {
  expect(calculateFromSnapshot({
    ...common,
    job: "marksman",
    skillPercent: 100,
    sharpEyes,
  }).criticalMultiplier).toBeCloseTo(criticalMultiplier, 12);
});

it("applies guild attack and ignore increments", () => {
  expect(calculateFromSnapshot({
    ...common,
    job: "corsair",
    skillPercent: 380,
    guildIgnoreLevel: 5,
    guildAttackLevel: 5,
  })).toMatchObject({
    totalAttack: 145,
    defenseMultiplier: 0.8,
    statAttack: 7696,
  });
});

it.each([
  [1, false, 6293],
  [5, false, 6501],
  [0, true, 6761],
] as const)(
  "applies guild boss level %s and active=%s independently",
  (guildBossLevel, guildActiveBoss, convertedAttack) => {
    expect(calculateFromSnapshot({
      ...common,
      job: "corsair",
      skillPercent: 380,
      guildBossLevel,
      guildActiveBoss,
    }).convertedAttack).toBe(convertedAttack);
  },
);

it("orchestrates normalized equipment and AP allocation", () => {
  const input = createDefaultInput("marksman");
  input.character.bossAndTotalDamage = "20";
  input.character.monsterDefense = "60";
  input.character.ignoreDefense = "30";
  input.equipment.weapon!.mainFlat = "100";
  input.equipment.weapon!.subFlat = "50";
  input.equipment.weapon!.mainPercent = "50";
  input.equipment.weapon!.subPercent = "10";
  input.equipment.weapon!.attackFlat = "100";
  input.equipment.weapon!.attackPercent = "10";
  input.equipment.projectile!.attackFlat = "30";

  expect(calculateDamageResult(input)).toMatchObject({
    mainStat: 1458,
    subStat: 59,
    totalAttack: 140,
    statAttack: 7430,
    convertedAttack: 7165,
    pureMain: 818,
    pureSub: 4,
    issues: [],
  });
});

it("propagates normalization and AP allocation issues", () => {
  const input = createDefaultInput("marksman");
  input.character.level = "1";
  input.equipment.hat!.mainFlat = "not-a-number";
  input.equipment.weapon!.attackFlat = "1";
  input.equipment.weapon!.requiredSub = "9999";

  const result = calculateDamageResult(input);

  expect(result).toMatchObject({ pureMain: 0, pureSub: 17 });
  expect(result.issues.map(({ code }) => code)).toEqual([
    "INVALID_NUMBER",
    "UNMET_SUBSTAT_REQUIREMENT",
  ]);
});

it("returns a complete zero-damage result with a missing weapon warning", () => {
  expect(calculateDamageResult(createDefaultInput("corsair"))).toMatchObject({
    mainStat: 899,
    subStat: 4,
    extraStr: 0,
    totalAttack: 0,
    statAttack: 0,
    convertedAttack: 0,
    defenseMultiplier: 1,
    criticalMultiplier: 1,
    pureMain: 818,
    pureSub: 4,
    issues: [{
      severity: "warning",
      path: "equipment.weapon.attackFlat",
      code: "MISSING_WEAPON_ATTACK",
    }],
  });
});

it("does not treat an explicit zero weapon attack as a missing field", () => {
  const input = createDefaultInput("corsair");
  input.equipment.weapon!.attackFlat = "0";

  expect(calculateDamageResult(input).issues).not.toContainEqual(
    expect.objectContaining({ code: "MISSING_WEAPON_ATTACK" }),
  );
});

it("passes normalized critical rate into the critical multiplier", () => {
  const input = createDefaultInput("marksman");
  input.character.skillPercent = "100";
  input.character.criticalRate = "10";
  input.equipment.weapon!.attackFlat = "1";

  expect(calculateDamageResult(input).criticalMultiplier).toBe(1.5);
});

it("uses Night Lord stat-window STR directly in stat attack", () => {
  const input = createDefaultInput("night_lord");
  input.character.nightLordStrStat = "4";
  input.equipment.weapon!.attackFlat = "100";

  expect(calculateDamageResult(input)).toMatchObject({
    extraStr: 4,
    statAttack: 3184,
  });
});
