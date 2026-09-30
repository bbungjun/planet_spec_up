import { JOB_RULES } from "../domain/job-rules";
import { activeWeaponPreset, WEAPON_PRESETS } from "../domain/weapon-presets";
import type { CalculationResult, CalculatorInput } from "../domain/types";

type Props = { input: CalculatorInput; result: CalculationResult; buffSummary: string; title?: string; labelPrefix?: string };
const number = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 4 });

/** All values belong to the active calculator result; OCR observations are not substituted. */
export function PresetStatWindow({input,result,buffSummary,title,labelPrefix = ""}:Props) {
  const rule=JOB_RULES[input.character.job], preset=WEAPON_PRESETS.find(p=>p.id===activeWeaponPreset(input))!;
  const critical=result.criticalStats;
  const fixed=!!input.character.pureMain?.trim() && !!input.character.pureSub?.trim();
  const invalid=result.issues.some(issue=>issue.severity==="error");
  const holdAran = input.character.job === "aran" && invalid;
  const missingWeapon=result.issues.some(issue=>issue.code==="MISSING_WEAPON_ATTACK");
  if (holdAran) return <section className="preset-stat-window" aria-label={title ?? "선택 프리셋 스탯창"}><header className="preset-stat-heading"><h2>{title ?? "프리셋 스탯창"}</h2><span>아란 · 참고 모델</span></header><p role="status">입력값 확인 필요 · 아란 계산 보류</p><output aria-label={`${labelPrefix}스탯 공격력 결과`}>—</output><output aria-label={`${labelPrefix}환산 공격력 결과`}>—</output></section>;
  return <section className="preset-stat-window" aria-label={title ?? "선택 프리셋 스탯창"}>
    <header className="preset-stat-heading"><div><h2>{title ?? "프리셋 스탯창"}</h2><span>{rule.label} · Lv. {input.character.level || "—"}</span></div><strong>{preset.label}</strong></header>
    <div className="preset-stat-sheet">
      <div className="preset-damage-results">
        <div className="preset-primary-result"><span>최대 스탯 공격력</span><output aria-label={`${labelPrefix}스탯 공격력 결과`}>{holdAran ? "—" : number(result.statAttack)}</output></div>
        <div><span>환산 공격력</span><output aria-label={`${labelPrefix}환산 공격력 결과`}>{holdAran ? "—" : number(result.convertedAttack)}</output></div>
      </div>
      <dl className="preset-base-stats">
        {([[rule.mainStat,result.mainStat,result.pureMain],[rule.subStat,result.subStat,result.pureSub]] as const).map(([stat,total,pure])=><div key={stat}>
          <dt>{stat}</dt><dd><strong>{number(total)}</strong><small aria-label={`${labelPrefix}${stat} 순수 및 추가 스탯`}>순수 {number(pure)} + 추가 {number(total-pure)}</small></dd>
        </div>)}
        {input.character.job==="night_lord" && <div><dt>STR</dt><dd><strong>{number(result.extraStr)}</strong><small>능력창 입력 + 캐시 장비</small></dd></div>}
        <div><dt>공격력</dt><dd><strong>{number(result.totalAttack)}</strong>{input.character.job === "marksman" && <small>엑스퍼트30 +10 포함 · 공% 제외</small>}</dd></div>
      </dl>
      <div className="preset-stat-context"><span>{fixed?"순수 스탯 고정":"순수 스탯 추정"}</span><span aria-label={`${labelPrefix}현재 적용 버프`}>{buffSummary}</span></div>
      <dl className="preset-combat-stats">
        <div><dt>크리확률</dt><dd><strong>{result.windowStats?`${number(result.windowStats.criticalRate)}%`:"—"}</strong>{critical&&<small>기본 {number(critical.baseRate)}{input.character.job === "marksman" ? " (샤프 패시브10 포함)" : ""} + 장비 {number(critical.equipmentRate ?? 0)} + 기타 {number(critical.extraRate)} + 버프 {number(critical.buffRate)}{critical.baseRate+(critical.equipmentRate ?? 0)+critical.extraRate+critical.buffRate>100?" · 100% 상한, 입력 확인 필요":""}</small>}</dd></div>
        <div><dt>{critical?.damageInterpretation === "total" ? "크리데미지 (일반 피해 대비)" : "크리데미지"}</dt><dd><strong>{critical?`${number(critical.totalDamage ?? critical.baseDamage+critical.buffDamage)}%`:"—"}</strong>{critical&&<small>기본 {number(critical.baseDamage)}{input.character.job === "marksman" ? " (샤프 패시브10 포함)" : ""} + 버프 {number(critical.buffDamage)}</small>}</dd></div>
        <div><dt>{critical?.damageInterpretation === "total" ? "크리 기대 보정" : "크리 배율"}</dt><dd><strong>×{result.criticalMultiplier.toFixed(3)}</strong></dd></div>
        <div><dt>보공·총뎀 적용값</dt><dd><strong>{number(result.formulaInputs.bossAndTotalDamage)}%</strong></dd></div>
        {input.character.job==="corsair" && <div><dt>어드밴스드 호밍</dt><dd><strong>{result.formulaInputs.homingDamagePercent ? `+${number(result.formulaInputs.homingDamagePercent)}%p` : "미적용"}</strong><small>{preset.id==="hunting" ? "사냥 프리셋 제외" : "보스 표식 대상 · 총뎀·보공에 가산"}</small></dd></div>}
        <div><dt>방어율 배율</dt><dd><strong>×{result.defenseMultiplier.toFixed(3)}</strong></dd></div>
      </dl>
      {(invalid||missingWeapon)&&<p className="preset-stat-input-notice" role="status">{invalid?"입력값 확인 필요":"무기 공격력 입력 필요"}</p>}
    </div>
  </section>;
}
