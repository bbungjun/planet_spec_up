"use client";

import { memo, useMemo, useState } from "react";
import { emptySimulation, SIMULATION_FIELDS, simulateStats, type SimulationField } from "../domain/statSimulation";
import { JOB_RULES } from "../domain/job-rules";
import { activeWeaponPreset, WEAPON_PRESETS } from "../domain/weapon-presets";
import type { CalculatorInput } from "../domain/types";
import { PresetStatWindow } from "./PresetStatWindow";
import { OptionEfficiencyPanel } from "./OptionEfficiencyPanel";

const number = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 3 });
const percent = (value: number | null | undefined) => value == null ? "—"
  : value !== 0 && Math.abs(value) < .01 ? `${value > 0 ? "+" : "−"}<0.01%`
    : `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
const direction = (value: number | null | undefined) => value && value > 0 ? "is-up" : value && value < 0 ? "is-down" : "";

export const StatSimulator = memo(function StatSimulator({ input }: { input: CalculatorInput }) {
  const [deltas, setDeltas] = useState(emptySimulation);
  const simulation = useMemo(() => simulateStats(input, deltas), [input, deltas]);
  const rule = JOB_RULES[input.character.job];
  const preset = WEAPON_PRESETS.find(item => item.id === activeWeaponPreset(input))!;
  const change = (field: SimulationField, value: string) => setDeltas(current => ({ ...current, [field]: value }));
  const step = (field: SimulationField, amount: number) => {
    const current = Number(deltas[field]);
    change(field, String((Number.isFinite(current) ? current : 0) + amount));
  };
  const labels = { equipmentMain: `${rule.mainStat}(장비)`, mainPercent: `${rule.mainStat}%` };
  const invalid = Object.keys(simulation.errors).length > 0;

  return <section className="panel stat-simulator" id="stat-simulator" aria-label="추가 스탯 시뮬레이터">
    <div className="game-window-heading"><span className="game-window-label" aria-hidden="true">STAT SIMULATOR</span><span>수동 스탯 비교</span></div>
    <header className="simulator-heading"><div><h2>추가 스탯 시뮬레이터</h2><p>{preset.label} 기준 · 순수 스탯·버프 고정 · 원래 세팅에 저장되지 않음</p></div>
      <button type="button" className="secondary-button" onClick={() => setDeltas(emptySimulation())}>추가 수치 초기화</button>
    </header>
    {simulation.estimated && <p className="simulator-notice" role="status">순수 스탯 미입력 · 추정 기준 비교</p>}
    <div className="simulator-grid">
      <div className="simulator-inputs">
        <div className="simulator-columns" aria-hidden="true"><span>추가·차감 옵션</span><span>변경량</span><span>단독 환산공 변화</span></div>
        {SIMULATION_FIELDS.map(({ field, label, limit, integer }) => {
          const name = field in labels ? labels[field as keyof typeof labels] : label;
          const error = simulation.errors[field], id = `simulation-${field}`;
          const effect = simulation.isolated?.[field].percent;
          return <div className="simulator-field" key={field}>
            <label htmlFor={id}>{name}</label>
            <div className="simulator-stepper">
              <button type="button" aria-label={`${name} 1 감소`} onClick={() => step(field, -1)}>−</button>
              <input id={id} name={id} autoComplete="off" inputMode={integer ? "numeric" : "decimal"} type="number" aria-label={`추가 ${name}`} min={-limit} max={limit} step={integer ? 1 : "any"}
                value={deltas[field]} onChange={event => change(field, event.currentTarget.value)} aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined} />
              <button type="button" aria-label={`${name} 1 증가`} onClick={() => step(field, 1)}>+</button>
            </div>
            <output className={direction(effect)} aria-label={`${name} 단독 환산공 변화`}>{percent(effect)}</output>
            {error && <p className="simulator-field-error" id={`${id}-error`}>{error}</p>}
          </div>;
        })}
        <p className="simulator-note">각 행은 해당 옵션만 바꾼 효과입니다. 전체 결과는 모든 변경량을 함께 계산합니다.</p>
        <table className="simulator-total-table"><caption>전체 적용 결과</caption>
          <thead><tr><th scope="col">항목</th><th scope="col">현재</th><th scope="col">적용 후</th><th scope="col">증감</th></tr></thead>
          <tbody>{([["최대 스탯공", simulation.stat], ["환산공", simulation.converted]] as const).map(([label, value]) =>
            <tr key={label}><th scope="row">{label}</th><td>{value ? number(value.before) : "—"}</td><td>{value ? number(value.after) : "—"}</td>
              <td className={direction(value?.percent)}><strong>{percent(value?.percent)}</strong>{value && <small>{value.difference > 0 ? "+" : ""}{number(value.difference)}</small>}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="simulator-results">
        {simulation.blocked || invalid ? <p className="simulator-notice" role="status">{simulation.blocked ?? "추가 수치의 입력값을 확인해주세요."}</p>
          : simulation.after && <>
            <PresetStatWindow input={input} result={simulation.after} title="적용 후 스탯창" labelPrefix="시뮬레이션 " buffSummary="현재 선택 버프 유지" />
            <OptionEfficiencyPanel input={input} snapshot={simulation.snapshot} />
          </>}
        <details className="simulator-formula"><summary>비교 계산 기준</summary>
          <p>장비 주스탯·공격력과 각 % 옵션의 합계에 변경량을 더한 뒤 기존 계산식과 버림을 적용합니다. % 항목의 변경량은 %p 단위입니다. 공격력%는 장비 공격력에만 적용하며, 사냥에서는 보공을 제외합니다.</p>
          <p>순수 스탯·레벨·버프·공격 대상은 현재 세팅과 같습니다. 환산공은 같은 조건에서 비교하는 지표이며 실제 사냥 전체 피해나 스킬 타격값은 아닙니다.</p>
        </details>
      </div>
    </div>
  </section>;
});
