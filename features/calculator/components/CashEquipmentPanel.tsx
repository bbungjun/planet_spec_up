import { cashEquipmentBonus, createDefaultCashEquipment } from "../domain/cash-equipment";
import { normalizeInput } from "../domain/normalize";
import type { CalculatorInput, CashEquipmentInput, ValidationIssue } from "../domain/types";

export type CashEquipmentChangeHandler = <Field extends keyof CashEquipmentInput>(
  field: Field, value: CashEquipmentInput[Field],
) => void;

type Props = {
  input: CalculatorInput;
  issues: readonly ValidationIssue[];
  onChange: CashEquipmentChangeHandler;
};

export function CashEquipmentPanel({ input, issues, onChange }: Props) {
  const selection = input.cashEquipment ?? createDefaultCashEquipment();
  const bonus = cashEquipmentBonus(normalizeInput(input).value.cashEquipment);
  const error = issues.find(issue => issue.path === "cashEquipment.auroraRingCount" && issue.severity === "error");

  return <section className="panel cash-equipment-panel" aria-labelledby="cash-equipment-heading">
    <div className="panel-heading">
      <div><h2 id="cash-equipment-heading">캐시 장비</h2></div>
      <span className="cash-equipment-note">일반 장비와 함께 착용</span>
    </div>
    <div className="cash-equipment-rings">
      <div className="cash-equipment-item">
        <label className="check-field">
          <input type="checkbox" checked={selection.auroraRing} onChange={event => onChange("auroraRing", event.currentTarget.checked)} />
          <span><strong>오로라 반지</strong><small>기간제 · 1개당 올스탯 +1</small></span>
        </label>
        <div className="field cash-equipment-count">
          <label htmlFor="cash-aurora-ring-count">오로라 반지 개수</label>
          <input id="cash-aurora-ring-count" name="cashEquipment.auroraRingCount" autoComplete="off" inputMode="numeric" type="number" min={0} max={4} step={1}
            value={selection.auroraRingCount} disabled={!selection.auroraRing}
            data-field-path="cashEquipment.auroraRingCount"
            aria-invalid={error ? true : undefined} aria-describedby={error ? "cash-aurora-ring-error" : undefined}
            onChange={event => onChange("auroraRingCount", event.currentTarget.value)} />
          <small>0~4개</small>
        </div>
        {error && <span id="cash-aurora-ring-error" className="field-error">{error.message}</span>}
      </div>
      <div className="cash-equipment-item">
        <label className="check-field">
          <input type="checkbox" checked={selection.weddingRing} onChange={event => onChange("weddingRing", event.currentTarget.checked)} />
          <span><strong>결혼 반지</strong><small>올스탯 +3</small></span>
        </label>
      </div>
    </div>
    <fieldset className="cash-equipment-set">
      <legend>성주 세트 <span>{bonus.lordCount} / 3 착용</span></legend>
      <div className="cash-equipment-lord-items">
        {([
          ["lordHat", "성주의 모자"], ["lordShoes", "성주의 신발"], ["lordOverall", "성주의 한벌옷"],
        ] as const).map(([field, label]) => <label className="check-field cash-equipment-item" key={field}>
          <input type="checkbox" checked={selection[field]} onChange={event => onChange(field, event.currentTarget.checked)} />
          <span><strong>{label}</strong><small>올스탯 +5</small></span>
        </label>)}
      </div>
      <div className="cash-equipment-set-bonuses" aria-label="성주 세트 효과">
        <span className={bonus.lordCount >= 2 ? "is-active" : undefined}>2세트 · 올스탯 +5{bonus.lordCount >= 2 && <b>적용</b>}</span>
        <span className={bonus.lordCount === 3 ? "is-active" : undefined}>3세트 · 공격력 +5{bonus.lordCount === 3 && <b>적용</b>}</span>
      </div>
    </fieldset>
    <output className="cash-equipment-total" aria-label="캐시 장비 적용 합계" aria-live="polite">
      {error ? "오로라 반지 개수를 확인해주세요." : <>적용 합계 <strong>올스탯 +{bonus.allStat}</strong><strong>공격력 +{bonus.attack}</strong></>}
    </output>
  </section>;
}
