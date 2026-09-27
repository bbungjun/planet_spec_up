import { JOB_RULES } from "./job-rules";
import { emptyEquipment } from "./defaults";
import { EQUIPMENT_SLOT_LABELS } from "../labels";
import { isPendantCategory, pendantFromName, PENDANT_SLOTS } from "./pendants";
import type { BuiltinEquipmentSlot, CalculatorInput, CustomEquipmentSlot, EquipmentSlot } from "./types";

const builtinIds = new Set<EquipmentSlot>(Object.keys(EQUIPMENT_SLOT_LABELS) as BuiltinEquipmentSlot[]);
export const MAX_CUSTOM_SLOTS = 50;
export const RING_SLOTS: readonly EquipmentSlot[] = ["ring_1", "ring_2", "ring_3", "ring_4"];

export function isNonEquipmentSlot(slot: EquipmentSlot): boolean {
  return slot === "projectile" || slot === "blessing_1" || slot === "blessing_2" || slot === "buff";
}

export function getVisibleEquipmentSlots(input: CalculatorInput): EquipmentSlot[] {
  // Non-equipment attack remains in the saved/calculated sources, but is entered
  // directly in attack settings instead of equipment cards, bulk editing or OCR.
  return [...JOB_RULES[input.character.job].visibleSlots.filter(slot => !isNonEquipmentSlot(slot)), ...(input.customSlots ?? []).map(({ id }) => id)];
}

export function getEquipmentSlotLabel(input: CalculatorInput, slot: EquipmentSlot): string {
  if (builtinIds.has(slot)) return EQUIPMENT_SLOT_LABELS[slot as BuiltinEquipmentSlot];
  return input.customSlots?.find(({ id }) => id === slot)?.label ?? "추가 장비";
}

export function addEquipmentSlot(input: CalculatorInput, requestedLabel: string):
  | { input: CalculatorInput; slot: CustomEquipmentSlot }
  | null {
  const label = requestedLabel.trim().replace(/\s+/g, " ");
  if (isPendantCategory(label) || pendantFromName(label)) return null;
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

const categories: Record<string, EquipmentSlot[]> = {
  모자: ["hat"], 망토: ["cape"], 귀고리: ["earrings"], 귀걸이: ["earrings"],
  얼굴장식: ["face"], 눈장식: ["eye"], 펜던트: ["necklace", "pendant_2"], 목걸이: ["necklace", "pendant_2"],
  장갑: ["gloves"], 신발: ["shoes"], 한벌옷: ["overall"], 상의: ["top"], 하의: ["bottom"],
  반지: ["ring_1", "ring_2", "ring_3", "ring_4"], 훈장: ["title"],
  건: ["weapon"], 석궁: ["weapon"], 아대: ["weapon"], 무기: ["weapon"],
};

export function matchingSlots<T extends {slot: EquipmentSlot; label: string}>(category: string | null, choices: T[]): T[] {
  if (!category) return [];
  if (isPendantCategory(category)) return choices.filter(({ slot }) => PENDANT_SLOTS.includes(slot));
  if (category === "반지") return choices.filter(({ slot }) => RING_SLOTS.includes(slot));
  const known = Object.hasOwn(categories, category) ? categories[category] : [];
  return choices.filter(({slot, label}) => known.includes(slot) || label.replace(/\s+\d+$/, "") === category);
}
