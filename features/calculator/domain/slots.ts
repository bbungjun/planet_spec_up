import { JOB_RULES } from "./job-rules";
import { emptyEquipment } from "./defaults";
import { EQUIPMENT_SLOT_LABELS } from "../labels";
import type { BuiltinEquipmentSlot, CalculatorInput, CustomEquipmentSlot, EquipmentSlot } from "./types";

const builtinIds = new Set<EquipmentSlot>(Object.keys(EQUIPMENT_SLOT_LABELS) as BuiltinEquipmentSlot[]);
export const MAX_CUSTOM_SLOTS = 50;

export function getVisibleEquipmentSlots(input: CalculatorInput): EquipmentSlot[] {
  return [...JOB_RULES[input.character.job].visibleSlots, ...(input.customSlots ?? []).map(({ id }) => id)];
}

export function getEquipmentSlotLabel(input: CalculatorInput, slot: EquipmentSlot): string {
  if (builtinIds.has(slot)) return EQUIPMENT_SLOT_LABELS[slot as BuiltinEquipmentSlot];
  return input.customSlots?.find(({ id }) => id === slot)?.label ?? "추가 장비";
}

export function addEquipmentSlot(input: CalculatorInput, requestedLabel: string):
  | { input: CalculatorInput; slot: CustomEquipmentSlot }
  | null {
  const label = requestedLabel.trim().replace(/\s+/g, " ");
  if (!label || label.length > 30 || (input.customSlots?.length ?? 0) >= MAX_CUSTOM_SLOTS) return null;
  const usedLabels = new Set(getVisibleEquipmentSlots(input).map(slot => getEquipmentSlotLabel(input, slot)));
  let displayLabel = label;
  for (let index = 2; usedLabels.has(displayLabel); index += 1) {
    const suffix = ` ${index}`;
    displayLabel = `${label.slice(0, 30 - suffix.length)}${suffix}`;
  }
  const unique = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const id = `extra_${unique}` as CustomEquipmentSlot;
  return {
    slot: id,
    input: {
      ...input,
      customSlots: [...(input.customSlots ?? []), { id, label: displayLabel }],
      equipment: { ...input.equipment, [id]: emptyEquipment() },
    },
  };
}

export function removeEquipmentSlot(input: CalculatorInput, slot: EquipmentSlot): CalculatorInput {
  if (!input.customSlots?.some(({ id }) => id === slot)) return input;
  const equipment = { ...input.equipment };
  delete equipment[slot];
  return {
    ...input,
    customSlots: input.customSlots.filter(({ id }) => id !== slot),
    equipment,
  };
}
