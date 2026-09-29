import { JOB_RULES } from "./domain/job-rules";
import { MAX_CUSTOM_SLOTS } from "./domain/slots";
import { captureWeaponPreset } from "./domain/weapon-presets";
import type { CalculatorInput, CashEquipmentInput, CharacterInput, EquipmentInput } from "./domain/types";
import { isStatWindowSnapshot } from "./domain/statWindow";
import { emptyEquipment } from "./domain/defaults";
import { isPendantCategory, isPendantId } from "./domain/pendants";

export const STORAGE_KEY = "planet-lab:damage-setup:v1";
export const DEVELOPMENT_STORAGE_KEY = "planet-lab:damage-setup:development:v1";
export const CAPTAIN_BETA_STORAGE_KEY = "planet-lab:damage-setup:corsair-beta:v1";
export const ARAN_BETA_STORAGE_KEY = "planet-lab:damage-setup:aran-beta:v1";

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
  const optional = ["totalDamagePercent", "bossDamagePercent", "guildBossPercent", "guildIgnorePercent", "guildAttackFlat", "guildAccuracyFlat", "pureMain", "pureSub", "aranWeaponConstant", "aranFlatAttack", "aranCombo", "aranComboCritical", "aranHighMastery"];
  if (!isRecord(value) || !hasOnlyKeys(
    { ...(value.job === "aran" && !Object.hasOwn(value, "skillPercent") ? { skillPercent: "" } : {}),
      ...Object.fromEntries(Object.entries(value).filter(([key]) => !optional.includes(key))) }, characterKeys,
  )) return false;
  if (optional.some(key => Object.hasOwn(value, key) && typeof value[key] !== (["aranComboCritical", "aranHighMastery"].includes(key) ? "boolean" : "string"))) return false;

  return (value.job === "marksman" || value.job === "corsair" || value.job === "night_lord" || value.job === "aran")
    && typeof value.level === "string"
    && (value.mapleWarrior === 0 || value.mapleWarrior === 20 || value.mapleWarrior === 30)
    && (typeof value.skillPercent === "string" || (value.job === "aran" && !Object.hasOwn(value, "skillPercent")))
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
  const optional = ["pendantId", "requiredLevel", "damagePercent", "totalDamagePercent", "bossDamagePercent", "ignoreDefensePercent"];
  return isRecord(value)
    && Object.keys(value).every(key => optional.includes(key) || equipmentKeys.some(known => key === known))
    && (!Object.hasOwn(value, "pendantId") || isPendantId(value.pendantId))
    && equipmentKeys.every((key) => typeof value[key] === "string")
    && optional.every(key => !Object.hasOwn(value, key) || typeof value[key] === "string");
}

function isWeaponPresets(value: unknown): boolean {
  const ids = ["chaos", "boss", "hunting"];
  return isRecord(value) && hasOnlyKeys(value, ["active", "entries"])
    && typeof value.active === "string" && ids.includes(value.active)
    && isRecord(value.entries) && Object.entries(value.entries).every(([id, entry]) =>
      ids.includes(id) && isRecord(entry) && hasOnlyKeys(entry, ["weapon", "monsterDefense"])
      && isEquipmentInput(entry.weapon) && typeof entry.monsterDefense === "string");
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
  if (!isRecord(value) || !Object.hasOwn(value, "character") || !Object.hasOwn(value, "equipment")
    || !Object.keys(value).every(key => ["character", "equipment", "customSlots", "weaponPresets", "statWindow", "attackBuffs", "cashEquipment"].includes(key))) return false;
  if (Object.hasOwn(value, "cashEquipment") && !isCashEquipmentInput(value.cashEquipment)) return false;
  if (Object.hasOwn(value, "attackBuffs") && (!isRecord(value.attackBuffs)
    || !hasOnlyKeys(value.attackBuffs, ["sprinkling", "rage"])
    || typeof value.attackBuffs.sprinkling !== "boolean"
    || typeof value.attackBuffs.rage !== "boolean")) return false;
  if (Object.hasOwn(value, "statWindow") && !isStatWindowSnapshot(value.statWindow)) return false;
  if (Object.hasOwn(value, "weaponPresets") && !isWeaponPresets(value.weaponPresets)) return false;
  const equipment = value.equipment;
  if (!isCharacterInput(value.character) || !isRecord(equipment)) return false;
  if (value.customSlots !== undefined && !isCustomSlots(value.customSlots)) return false;

  // Pre-pendant saves have only the original necklace key. Validate everything
  // else before migration; never fill in missing records from a damaged save.
  const visibleSlots = JOB_RULES[value.character.job].visibleSlots.filter(slot => slot !== "pendant_2" || Object.hasOwn(equipment, slot));
  const allSlots = [...visibleSlots, ...((value.customSlots ?? []) as NonNullable<CalculatorInput["customSlots"]>).map(({ id }) => id)];
  return hasOnlyKeys(equipment, allSlots)
    && allSlots.every((slot) => isEquipmentInput(equipment[slot]));
}

function isCashEquipmentInput(value: unknown): value is CashEquipmentInput {
  const toggles = ["auroraRing", "weddingRing", "lordHat", "lordShoes", "lordOverall"];
  return isRecord(value) && hasOnlyKeys(value, [...toggles, "auroraRingCount"])
    && toggles.every(key => typeof value[key] === "boolean")
    && typeof value.auroraRingCount === "string";
}

export function serializeSetup(input: CalculatorInput, savedAt = new Date().toISOString()): string {
  // Keep old-format round trips intact until presets are first used.
  return JSON.stringify({ schemaVersion: 1, savedAt, input: input.weaponPresets ? captureWeaponPreset(input) : input } satisfies SavedSetupV1);
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

    const saved = parsed as SavedSetupV1;
    if (!saved.input.equipment.pendant_2) {
      const legacy = saved.input.customSlots?.find(slot => isPendantCategory(slot.label));
      saved.input.equipment.pendant_2 = legacy ? saved.input.equipment[legacy.id]! : emptyEquipment();
      if (legacy) {
        delete saved.input.equipment[legacy.id];
        saved.input.customSlots = saved.input.customSlots!.filter(slot => slot.id !== legacy.id);
      }
    }
    return { ok: true, value: saved };
  } catch {
    return { ok: false, message: "invalid saved setup" };
  }
}
