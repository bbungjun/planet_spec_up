import type { CalculatorInput, CharacterInput, EquipmentInput, EquipmentSlot } from "./domain/types";

export const STORAGE_KEY = "planet-lab:damage-setup:v1";

export type SavedSetupV1 = {
  schemaVersion: 1;
  savedAt: string;
  input: CalculatorInput;
};

const characterKeys = [
  "job",
  "level",
  "mapleWarrior",
  "skillPercent",
  "sharpEyes",
  "monsterDefense",
  "bossAndTotalDamage",
  "ignoreDefense",
  "criticalRate",
  "manualPureSub",
  "nightLordStrStat",
  "guildBossLevel",
  "guildIgnoreLevel",
  "guildAttackLevel",
  "guildActiveBoss",
] as const satisfies readonly (keyof CharacterInput)[];

const equipmentKeys = [
  "mainFlat",
  "subFlat",
  "mainPercent",
  "subPercent",
  "attackFlat",
  "attackPercent",
  "requiredSub",
] as const satisfies readonly (keyof EquipmentInput)[];

const equipmentSlots = [
  "necklace", "cape", "earrings", "eye", "face", "hat", "shoes", "gloves", "overall", "top", "bottom",
  "weapon", "title", "ring_1", "ring_2", "ring_3", "ring_4", "projectile", "blessing_1", "blessing_2", "buff",
] as const satisfies readonly EquipmentSlot[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function isCharacterInput(value: unknown): value is CharacterInput {
  if (!isRecord(value) || !hasOnlyKeys(value, characterKeys)) return false;

  return (value.job === "marksman" || value.job === "corsair" || value.job === "night_lord")
    && typeof value.level === "string"
    && (value.mapleWarrior === 0 || value.mapleWarrior === 20 || value.mapleWarrior === 30)
    && typeof value.skillPercent === "string"
    && (value.sharpEyes === "none" || value.sharpEyes === "usable" || value.sharpEyes === "sharp_30")
    && typeof value.monsterDefense === "string"
    && typeof value.bossAndTotalDamage === "string"
    && typeof value.ignoreDefense === "string"
    && typeof value.criticalRate === "string"
    && typeof value.manualPureSub === "string"
    && typeof value.nightLordStrStat === "string"
    && isGuildSkillLevel(value.guildBossLevel)
    && isGuildSkillLevel(value.guildIgnoreLevel)
    && isGuildSkillLevel(value.guildAttackLevel)
    && typeof value.guildActiveBoss === "boolean";
}

function isGuildSkillLevel(value: unknown): value is 0 | 1 | 2 | 3 | 4 | 5 {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function isEquipmentInput(value: unknown): value is EquipmentInput {
  return isRecord(value)
    && hasOnlyKeys(value, equipmentKeys)
    && equipmentKeys.every((key) => typeof value[key] === "string");
}

function isCalculatorInput(value: unknown): value is CalculatorInput {
  if (!isRecord(value) || !hasOnlyKeys(value, ["character", "equipment"])) return false;
  if (!isCharacterInput(value.character) || !isRecord(value.equipment)) return false;

  return Object.entries(value.equipment).every(
    ([slot, equipment]) => equipmentSlots.includes(slot as EquipmentSlot) && isEquipmentInput(equipment),
  );
}

export function serializeSetup(input: CalculatorInput, savedAt = new Date().toISOString()): string {
  return JSON.stringify({ schemaVersion: 1, savedAt, input } satisfies SavedSetupV1);
}

export function deserializeSetup(raw: string):
  | { ok: true; value: SavedSetupV1 }
  | { ok: false; message: string } {
  try {
    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed) || !hasOnlyKeys(parsed, ["schemaVersion", "savedAt", "input"])) {
      return { ok: false, message: "invalid saved setup" };
    }

    if (parsed.schemaVersion !== 1) return { ok: false, message: "unsupported saved setup version" };
    if (typeof parsed.savedAt !== "string" || !isCalculatorInput(parsed.input)) {
      return { ok: false, message: "invalid saved setup" };
    }

    return { ok: true, value: parsed as SavedSetupV1 };
  } catch {
    return { ok: false, message: "invalid saved setup" };
  }
}
