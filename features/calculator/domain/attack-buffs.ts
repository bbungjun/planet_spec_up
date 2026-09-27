import type { CalculatorInput } from "./types";

/** These buffs replace the shared, manually editable buff attack value. */
export const ATTACK_BUFF_PRESETS = [
  { label: "없음", attack: 0 },
  { label: "사이다", attack: 10 },
  { label: "혼테일", attack: 30 },
  { label: "핑크빈", attack: 35 },
  { label: "요괴대사", attack: 40 },
] as const;

export const STACKABLE_ATTACK_BUFFS = [
  { id: "sprinkling", label: "뿌리기", attack: 20 },
  { id: "rage", label: "분노", attack: 12 },
] as const;

export type StackableAttackBuffId = typeof STACKABLE_ATTACK_BUFFS[number]["id"];

export function stackableAttackBonus(input: CalculatorInput): number {
  return STACKABLE_ATTACK_BUFFS.reduce((sum, buff) =>
    sum + (input.attackBuffs?.[buff.id] ? buff.attack : 0), 0);
}
