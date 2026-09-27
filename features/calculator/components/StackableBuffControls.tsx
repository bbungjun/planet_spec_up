import { STACKABLE_ATTACK_BUFFS, type StackableAttackBuffId } from "../domain/attack-buffs";
import type { CalculatorInput } from "../domain/types";

type Props = {
  buffs: CalculatorInput["attackBuffs"];
  label?: string;
  onChange: (buff: StackableAttackBuffId, enabled: boolean) => void;
};

export function StackableBuffControls({ buffs, label = "중첩 가능한 공격력 버프", onChange }: Props) {
  return (
    <div className="buff-presets stackable-buffs" role="group" aria-label={label}>
      {STACKABLE_ATTACK_BUFFS.map(({ id, label, attack }) => (
        <button type="button" key={id} aria-label={`${label} +${attack}`} aria-pressed={buffs?.[id] ?? false}
          onClick={() => onChange(id, !buffs?.[id])}>
          <span>{label}</span><strong>+{attack}</strong>
        </button>
      ))}
    </div>
  );
}
