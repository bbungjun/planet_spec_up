import type {
  CalculatorInput,
  EquipmentInput,
  EquipmentSlot,
  ValidationIssue,
} from "./types";
import { MAX_CHARACTER_LEVEL, pureStatPool } from "./level";

export type NumberRule = {
  path: string;
  min: number;
  max: number;
  integer?: boolean;
};

export type NormalizedEquipmentInput = Record<keyof EquipmentInput, number>;

export type NormalizedCharacterInput = {
  job: CalculatorInput["character"]["job"];
  level: number;
  mapleWarrior: CalculatorInput["character"]["mapleWarrior"];
  skillPercent: number;
  sharpEyes: CalculatorInput["character"]["sharpEyes"];
  monsterDefense: number;
  bossAndTotalDamage: number;
  totalDamagePercent: number;
  bossDamagePercent: number;
  ignoreDefense: number;
  criticalRate: number;
  manualPureSub: number | null;
  nightLordStrStat: number;
  guildBossLevel: CalculatorInput["character"]["guildBossLevel"];
  guildIgnoreLevel: CalculatorInput["character"]["guildIgnoreLevel"];
  guildAttackLevel: CalculatorInput["character"]["guildAttackLevel"];
  guildActiveBoss: boolean;
  guildBossPercent: number;
  guildIgnorePercent: number;
  guildAttackFlat: number;
  guildAccuracyFlat: number;
  pureMain: number | null;
  pureSub: number | null;
};

export type NormalizedCalculatorInput = {
  character: NormalizedCharacterInput;
  equipment: Partial<Record<EquipmentSlot, NormalizedEquipmentInput>>;
};

export type NormalizedInputResult = {
  value: NormalizedCalculatorInput;
  issues: ValidationIssue[];
};

export function parseNumber(
  raw: string,
  rule: NumberRule,
): { value: number; issues: ValidationIssue[] } {
  if (raw.trim() === "") {
    return { value: 0, issues: [] };
  }

  const value = Number(raw);
  if (
    !Number.isFinite(value)
    || value < rule.min
    || value > rule.max
    || (rule.integer === true && !Number.isInteger(value))
  ) {
    return {
      value: 0,
      issues: [{
        severity: "error",
        path: rule.path,
        code: "INVALID_NUMBER",
        message: `Enter a value from ${rule.min} to ${rule.max}.`,
      }],
    };
  }

  return { value, issues: [] };
}

function readNumber(raw: string, rule: NumberRule, issues: ValidationIssue[]): number {
  const parsed = parseNumber(raw, rule);
  issues.push(...parsed.issues);
  return parsed.value;
}

export function normalizeInput(input: CalculatorInput): NormalizedInputResult {
  const issues: ValidationIssue[] = [];
  const level = readNumber(input.character.level, {
    path: "character.level", min: 1, max: MAX_CHARACTER_LEVEL, integer: true,
  }, issues);
  const manualRaw = input.character.manualPureSub;
  const manualPureSub = (input.character.pureMain?.trim() && input.character.pureSub?.trim()) || manualRaw.trim() === ""
    ? null
    : readNumber(manualRaw, {
      path: "character.manualPureSub", min: 0, max: pureStatPool(level), integer: true,
    }, issues);

  const character: NormalizedCharacterInput = {
    job: input.character.job,
    level,
    mapleWarrior: input.character.mapleWarrior,
    skillPercent: readNumber(input.character.skillPercent, {
      path: "character.skillPercent", min: 0, max: 10000,
    }, issues),
    sharpEyes: input.character.sharpEyes,
    monsterDefense: readNumber(input.character.monsterDefense, {
      path: "character.monsterDefense", min: 0, max: 100,
    }, issues),
    bossAndTotalDamage: readNumber(input.character.bossAndTotalDamage, {
      path: "character.bossAndTotalDamage", min: 0, max: 999,
    }, issues),
    totalDamagePercent: readNumber(input.character.totalDamagePercent ?? "", {
      path: "character.totalDamagePercent", min: 0, max: 999,
    }, issues),
    bossDamagePercent: readNumber(input.character.bossDamagePercent ?? "", {
      path: "character.bossDamagePercent", min: 0, max: 999,
    }, issues),
    ignoreDefense: readNumber(input.character.ignoreDefense, {
      path: "character.ignoreDefense", min: 0, max: 100,
    }, issues),
    criticalRate: readNumber(input.character.criticalRate, {
      path: "character.criticalRate", min: 0, max: 100,
    }, issues),
    manualPureSub,
    nightLordStrStat: input.character.job === "night_lord"
      ? readNumber(input.character.nightLordStrStat, {
        path: "character.nightLordStrStat", min: 0, max: 9999, integer: true,
      }, issues)
      : 0,
    guildBossLevel: input.character.guildBossLevel,
    guildIgnoreLevel: input.character.guildIgnoreLevel,
    guildAttackLevel: input.character.guildAttackLevel,
    guildActiveBoss: input.character.guildActiveBoss,
    guildBossPercent: readNumber(input.character.guildBossPercent ?? String(input.character.guildBossLevel), { path: "character.guildBossPercent", min: 0, max: 5, integer: true }, issues),
    guildIgnorePercent: readNumber(input.character.guildIgnorePercent ?? String(input.character.guildIgnoreLevel * 2), { path: "character.guildIgnorePercent", min: 0, max: 10, integer: true }, issues),
    guildAttackFlat: readNumber(input.character.guildAttackFlat ?? String(input.character.guildAttackLevel), { path: "character.guildAttackFlat", min: 0, max: 5, integer: true }, issues),
    guildAccuracyFlat: readNumber(input.character.guildAccuracyFlat ?? "0", { path: "character.guildAccuracyFlat", min: 0, max: 30, integer: true }, issues),
    pureMain: input.character.pureMain?.trim() ? readNumber(input.character.pureMain, { path: "character.pureMain", min: 0, max: pureStatPool(level), integer: true }, issues) : null,
    pureSub: input.character.pureSub?.trim() ? readNumber(input.character.pureSub, { path: "character.pureSub", min: 0, max: pureStatPool(level), integer: true }, issues) : null,
  };

  if ((character.pureMain === null) !== (character.pureSub === null)) issues.push({ severity: "error", code: "INCOMPLETE_PURE_STATS", path: "character.pureMain", message: "능력창의 순수 주스탯·부스탯을 함께 확인해주세요." });
  if (character.pureMain !== null && character.pureSub !== null && character.pureMain + character.pureSub > pureStatPool(level)) issues.push({ severity: "error", code: "INVALID_PURE_STATS", path: "character.pureMain", message: "순수 스탯 합계가 레벨의 AP 범위를 초과합니다. 최종 스탯과 혼동하지 않았는지 확인해주세요." });

  const equipment: NormalizedCalculatorInput["equipment"] = {};
  for (const [slot, values] of Object.entries(input.equipment) as [EquipmentSlot, EquipmentInput][]) {
    equipment[slot] = {
      mainFlat: readNumber(values.mainFlat, {
        path: `equipment.${slot}.mainFlat`, min: 0, max: 9999, integer: true,
      }, issues),
      subFlat: readNumber(values.subFlat, {
        path: `equipment.${slot}.subFlat`, min: 0, max: 9999, integer: true,
      }, issues),
      mainPercent: readNumber(values.mainPercent, {
        path: `equipment.${slot}.mainPercent`, min: 0, max: 999,
      }, issues),
      subPercent: readNumber(values.subPercent, {
        path: `equipment.${slot}.subPercent`, min: 0, max: 999,
      }, issues),
      attackFlat: readNumber(values.attackFlat, {
        path: `equipment.${slot}.attackFlat`, min: 0, max: 9999, integer: true,
      }, issues),
      attackPercent: readNumber(values.attackPercent, {
        path: `equipment.${slot}.attackPercent`, min: 0, max: 999,
      }, issues),
      requiredLevel: readNumber(values.requiredLevel ?? "", { path: `equipment.${slot}.requiredLevel`, min: 0, max: 9999, integer: true }, issues),
      requiredSub: readNumber(values.requiredSub, {
        path: `equipment.${slot}.requiredSub`, min: 0, max: 9999, integer: true,
      }, issues),
      damagePercent: readNumber(values.damagePercent ?? "", {
        path: `equipment.${slot}.damagePercent`, min: 0, max: 999,
      }, issues),
      totalDamagePercent: readNumber(values.totalDamagePercent ?? "", {
        path: `equipment.${slot}.totalDamagePercent`, min: 0, max: 999,
      }, issues),
      bossDamagePercent: readNumber(values.bossDamagePercent ?? "", {
        path: `equipment.${slot}.bossDamagePercent`, min: 0, max: 999,
      }, issues),
      ignoreDefensePercent: readNumber(values.ignoreDefensePercent ?? "", {
        path: `equipment.${slot}.ignoreDefensePercent`, min: 0, max: 100,
      }, issues),
    };
  }

  return { value: { character, equipment }, issues };
}
