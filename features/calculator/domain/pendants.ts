import type { CalculatorInput, EquipmentSlot, ValidationIssue } from "./types";

export const PENDANTS = [
  { id: "horntail", label: "혼테일의 목걸이" },
  { id: "chaos_horntail", label: "카오스 혼테일의 목걸이" },
  { id: "yokai", label: "요괴 대사의 염주" },
  { id: "gordon", label: "고든의 마법 인두" },
  { id: "sports_winner", label: "운동회 우승팀 펜던트" },
] as const;
export const PENDANT_SLOTS: readonly EquipmentSlot[] = ["necklace", "pendant_2"];
export const isPendantCategory = (label: string | null | undefined) => /^(?:목걸이|펜던트)(?:\s*\d+)?$/.test(label?.trim() ?? "");
export const isPendantId = (value: unknown): value is string => typeof value === "string" && (value === "" || PENDANTS.some(item => item.id === value));
export const pendantFromName = (name: string | null | undefined): string | undefined => {
  const normalized = name?.normalize("NFKC").replace(/\(\+?\d+\)\s*$/, "").replace(/\s/g, "");
  return PENDANTS.find(item => item.label.replace(/\s/g, "") === normalized)?.id;
};
export const pendantLabel = (id: string | undefined) => PENDANTS.find(item => item.id === id)?.label;
export const isPendantSlot = (input: CalculatorInput, slot: EquipmentSlot) => PENDANT_SLOTS.includes(slot)
  || !!input.customSlots?.some(item => item.id === slot && isPendantCategory(item.label));
export const occupiedPendantSlots = (input: CalculatorInput) =>
  (Object.keys(input.equipment) as EquipmentSlot[]).filter(slot => isPendantSlot(input, slot)
    && Object.values(input.equipment[slot] ?? {}).some(value => value?.trim()));

/** Preserve invalid/legacy input, but never certify its duplicate or excess loadout. */
export function checkPendantRequirements(input: CalculatorInput): ValidationIssue[] {
  const slots = occupiedPendantSlots(input);
  return slots.flatMap(slot => {
    const id = input.equipment[slot]?.pendantId;
    const label = pendantLabel(id);
    const issues: ValidationIssue[] = [];
    if (slots.length > 2) issues.push({ severity: "warning", code: "PENDANT_LIMIT", path: `equipment.${slot}.pendantId`, message: "펜던트 착용 불가: 최대 2개입니다. 남아 있는 추가 펜던트 부위를 정리해주세요." });
    if (label && slots.some(other => other !== slot && input.equipment[other]?.pendantId === id)) issues.push({ severity: "warning", code: "DUPLICATE_PENDANT", path: `equipment.${slot}.pendantId`, message: `${label} 중복 착용 불가: 고유 아이템은 종류별로 1개만 착용할 수 있습니다.` });
    return issues;
  });
}
