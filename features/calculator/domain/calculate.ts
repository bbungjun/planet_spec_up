import { checkEquipmentRequirements } from "./requirements";
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
import { activeWeaponPreset } from "./weapon-presets";
import { getVisibleEquipmentSlots } from "./slots";
import { levelAchievementBonus, MAX_CHARACTER_LEVEL } from "./level";
import { stackableAttackBonus } from "./attack-buffs";
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
  totalDamagePercent?: number;
  isBoss?: boolean;
  monsterDefense: number;
  ignoreDefense: number;
  criticalRate?: number;
  skillPercent: number;
  sharpEyes: SharpEyes;
  guildBossLevel: GuildSkillLevel;
  guildIgnoreLevel: GuildSkillLevel;
  guildAttackLevel: GuildSkillLevel;
  guildActiveBoss: boolean;
  guildBossPercent?: number;
  guildIgnorePercent?: number;
  guildAttackFlat?: number;
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
  const guildBoss = snapshot.guildBossPercent ?? snapshot.guildBossLevel;
  const guildIgnore = snapshot.guildIgnorePercent ?? snapshot.guildIgnoreLevel * 2;
  const guildAttack = snapshot.guildAttackFlat ?? snapshot.guildAttackLevel;
  const levelBonus = levelAchievementBonus(snapshot.level);
  const defenseMultiplier = calculateDefenseMultiplier(
    snapshot.monsterDefense,
    snapshot.ignoreDefense + guildIgnore,
  );
  const sharpEyes = SHARP_EYES_BONUSES[snapshot.sharpEyes];
  const criticalMultiplier = calculateCriticalMultiplier(
    rule.baseCriticalRate + (snapshot.criticalRate ?? 0) + sharpEyes.criticalRate,
    rule.baseCriticalDamage + sharpEyes.criticalDamage,
    snapshot.skillPercent,
  );
  const bossAndTotalDamage = (snapshot.totalDamagePercent ?? 0) + (snapshot.isBoss === false ? 0 : snapshot.bossAndTotalDamage
    + guildBoss
    + (snapshot.guildActiveBoss ? 10 : 0));

  if (!Number.isInteger(snapshot.level) || snapshot.level < 1 || snapshot.level > MAX_CHARACTER_LEVEL) {
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
    equipmentSub: snapshot.equipmentSub + levelBonus.allStat,
    equipmentSubPercent: snapshot.subPercent,
    requirements: [],
    manualPureSub: null,
  });
  const pureMain = snapshot.pureMain ?? defaultAllocation.pureMain;
  const pureSub = snapshot.pureSub ?? defaultAllocation.pureSub;
  const mainStat = calculateTotalStat(
    pureMain,
    snapshot.equipmentMain + levelBonus.allStat,
    snapshot.mainPercent,
    warriorRate,
  );
  const subStat = calculateTotalStat(
    pureSub,
    snapshot.equipmentSub + levelBonus.allStat,
    snapshot.subPercent,
    warriorRate,
  );
  const extraStr = snapshot.job === "night_lord"
    ? snapshot.nightLordStrStat
    : 0;
  const totalAttack = calculateTotalAttack(
    snapshot.percentEligibleAttack,
    snapshot.flatAttack + guildAttack + levelBonus.attack,
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
    criticalStats: { baseRate: rule.baseCriticalRate, extraRate: snapshot.criticalRate ?? 0, buffRate: sharpEyes.criticalRate, baseDamage: rule.baseCriticalDamage, buffDamage: sharpEyes.criticalDamage },
    windowStats: {
      totalDamagePercent: snapshot.totalDamagePercent ?? 0,
      bossDamagePercent: snapshot.bossAndTotalDamage + guildBoss + (snapshot.guildActiveBoss ? 10 : 0),
      ignoreDefensePercent: snapshot.ignoreDefense + guildIgnore,
      criticalRate: rule.baseCriticalRate + (snapshot.criticalRate ?? 0) + sharpEyes.criticalRate,
    },
    issues: snapshot.issues ?? [],
  };
}

/** Shared current conditions, including the current pure-stat allocation. */
export function createCalculationSnapshot(input: CalculatorInput): CalculationSnapshot {
  const normalized = normalizeInput(input);
  const character = normalized.value.character;
  const sumOption = (field: "damagePercent" | "totalDamagePercent" | "bossDamagePercent" | "ignoreDefensePercent") =>
    getVisibleEquipmentSlots(input).reduce((sum, slot) => sum + (normalized.value.equipment[slot]?.[field] ?? 0), 0);
  const legacyIssues: ValidationIssue[] = [];
  const legacyPaths = [
    ...(character.bossAndTotalDamage > 0 ? ["character.bossAndTotalDamage"] : []),
    ...getVisibleEquipmentSlots(input).filter(slot => (normalized.value.equipment[slot]?.damagePercent ?? 0) > 0).map(slot => `equipment.${slot}.damagePercent`),
  ];
  for (const path of legacyPaths) {
    legacyIssues.push({ severity: "warning", code: "LEGACY_DAMAGE_SPLIT", path,
      message: "기존 보공·총데미지 합산값은 보스전에만 적용됩니다. 정확한 사냥 계산을 위해 기존 값을 비우고 보공/총데미지를 분리 입력하세요." });
  }
  const rule = JOB_RULES[character.job];
  const equipment = sumEquipment(
    normalized.value.equipment,
    rule,
    (input.customSlots ?? []).map(({ id }) => id),
  );
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
    equipmentSub: equipment.subFlat + levelAchievementBonus(character.level).allStat,
    equipmentSubPercent: equipment.subPercent,
    requirements: equipment.requirements,
    manualPureSub: character.pureSub ?? character.manualPureSub,
  });

  return {
    job: character.job,
    level: character.level,
    mapleWarrior: character.mapleWarrior,
    equipmentMain: equipment.mainFlat,
    equipmentSub: equipment.subFlat,
    mainPercent: equipment.mainPercent,
    subPercent: equipment.subPercent,
    nightLordStrStat: character.nightLordStrStat,
    percentEligibleAttack: equipment.percentEligibleAttack,
    flatAttack: equipment.flatAttack + stackableAttackBonus(input),
    attackPercent: equipment.attackPercent,
    bossAndTotalDamage: character.bossAndTotalDamage + character.bossDamagePercent + sumOption("damagePercent") + sumOption("bossDamagePercent"),
    totalDamagePercent: character.totalDamagePercent + sumOption("totalDamagePercent"),
    isBoss: activeWeaponPreset(input) !== "hunting",
    monsterDefense: character.monsterDefense,
    ignoreDefense: character.ignoreDefense + sumOption("ignoreDefensePercent"),
    criticalRate: character.criticalRate,
    skillPercent: character.skillPercent,
    sharpEyes: character.sharpEyes,
    guildBossLevel: character.guildBossLevel,
    guildIgnoreLevel: character.guildIgnoreLevel,
    guildAttackLevel: character.guildAttackLevel,
    guildActiveBoss: character.guildActiveBoss,
    guildBossPercent: character.guildBossPercent,
    guildIgnorePercent: character.guildIgnorePercent,
    guildAttackFlat: character.guildAttackFlat,
    pureMain: character.pureMain ?? allocation.pureMain,
    pureSub: character.pureSub ?? allocation.pureSub,
    issues: [
      ...normalized.issues,
      ...checkEquipmentRequirements(input, normalized.value),
      ...missingWeaponAttackIssues,
      ...legacyIssues,
    ],
  };
}

export function calculateDamageResult(input: CalculatorInput): CalculationResult {
  return calculateFromSnapshot(createCalculationSnapshot(input));
}
