import { emptyEquipment } from "./defaults";
import type { CalculatorInput, WeaponPreset, WeaponPresetId } from "./types";

export const WEAPON_PRESETS = [
  { id: "chaos", label: "카오스 보스용", hint: "방무 무기", defense: "80" },
  { id: "boss", label: "일반 보스용", hint: "보공 무기", defense: "0" },
  { id: "hunting", label: "사냥용", hint: "일반 몬스터 · 보공 제외", defense: "0" },
] as const;

export function activeWeaponPreset(input: CalculatorInput): WeaponPresetId {
  return input.weaponPresets?.active ?? "boss";
}

// The active editor is authoritative. Snapshot only when switching or saving,
// so manual, bulk and OCR edits share exactly the same weapon state.
export function captureWeaponPreset(input: CalculatorInput): CalculatorInput {
  const active = activeWeaponPreset(input);
  return { ...input, weaponPresets: { active, entries: {
    ...input.weaponPresets?.entries,
    [active]: { weapon: { ...(input.equipment.weapon ?? emptyEquipment()) }, monsterDefense: input.character.monsterDefense },
  } } };
}

export function getWeaponPreset(input: CalculatorInput, id: WeaponPresetId): WeaponPreset | undefined {
  if (id === activeWeaponPreset(input)) {
    return { weapon: input.equipment.weapon ?? emptyEquipment(), monsterDefense: input.character.monsterDefense };
  }
  return input.weaponPresets?.entries[id];
}

export function switchWeaponPreset(input: CalculatorInput, id: WeaponPresetId): CalculatorInput {
  if (id === activeWeaponPreset(input)) return input;
  const captured = captureWeaponPreset(input);
  const next = captured.weaponPresets!.entries[id] ?? {
    weapon: emptyEquipment(), monsterDefense: WEAPON_PRESETS.find(preset => preset.id === id)!.defense,
  };
  return {
    ...captured,
    weaponPresets: { ...captured.weaponPresets!, active: id },
    character: { ...captured.character, monsterDefense: next.monsterDefense },
    equipment: { ...captured.equipment, weapon: { ...next.weapon } },
  };
}
