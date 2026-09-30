import { describe, expect, it } from "vitest";
import {
  calculateDamageResult,
  calculateFromSnapshot,
} from "@/features/calculator/domain/calculate";
import { createDefaultInput } from "@/features/calculator/domain/defaults";

// Frozen formula cases explicitly exclude guild/projectile/buff bonuses, independent of UI defaults.
function createReferenceInput(job: Parameters<typeof createDefaultInput>[0]) {
  const input = createDefaultInput(job); input.equipment.buff!.attackFlat = "0"; // Fixed no-buff reference.
  input.equipment.projectile!.attackFlat = "0";
  Object.assign(input.character, { guildBossPercent: "0", guildIgnorePercent: "0", guildAttackFlat: "0", guildAccuracyFlat: "0" });
  return input;
}

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
  const input = createReferenceInput("marksman");
  input.character.bossDamagePercent = "20";
  input.character.monsterDefense = "60";
  input.character.ignoreDefense = "30";
  input.equipment.weapon!.mainFlat = "100";
  input.equipment.weapon!.subFlat = "50";
  input.equipment.weapon!.mainPercent = "50";
  input.equipment.weapon!.subPercent = "10";
  input.equipment.weapon!.attackFlat = "100";
  input.equipment.weapon!.attackPercent = "10";
  input.equipment.projectile!.attackFlat = "30";
  input.equipment.weapon!.requiredLevel = "0";
  input.equipment.weapon!.requiredSub = "0";

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

it("reports invalid input without treating estimated AP as verified equipment eligibility", () => {
  const input = createReferenceInput("marksman");
  input.character.level = "1";
  input.equipment.hat!.mainFlat = "not-a-number";
  input.equipment.weapon!.attackFlat = "1";
  input.equipment.weapon!.requiredSub = "9999";

  const result = calculateDamageResult(input);

  expect(result).toMatchObject({ pureMain: 0, pureSub: 17 });
  expect(result.issues.map(({ code }) => code)).toEqual([
    "INVALID_NUMBER",
  ]);
});

it.each([
  ["invalid zero", "0", ["INVALID_NUMBER"]],
  ["blank", "", []],
] as const)("zeros the complete damage result for %s level input", (_, level, issueCodes) => {
  const input = createReferenceInput("corsair");
  input.character.level = level;
  input.equipment.weapon!.mainFlat = "100";
  input.equipment.weapon!.subFlat = "50";
  input.equipment.weapon!.attackFlat = "100";
  input.equipment.weapon!.requiredSub = "9999";

  const result = calculateDamageResult(input);

  expect(result).toMatchObject({
    mainStat: 0,
    subStat: 0,
    extraStr: 0,
    totalAttack: 0,
    statAttack: 0,
    convertedAttack: 0,
    defenseMultiplier: 1,
    criticalMultiplier: 1,
    formulaInputs: {
      bossAndTotalDamage: 0,
    },
    pureMain: 0,
    pureSub: 0,
  });
  expect(result.issues.map(({ code }) => code)).toEqual(issueCodes);
});

it.each([0, 0.5, -1])(
  "zeros every snapshot damage input when level %s is below one",
  (level) => {
    const preservedIssue = {
      severity: "warning" as const,
      path: "equipment.weapon.requiredSub",
      code: "UNMET_SUBSTAT_REQUIREMENT",
      message: "preserved warning",
    };
    const result = calculateFromSnapshot({
      ...common,
      level,
      job: "corsair",
      skillPercent: 380,
      sharpEyes: "sharp_30",
      criticalRate: 10,
      guildBossLevel: 5,
      guildIgnoreLevel: 5,
      guildAttackLevel: 5,
      guildActiveBoss: true,
      pureMain: 99,
      pureSub: 88,
      issues: [preservedIssue],
    });

    expect(result).toMatchObject({
      mainStat: 0,
      subStat: 0,
      extraStr: 0,
      totalAttack: 0,
      statAttack: 0,
      convertedAttack: 0,
      defenseMultiplier: 0.8,
      formulaInputs: {
        bossAndTotalDamage: 35,
      },
      pureMain: 0,
      pureSub: 0,
      issues: [preservedIssue],
    });
    expect(result.criticalMultiplier).toBeCloseTo(1.0921052631578947, 12);
  },
);

it("zeros Night Lord STR and attack for a level-zero snapshot", () => {
  expect(calculateFromSnapshot({
    ...common,
    level: 0,
    job: "night_lord",
    mapleWarrior: 0,
    equipmentMain: 0,
    equipmentSub: 0,
    mainPercent: 0,
    subPercent: 0,
    nightLordStrStat: 4,
    percentEligibleAttack: 100,
    flatAttack: 0,
    attackPercent: 0,
    bossAndTotalDamage: 0,
    monsterDefense: 0,
    ignoreDefense: 0,
    skillPercent: 150,
  })).toMatchObject({
    mainStat: 0,
    subStat: 0,
    extraStr: 0,
    totalAttack: 0,
    statAttack: 0,
    convertedAttack: 0,
    defenseMultiplier: 1,
    criticalMultiplier: 1.3333333333333333,
    formulaInputs: {
      bossAndTotalDamage: 0,
    },
    pureMain: 0,
    pureSub: 0,
    issues: [],
  });
});

it("returns a complete zero-damage result with a missing weapon warning", () => {
  expect(calculateDamageResult(createReferenceInput("corsair"))).toMatchObject({
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
  const input = createReferenceInput("corsair");
  input.equipment.weapon!.attackFlat = "0";

  expect(calculateDamageResult(input).issues).not.toContainEqual(
    expect.objectContaining({ code: "MISSING_WEAPON_ATTACK" }),
  );
});

it("passes normalized critical rate into the critical multiplier", () => {
  const input = createReferenceInput("marksman");
  input.character.skillPercent = "100";
  input.character.criticalRate = "10";
  input.equipment.weapon!.attackFlat = "1";

  expect(calculateDamageResult(input).criticalMultiplier).toBe(1.5);
});

it("uses Night Lord stat-window STR directly in stat attack", () => {
  const input = createReferenceInput("night_lord");
  input.character.nightLordStrStat = "4";
  input.equipment.weapon!.attackFlat = "100";

  expect(calculateDamageResult(input)).toMatchObject({
    extraStr: 4,
    statAttack: 3184,
  });
});
