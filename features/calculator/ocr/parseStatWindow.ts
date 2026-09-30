/**
 * 능력창 판독에서 직업·레벨·순수/최종 스탯과 공격력 범위를 해석하는 보존된 모듈.
 * 현재 수동 순수 스탯 UI와 별개이며 검산 관계와 미완성 초안을 유지한다.
 */
import { JOB_RULES } from "../domain/job-rules";
import { isStatWindowSnapshot } from "../domain/statWindow";
import type { JobId, StatWindowSnapshot } from "../domain/types";
import type { OcrReading } from "./types";

export type StatDraft = { job?: JobId; level?: number; pure: StatWindowSnapshot["pure"]; total: StatWindowSnapshot["total"]; maxAttack?: number; minAttack?: number; totalDamagePercent?: number; bossDamagePercent?: number; ignoreDefensePercent?: number; criticalRate?: number; accuracy?: number };
export type StatRecognition = { draft: StatDraft; warnings: string[]; automatic: boolean };
const clean = (text: string) => text.normalize("NFKC").replace(/,/g, "").replace(/\s/g, "");
/**
 * 같은 텍스트 기준선 근처의 조각을 수평 순서로 묶는다. 좌표 없는 판독은 별도 줄로 남긴다.
 */
export function statRows(readings: OcrReading[]): string[] {
  const positioned = readings.filter(r => r.bounds).sort((a,b) => a.bounds!.y - b.bounds!.y);
  const rows: OcrReading[][] = [];
  for (const item of positioned) {
    const b = item.bounds!;
    const row = rows.find(group => { const a = group[0].bounds!; return Math.abs(a.y + a.height/2 - b.y - b.height/2) < Math.min(a.height,b.height)*.5; });
    if (row) row.push(item); else rows.push([item]);
  }
  return [...rows.map(row => row.sort((a,b) => a.bounds!.x-b.bounds!.x).map(r=>r.text).join(" ")), ...readings.filter(r=>!r.bounds).map(r=>r.text)];
}
/**
 * 능력창 줄에서 값을 읽고 순수+추가=합계 관계 및 같은 필드의 숫자 충돌을 검사한다.
 * 누락·불일치는 warnings에 남기고 이 단계만으로 자동 등록 가능 상태를 만들지 않는다.
 */
export function parseStatWindow(lines: string[]): StatRecognition {
  const draft: StatDraft = { pure: {}, total: {} }, warnings: string[] = [];
  const seen = new Map<string, number>();
  const assign = (key: string, n: number, action: () => void) => {
    if (seen.has(key) && seen.get(key) !== n) { warnings.push(`${key} 인식값이 서로 다릅니다.`); return; }
    seen.set(key,n); action();
  };
  for (const line of lines.map(clean)) {
    for (const [job, rule] of Object.entries(JOB_RULES)) if (line.includes(rule.label)) {
      if (draft.job && draft.job !== job) warnings.push("서로 다른 직업이 감지됐습니다.");
      else draft.job = job as JobId;
    }
    const level = line.match(/레벨(\d{1,3})(?!\d)/);
    if (level) assign("레벨",+level[1],()=>{draft.level=+level[1];});
    for (const stat of ["STR","DEX","INT","LUK"] as const) {
      const match = line.match(new RegExp(`${stat}[:：]?(\\d+)\\((\\d+)\\+(\\d+)\\)`,"i"));
      if (!match) continue;
      const [,total,pure,bonus]=match.map(Number);
      if (total !== pure+bonus) { warnings.push(`${stat}의 순수+추가 수치가 합계와 다릅니다.`); continue; }
      assign(`${stat} 합계`,total,()=>{draft.total[stat]=total;});
      assign(`${stat} 순수`,pure,()=>{draft.pure[stat]=pure;});
    }
    const attack = line.match(/(?:공격력|공격)(\d+)[~～〜–-](\d+)/);
    if (attack) {
      assign("최소 스탯공",+attack[1],()=>{draft.minAttack=+attack[1];});
      assign("최대 스탯공",+attack[2],()=>{draft.maxAttack=+attack[2];});
    }
    for (const [pattern,key] of [
      [/총데미지(\d+(?:\.\d+)?)%/,"totalDamagePercent"],
      [/보스(?:데미지|공격력)(\d+(?:\.\d+)?)%/,"bossDamagePercent"],
      [/방어(?:율)?무시(\d+(?:\.\d+)?)%/,"ignoreDefensePercent"],
      [/(?:크리확률|크리티컬확률)(\d+(?:\.\d+)?)%/,"criticalRate"],
      [/명중(?:률|율)(\d+)/,"accuracy"],
    ] as const) { const match=line.match(pattern); if(match) assign(key,+match[1],()=>{draft[key]=+match[1];}); }
  }
  if (!draft.job) warnings.push("직업을 확인해주세요.");
  if (!draft.level) warnings.push("레벨을 확인해주세요.");
  if (draft.maxAttack === undefined) warnings.push("최대 스탯공을 확인해주세요.");
  const rule = draft.job ? JOB_RULES[draft.job] : undefined;
  for (const stat of rule ? [rule.mainStat,rule.subStat] : ["DEX","STR"] as const) if(draft.pure[stat] === undefined) warnings.push(`${stat}의 합계(순수+추가)가 완전히 보이는 사진이 필요합니다.`);
  return {draft,warnings:[...new Set(warnings)],automatic:false};
}
/**
 * 두 초안의 완전한 일치, 네 스탯의 순수값 존재, 경고 없음, 저장 스냅샷 유효성을 함께 확인한다.
 * 하나라도 부족하면 automatic=false로 남기며 두 결과의 수치를 평균하거나 다수결로 정하지 않는다.
 */
export function reconcileStatReads(first: StatRecognition, second: StatRecognition): StatRecognition {
  const draft = second.draft, warnings=[...first.warnings,...second.warnings];
  const stable = JSON.stringify(first.draft) === JSON.stringify(second.draft);
  if(!stable) warnings.push("두 번의 인식값이 달라 원본 확인이 필요합니다.");
  const complete = ["STR","DEX","INT","LUK"].every(stat=>draft.pure[stat as keyof typeof draft.pure] !== undefined);
  return {draft,warnings:[...new Set(warnings)],automatic:stable && complete && warnings.length===0 && isStatWindowSnapshot({...draft,capturedAt:new Date().toISOString()})};
}
