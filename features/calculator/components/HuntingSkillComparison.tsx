import { HUNTING_SKILLS } from "../domain/huntingSkills";
import type { CandidateComparison } from "../domain/candidates";

const number = (value: number) => value.toLocaleString("ko-KR");
const signed = (value: number) => `${value > 0 ? "+" : ""}${number(value)}`;
const percentage = (value: number) => value !== 0 && Math.abs(value) < .01
  ? `${value > 0 ? "+" : "−"}<0.01%`
  : `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;

export function HuntingSkillComparison({ comparison }: { comparison: CandidateComparison }) {
  return <section className="hunting-skill-comparison" aria-label="사냥 스킬 피해 비교">
    <table className="candidate-stat-comparison hunting-skill-table">
      <caption>스킬별 최대 피해 <span>참고값</span></caption>
      <thead><tr><th scope="col">스킬</th><th scope="col">현재</th><th scope="col">교체 후</th><th scope="col">증감</th></tr></thead>
      <tbody>{HUNTING_SKILLS.map(skill => {
        const value = comparison.status === "ready" ? comparison.huntingSkills?.find(row => row.id === skill.id) : undefined;
        return <tr key={skill.id}>
          <th scope="row">{skill.label}<small>{skill.detail}</small></th>
          <td>{value ? number(value.before) : "—"}</td>
          <td>{value ? number(value.after) : "—"}</td>
          <td className={value && value.difference > 0 ? "is-up" : value && value.difference < 0 ? "is-down" : ""}>
            {value ? <><strong>{value.percent === null ? "—" : percentage(value.percent)}</strong><small>{signed(value.difference)}</small></> : "—"}
          </td>
        </tr>;
      })}</tbody>
    </table>
    <p className="hunting-skill-caption">마스터 기준 · 1대상 · 방어·크리·속성·상한 보정 전</p>
    {comparison.status !== "ready" && <p className="hunting-skill-caption">비교 조건 확인 후 표시</p>}
    <details className="hunting-skill-assumptions"><summary>계산 가정·출처</summary>
      <p>빅뱅 전 참고 공식이며 플래닛 실측값이 아닙니다. 직접 공격은 불릿 공격력을 제외하고, 옥토퍼스는 무기 공격력 대신 DEX·STR과 자체 공격력을 사용합니다. 총데미지는 모두 적용합니다.</p>
      <p>속성강화 Lv.30의 200%p는 파이어 버너·쿨링 이펙트에 포함했습니다. 캡슐 보정·화상 지속피해·공격 횟수는 제외하므로 전체 사냥 DPS를 뜻하지 않습니다.</p>
      <ul>
        <li><a href="https://www.southperry.net/printthread.php?tid=21369" target="_blank" rel="noreferrer">2010년 스킬 배율·속성강화</a></li>
        <li><a href="https://www.southperry.net/showthread.php?tid=1033" target="_blank" rel="noreferrer">빅뱅 전 공격·소환수 공식</a></li>
        <li><a href="https://ayumilovemaple.wordpress.com/2008/11/17/maplestory-captain-corsair-skill-build/" target="_blank" rel="noreferrer">에어 스트라이크·옥토퍼스 수치</a></li>
        <li><a href="https://mapleplanet.co.kr/news/updates/492" target="_blank" rel="noreferrer">플래닛 구현 공지 (세부 산식 미공개)</a></li>
      </ul>
    </details>
  </section>;
}
