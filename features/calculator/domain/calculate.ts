import { allocatePureStats, sumEquipment } from "./equipment";
import {
  calculateConvertedAttack,
  calculateCriticalMultiplier,
  calculateDefenseMultiplier,
  calculateStatAttack,
  calculateTotalAttack,
  calculateTotalStat,
  mapleWarriorRate,
} from "./formulas";
import { JOB_RULES } from "./job-rules";
import { normalizeInput } from "./normalize";
import type {
  CalculatorInput,
  CalculationResult,
  GuildSkillLevel,
  JobId,
  MapleWarrior,
  SharpEyes,
  ValidationIssue,
} from "./types";

export type CalculationSnapshot = {
  job: JobId;
  level: number;
  mapleWarrior: MapleWarrior;
  equipmentMain: number;
  equipmentSub: number;
  mainPercent: number;
  subPercent: number;
  nightLordStrStat: number;
  percentEligibleAttack: number;
  flatAttack: number;
  attackPercent: number;
  bossAndTotalDamage: number;
  monsterDefense: number;
  ignoreDefense: number;
  criticalRate?: number;
  skillPercent: number;
  sharpEyes: SharpEyes;
  guildBossLevel: GuildSkillLevel;
  guildIgnoreLevel: GuildSkillLevel;
  guildAttackLevel: GuildSkillLevel;
  guildActiveBoss: boolean;
  pureMain?: number;
  pureSub?: number;
  issues?: ValidationIssue[];
};

const SHARP_EYES_BONUSES: Record<
  SharpEyes,
  { criticalRate: number; criticalDamage: number }
> = {
  none: { criticalRate: 0, criticalDamage: 0 },
  usable: { criticalRate: 10, criticalDamage: 115 },
  sharp_30: { criticalRate: 15, criticalDamage: 140 },
};

export function calculateFromSnapshot(
  snapshot: CalculationSnapshot,
): CalculationResult {
  const rule = JOB_RULES[snapshot.job];
  const defenseMultiplier = calculateDefenseMultiplier(
    snapshot.monsterDefense,
    snapshot.ignoreDefense + snapshot.guildIgnoreLevel * 2,
  );
  const sharpEyes = SHARP_EYES_BONUSES[snapshot.sharpEyes];
  const criticalMultiplier = calculateCriticalMultiplier(
    rule.baseCriticalRate + (snapshot.criticalRate ?? 0) + sharpEyes.criticalRate,
    rule.baseCriticalDamage + sharpEyes.criticalDamage,
    snapshot.skillPercent,
  );
  const bossAndTotalDamage = snapshot.bossAndTotalDamage
    + snapshot.guildBossLevel
    + (snapshot.guildActiveBoss ? 10 : 0);

  if (snapshot.level < 1) {
    return {
      mainStat: 0,
      subStat: 0,
      extraStr: 0,
      totalAttack: 0,
      statAttack: 0,
      convertedAttack: 0,
      defenseMultiplier,
      criticalMultiplier,
      formulaInputs: {
        bossAndTotalDamage,
      },
      pureMain: 0,
      pureSub: 0,
      issues: snapshot.issues ?? [],
    };
  }

  const warriorRate = mapleWarriorRate(snapshot.mapleWarrior);
  const defaultAllocation = allocatePureStats({
    level: snapshot.level,
    mapleWarriorRate: warriorRate,
    minimumSub: rule.minimumSub,
    equipmentSub: snapshot.equipmentSub,
    equipmentSubPercent: snapshot.subPercent,
    requirements: [],
    manualPureSub: null,
  });
  const pureMain = snapshot.pureMain ?? defaultAllocation.pureMain;
  const pureSub = snapshot.pureSub ?? defaultAllocation.pureSub;
  const mainStat = calculateTotalStat(
    pureMain,
    snapshot.equipmentMain,
    snapshot.mainPercent,
    warriorRate,
  );
  const subStat = calculateTotalStat(
    pureSub,
    snapshot.equipmentSub,
    snapshot.subPercent,
    warriorRate,
  );
  const extraStr = snapshot.job === "night_lord"
    ? snapshot.nightLordStrStat
    : 0;
  const totalAttack = calculateTotalAttack(
    snapshot.percentEligibleAttack,
    snapshot.flatAttack + snapshot.guildAttackLevel,
    snapshot.attackPercent,
  );
  const statAttack = calculateStatAttack(
    mainStat,
    subStat,
    extraStr,
    rule.weaponConstant,
    totalAttack,
  );
  const convertedAttack = calculateConvertedAttack(
    statAttack,
    bossAndTotalDamage,
    defenseMultiplier,
    criticalMultiplier,
  );

  return {
    mainStat,
    subStat,
    extraStr,
    totalAttack,
    statAttack,
    convertedAttack,
    defenseMultiplier,
    criticalMultiplier,
    formulaInputs: {
      bossAndTotalDamage,
    },
    pureMain,
    pureSub,
    issues: snapshot.issues ?? [],
  };
}

export function calculateDamageResult(input: CalculatorInput): CalculationResult {
  const normalized = normalizeInput(input);
  const character = normalized.value.character;
  const rule = JOB_RULES[character.job];
  const equipment = sumEquipment(normalized.value.equipment, rule);
  const isWeaponAttackMissing =
    (input.equipment.weapon?.attackFlat ?? "").trim() === "";
  const missingWeaponAttackIssues: ValidationIssue[] =
    isWeaponAttackMissing
      ? [{
          severity: "warning",
          path: "equipment.weapon.attackFlat",
          code: "MISSING_WEAPON_ATTACK",
          message: "Enter a weapon attack value to calculate damage.",
        }]
      : [];
  const warriorRate = mapleWarriorRate(character.mapleWarrior);
  const allocation = allocatePureStats({
    level: character.level,
    mapleWarriorRate: warriorRate,
    minimumSub: rule.minimumSub,
    equipmentSub: equipment.subFlat,
    equipmentSubPercent: equipment.subPercent,
    requirements: equipment.requirements,
    manualPureSub: character.manualPureSub,
  });

  return calculateFromSnapshot({
    job: character.job,
    level: character.level,
    mapleWarrior: character.mapleWarrior,
    equipmentMain: equipment.mainFlat,
    equipmentSub: equipment.subFlat,
    mainPercent: equipment.mainPercent,
    subPercent: equipment.subPercent,
    nightLordStrStat: character.nightLordStrStat,
    percentEligibleAttack: equipment.percentEligibleAttack,
    flatAttack: equipment.flatAttack,
    attackPercent: equipment.attackPercent,
    bossAndTotalDamage: character.bossAndTotalDamage,
    monsterDefense: character.monsterDefense,
    ignoreDefense: character.ignoreDefense,
    criticalRate: character.criticalRate,
    skillPercent: character.skillPercent,
    sharpEyes: character.sharpEyes,
    guildBossLevel: character.guildBossLevel,
    guildIgnoreLevel: character.guildIgnoreLevel,
    guildAttackLevel: character.guildAttackLevel,
    guildActiveBoss: character.guildActiveBoss,
    pureMain: allocation.pureMain,
    pureSub: allocation.pureSub,
    issues: [
      ...normalized.issues,
      ...allocation.issues,
      ...missingWeaponAttackIssues,
    ],
  });
}
