import { useId } from "react";
import { JOB_RULES } from "../domain/job-rules";
import { RING_SLOTS } from "../domain/slots";
import type { EquipmentInput, EquipmentSlot, JobId } from "../domain/types";

export type ComparisonSlotChoice = { slot: EquipmentSlot; label: string; equipment?: EquipmentInput };

export function RingComparisonTargets({ choices, selected, job, onSelect }: {
  choices: readonly ComparisonSlotChoice[];
  selected: EquipmentSlot | "";
  job: JobId;
  onSelect: (slot: EquipmentSlot) => void;
}) {
  const id = useId(), rule = JOB_RULES[job];
  const fields: Array<[keyof EquipmentInput, string, string]> = [
    ["mainFlat", rule.mainStat, ""], ["subFlat", rule.subStat, ""],
    ["mainPercent", `${rule.mainStat}%`, "%"], ["subPercent", `${rule.subStat}%`, "%"],
    ["attackFlat", "공격력", ""], ["attackPercent", "공격력%", "%"],
    ["criticalRate", "크리확률", "%"],
    ["totalDamagePercent", "총데미지", "%"], ["bossDamagePercent", "보공", "%"],
    ["ignoreDefensePercent", "방무", "%"], ["damagePercent", "구형 보공·총뎀", "%"],
  ];
  return <fieldset className="ring-comparison-targets">
    <legend>기존 반지 옵션 · 교체 대상 선택</legend>
    <div className="ring-target-grid">{RING_SLOTS.flatMap(slot => {
      const choice = choices.find(item => item.slot === slot);
      if (!choice) return [];
      const options = fields.filter(([field]) => choice.equipment?.[field]?.trim());
      return <label key={slot} className={`ring-target-card${selected === slot ? " is-selected" : ""}`}>
        <span className="ring-target-heading">
          <input type="radio" name={`ring-target-${id}`} value={slot} checked={selected === slot}
            aria-label={`${choice.label} 비교 선택`} aria-describedby={`${id}-${slot}-options`} onChange={() => onSelect(slot)} />
          <strong>{choice.label}</strong><span>{selected === slot ? "선택됨" : options.length ? "" : "옵션 미입력"}</span>
        </span>
        <dl id={`${id}-${slot}-options`} className="ring-target-options">
          {options.map(([field, label, suffix]) => <div key={field}><dt>{label}</dt><dd>{choice.equipment![field]}{suffix}</dd></div>)}
          {choice.equipment?.requiredLevel?.trim() && <div><dt>요구 레벨</dt><dd>{choice.equipment.requiredLevel}</dd></div>}
          {choice.equipment?.requiredSub.trim() && <div><dt>요구 {rule.subStat}</dt><dd>{choice.equipment.requiredSub}</dd></div>}
        </dl>
        {!options.length && <small>등록된 옵션이 없습니다.</small>}
      </label>;
    })}</div>
  </fieldset>;
}
