import { JOB_RULES } from "./domain/job-rules";
import { MAX_CUSTOM_SLOTS } from "./domain/slots";
import type { CalculatorInput, CharacterInput, EquipmentInput } from "./domain/types";

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
    && Object.keys(value).every(key => key === "damagePercent" || equipmentKeys.some(known => key === known))
    && equipmentKeys.every((key) => typeof value[key] === "string")
    && (!Object.hasOwn(value, "damagePercent") || typeof value.damagePercent === "string");
}

function isCustomSlots(value: unknown): value is NonNullable<CalculatorInput["customSlots"]> {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_SLOTS) return false;
  const seen = new Set<string>();
  return value.every((entry) => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ["id", "label"])) return false;
    if (typeof entry.id !== "string" || !/^extra_[a-zA-Z0-9_-]+$/.test(entry.id)) return false;
    if (typeof entry.label !== "string" || !entry.label.trim() || entry.label.length > 30) return false;
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

function isCalculatorInput(value: unknown): value is CalculatorInput {
  if (!isRecord(value) || (
    !hasOnlyKeys(value, ["character", "equipment"])
    && !hasOnlyKeys(value, ["character", "equipment", "customSlots"])
  )) return false;
  const equipment = value.equipment;
  if (!isCharacterInput(value.character) || !isRecord(equipment)) return false;
  if (value.customSlots !== undefined && !isCustomSlots(value.customSlots)) return false;

  const visibleSlots = JOB_RULES[value.character.job].visibleSlots;
  const allSlots = [...visibleSlots, ...((value.customSlots ?? []) as NonNullable<CalculatorInput["customSlots"]>).map(({ id }) => id)];
  return hasOnlyKeys(equipment, allSlots)
    && allSlots.every((slot) => isEquipmentInput(equipment[slot]));
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
