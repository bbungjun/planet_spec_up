import { useMemo } from "react";
import { calculateOptionEfficiency, type EfficiencyOption } from "../domain/optionEfficiency";
import { JOB_RULES } from "../domain/job-rules";
import type { CalculatorInput } from "../domain/types";

const number = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 3 });
const gain = (value: number) => value === 0 ? "0%" : value < 0.001 ? "+0.001% 미만" : `+${number(value)}%`;

export function OptionEfficiencyPanel({ input }: { input: CalculatorInput }) {
  const efficiency = useMemo(() => calculateOptionEfficiency(input), [input]);
  const mainStat = JOB_RULES[input.character.job].mainStat;
  const labels: Record<EfficiencyOption, string> = {
    equipmentMain: `${mainStat}(장비) +1`,
    mainPercent: `${mainStat} +1%`,
    percentEligibleAttack: "공격력(장비) +1",
    attackPercent: "공격력 +1%",
    totalDamagePercent: "총데미지 +1%",
    bossAndTotalDamage: "보공 +1%",
    ignoreDefense: "방무 +1%",
    criticalRate: "크리확률 +1%",
  };
  const noMainGain = efficiency.rows[0]?.equivalentMainStat === null;

  return <section className="option-efficiency" aria-label="옵션 효율">
    <header className="option-efficiency-heading">
      <h3>옵션 효율</h3><span>{mainStat} 환산{efficiency.estimated ? " · 추정" : ""}</span>
    </header>
    <div className="option-efficiency-sheet">
      {efficiency.unavailableReason ? <p className="option-efficiency-notice" role="status">{efficiency.unavailableReason}</p> : <>
        <div className="option-efficiency-columns" aria-hidden="true"><span>옵션 · 환산공 상승률</span><span>장비 {mainStat} 환산</span></div>
        <dl className="option-efficiency-rows">
          {efficiency.rows.map(row => <div key={row.option}>
            <dt>{labels[row.option]} <span>({gain(row.increasePercent)})</span></dt>
            <dd><output aria-label={`${labels[row.option]} 주스탯 환산`}>
              {row.equivalentMainStat === null ? "—" : row.option === "equipmentMain" ? "기준" : <>{number(row.equivalentMainStat)} <small>{mainStat}</small></>}
            </output></dd>
          </div>)}
        </dl>
        {noMainGain && <p className="option-efficiency-notice">{mainStat} +1의 상승량이 0이라 주스탯 환산은 표시하지 않습니다.</p>}
        <details className="option-efficiency-details">
          <summary>효율 계산 기준</summary>
          <p>선택 프리셋·버프·순수 스탯을 고정하고 옵션을 각각 1씩 추가합니다. % 옵션은 1%p 추가하며, 기존 버림을 반영한 환산공 상승률입니다.</p>
          <p>주스탯 환산 = 옵션의 환산공 상승량 ÷ 장비 {mainStat} +1의 환산공 상승량. 공격력%는 장비 공격력에만 적용하고 사냥에서는 보공을 제외합니다.</p>
          {efficiency.estimated && <p>순수 스탯 미입력: 현재 추정값을 기준으로 계산합니다.</p>}
        </details>
      </>}
    </div>
  </section>;
}
