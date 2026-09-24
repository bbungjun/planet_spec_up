import type {
  CalculatorInput,
  EquipmentInput,
  EquipmentSlot,
  ValidationIssue,
} from "./types";

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
  ignoreDefense: number;
  criticalRate: number;
  manualPureSub: number | null;
  nightLordStrStat: number;
  guildBossLevel: CalculatorInput["character"]["guildBossLevel"];
  guildIgnoreLevel: CalculatorInput["character"]["guildIgnoreLevel"];
  guildAttackLevel: CalculatorInput["character"]["guildAttackLevel"];
  guildActiveBoss: boolean;
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

function apPool(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 200) return 0;
  return level * 5 + (level >= 120 ? 22 : level >= 70 ? 17 : 12);
}

function readNumber(raw: string, rule: NumberRule, issues: ValidationIssue[]): number {
  const parsed = parseNumber(raw, rule);
  issues.push(...parsed.issues);
  return parsed.value;
}

export function normalizeInput(input: CalculatorInput): NormalizedInputResult {
  const issues: ValidationIssue[] = [];
  const level = readNumber(input.character.level, {
    path: "character.level", min: 1, max: 200, integer: true,
  }, issues);
  const manualRaw = input.character.manualPureSub;
  const manualPureSub = manualRaw.trim() === ""
    ? null
    : readNumber(manualRaw, {
      path: "character.manualPureSub", min: 0, max: apPool(level), integer: true,
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
  };

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
      requiredSub: readNumber(values.requiredSub, {
        path: `equipment.${slot}.requiredSub`, min: 0, max: 9999, integer: true,
      }, issues),
      damagePercent: readNumber(values.damagePercent ?? "", {
        path: `equipment.${slot}.damagePercent`, min: 0, max: 999,
      }, issues),
    };
  }

  return { value: { character, equipment }, issues };
}
