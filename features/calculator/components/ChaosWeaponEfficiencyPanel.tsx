import { useId, useState } from "react";
import {
  CHAOS_WEAPON_BASELINES,
  CHAOS_WEAPON_REFERENCE,
  chaosWeaponDefense,
  chaosWeaponGain,
  rankChaosWeaponCombinations,
  type ChaosWeaponBaselineId,
  type ChaosWeaponBossId,
} from "../domain/chaosWeaponEfficiency";

const percentage = (value: number) => Math.abs(value) < 0.005
  ? "0.00%" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

export function ChaosWeaponEfficiencyPanel() {
  const id = useId();
  const [baseline, setBaseline] = useState<ChaosWeaponBaselineId>("boss90");
  const [sortBoss, setSortBoss] = useState<ChaosWeaponBossId>("horntail");
  const [showAll, setShowAll] = useState(false);
  const ranked = rankChaosWeaponCombinations(sortBoss);
  const best = ranked[0];
  const [selectedId, setSelectedId] = useState(best.id);
  const selected = ranked.find(row => row.id === selectedId) ?? best;
  const rows = showAll ? ranked : ranked.slice(0, 5);

  return <details className="panel chaos-weapon-efficiency" id="chaos-weapon-efficiency" aria-label="카오스 보스 무기 효율 비교표">
    <summary className="chaos-efficiency-toggle" aria-label="카오스 보스 무기 효율 비교표">
      <span className="chaos-efficiency-title">카오스 보스 무기 효율</span>
      <span className="chaos-efficiency-reference">길드 기준표</span>
      <span className="chaos-efficiency-toggle-state" aria-hidden="true"><span className="when-closed">펼치기 ＋</span><span className="when-open">접기 −</span></span>
    </summary>
    <div className="chaos-efficiency-body">
      <p className="chaos-efficiency-conditions">120레벨 유니크 · 길드 방무 10% · 보공 5%</p>
      <p className="chaos-efficiency-conditions">기타 보공·총뎀·방무 0 · 호밍 미적용 · 공·스탯·크리 동일</p>
      <div className="chaos-efficiency-controls">
        <label htmlFor={`${id}-baseline`}><span>비교 기준 잠재</span><select id={`${id}-baseline`} value={baseline} onChange={event => setBaseline(event.target.value as ChaosWeaponBaselineId)}>
          {CHAOS_WEAPON_BASELINES.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select></label>
        <div role="group" aria-label="효율순 정렬"><span>높은 효율순 정렬</span><div className="chaos-efficiency-sort">
          {CHAOS_WEAPON_REFERENCE.bosses.map(boss => <button className="secondary-button" type="button" key={boss.id} aria-pressed={sortBoss === boss.id} onClick={() => setSortBoss(boss.id)}>{boss.label} {boss.defense}%</button>)}
        </div></div>
      </div>
      <p className="chaos-efficiency-best">최고 효율 <strong>{best.label}</strong></p>
      <div className="chaos-efficiency-summary" aria-live="polite">
        {CHAOS_WEAPON_REFERENCE.bosses.map(boss => <div key={boss.id}>
          <span>{boss.label} · 기준 대비</span><output aria-label={`${boss.label} 최고 효율 상승률`}>{percentage(chaosWeaponGain(best, boss.defense, baseline))}</output>
        </div>)}
      </div>
      <table className="chaos-efficiency-table" aria-label="잠재 조합별 기준 대비 환산공 상승률">
        <thead><tr><th scope="col">잠재 조합</th>{CHAOS_WEAPON_REFERENCE.bosses.map(boss => <th key={boss.id} scope="col">{boss.label}<small>방어율 {boss.defense}% · 기준 대비</small></th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} className={selected.id === row.id ? "is-selected" : ""}>
          <th scope="row"><button type="button" aria-pressed={selected.id === row.id} aria-label={`${row.label} 방어율 상세`} onClick={() => setSelectedId(row.id)}>
            <span><small className="chaos-efficiency-rank">{row.rank}</small>{row.label}</span><small>보공 {row.boss}% · 방무 {row.ignore}%</small>
          </button></th>
          {CHAOS_WEAPON_REFERENCE.bosses.map(boss => <td key={boss.id}>{percentage(chaosWeaponGain(row, boss.defense, baseline))}</td>)}
        </tr>)}</tbody>
      </table>
      <div className="chaos-efficiency-defense" role="status" aria-label="선택 조합 방어율" aria-live="polite">
        <p>{selected.label} · 합산 방무 {selected.ignore + CHAOS_WEAPON_REFERENCE.guildIgnore}%</p>
        <dl>{CHAOS_WEAPON_REFERENCE.bosses.map(boss => {
          const defense = chaosWeaponDefense(selected, boss.defense);
          return <div key={boss.id}><dt>{boss.label}</dt><dd>잔여 방어율 {defense.remaining}%{defense.excess > 0 && <span> · 초과 방무 {defense.excess}%p</span>}</dd></div>;
        })}</dl>
      </div>
      <div className="chaos-efficiency-footer"><span>{showAll ? `전체 ${ranked.length}개` : `상위 5개 / 전체 ${ranked.length}개`}</span><button className="secondary-button" type="button" aria-expanded={showAll} onClick={() => setShowAll(current => !current)}>{showAll ? "상위 5개만 보기" : `전체 ${ranked.length}개 보기`}</button></div>
      <details className="option-efficiency-details chaos-efficiency-basis"><summary>계산 기준</summary>
        <p>보공·방무 3줄만 비교하는 고정 참고표입니다. 현재 캐릭터·프리셋·길드 입력과 연결되지 않으며, 순위는 공%·스탯·크확 잠재를 포함하지 않습니다.</p>
        <p>방어율에서 길드·무기 방무 합계를 차감하고, 보스 방어율에 도달하면 추가 방무 효과는 0입니다. 상승률은 최종 버림 전 연속 효율이며 실제 DPS가 아닙니다.</p>
        <p><a href="https://www.xn--oj4b158a.com/" target="_blank" rel="noreferrer">행성.com</a> · <a href="https://mapleplanet.co.kr/news/updates/623" target="_blank" rel="noreferrer">공식 방무·길드 안내</a></p>
      </details>
    </div>
  </details>;
}
