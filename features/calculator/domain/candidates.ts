import { calculateDamageResult } from "./calculate";
import { emptyEquipment } from "./defaults";
import { getVisibleEquipmentSlots, getEquipmentSlotLabel, matchingSlots } from "./slots";
import { activeWeaponPreset, switchWeaponPreset, WEAPON_PRESETS } from "./weapon-presets";
import { isPendantCategory, occupiedPendantSlots } from "./pendants";
import { isWearBlocked } from "./requirements";
import type { CalculatorInput, EquipmentInput, EquipmentSlot, JobId, WeaponPresetId, CalculationResult } from "./types";

export type PurchaseCandidate = { id: string; name: string; job: JobId; slot: EquipmentSlot; category: string|null; equipment: EquipmentInput; price: string; image?: File; previewImage?: File };
export type MetricChange = { before: number; after: number; difference: number; percent: number|null };
export type CandidateComparison = { preset: WeaponPresetId; status: "ready"|"review"|"blocked"; blocker?: "missing-base-stats"; reasons: string[]; before?: CalculationResult; after?: CalculationResult; stat?: MetricChange; converted?: MetricChange };
export const comparableSlots = (input: CalculatorInput) => getVisibleEquipmentSlots(input).filter(slot=>!["projectile","blessing_1","blessing_2","buff"].includes(slot));
export function candidateEquipment(values: Partial<EquipmentInput>): EquipmentInput {
  // A new item starts empty. Never inherit omitted stats from the currently equipped item.
  return {...emptyEquipment(),...Object.fromEntries(Object.entries(values).filter(([,value])=>value!==undefined))};
}
export function parseCandidatePrice(raw: string): number|null {
  if(!raw.trim())return null;
  if(!/^\d+(?:\.\d+)?$/.test(raw.trim()))return null;
  const price=Number(raw);return Number.isFinite(price)&&price>0?price:null;
}
/** Percentage-point gain over the original equipment per 100 million mesos. */
export function candidatePriceEfficiency(comparison: CandidateComparison, rawPrice: string): number|null {
  const price = parseCandidatePrice(rawPrice);
  const gain = comparison.converted?.percent;
  if (comparison.status !== "ready" || price === null || gain == null || !Number.isFinite(gain)) return null;
  const efficiency = gain / price;
  return Number.isFinite(efficiency) ? efficiency : null;
}
const hasItem = (item: EquipmentInput|undefined) => item && Object.entries(item).some(([key,value])=>key !== "pendantId" && !key.startsWith("required") && typeof value==="string" && value.trim()!=="");
const change=(before:number,after:number,allowed:boolean):MetricChange=>({before,after,difference:after-before,percent:allowed&&before>0?(after/before-1)*100:null});
export function compareCandidate(input: CalculatorInput, candidate: PurchaseCandidate, preset=activeWeaponPreset(input)): CandidateComparison {
  const fail=(...reasons:string[]):CandidateComparison=>({preset,status:"blocked",reasons});
  if(input.character.job==="night_lord")return fail("나이트로드 장비 교체 비교는 아직 지원하지 않습니다.");
  if(candidate.job!==input.character.job || !comparableSlots(input).includes(candidate.slot))return fail("비교 부위를 다시 선택해주세요.");
  if(!input.character.pureMain?.trim() || !input.character.pureSub?.trim())return {...fail("능력창을 등록해 순수 스탯을 고정해주세요."),blocker:"missing-base-stats"};
  const choices=comparableSlots(input).map(slot=>({slot,label:getEquipmentSlotLabel(input,slot)}));
  const matches=matchingSlots(candidate.category,choices);
  const weapons:Record<string,JobId>={건:"corsair",석궁:"marksman",아대:"night_lord"};
  if(candidate.category && (Object.hasOwn(weapons,candidate.category) && weapons[candidate.category]!==candidate.job))return fail("현재 직업에 맞는 무기 사진을 선택해주세요.");
  if(candidate.category && matches.length>0 && !matches.some(choice=>choice.slot===candidate.slot))return fail(`인식 부위(${candidate.category})와 비교 부위가 다릅니다.`);
  if(candidate.category && matches.length===0)return fail(`인식 부위(${candidate.category})에 맞는 장비 부위를 먼저 추가해주세요.`);
  const baseline=switchWeaponPreset(input,preset);
  if(!hasItem(baseline.equipment[candidate.slot]))return fail("비교할 현재 장비를 먼저 등록해주세요.");
  const before=calculateDamageResult(baseline);
  const next: CalculatorInput={...baseline,equipment:{...baseline.equipment,[candidate.slot]:{...candidate.equipment}}};
  const after=calculateDamageResult(next);
  const all=[...before.issues,...after.issues];
  const invalid=all.filter(issue=>issue.severity==="error" || issue.code === "MISSING_WEAPON_ATTACK" || isWearBlocked(issue));
  if(invalid.length)return {...fail(...new Set(invalid.map(i=>i.message))),before,after};
  const pending=all.filter(issue=>issue.code === "LEGACY_DAMAGE_SPLIT");
  const reasons=[...new Set(pending.map(i=>i.message))];
  const pendants = occupiedPendantSlots(next);
  // Request kind verification only when this image's OCR category is pendant.
  // A manually selected destination does not establish the image's category.
  // Proven duplicate/over-limit loadouts still fail through isWearBlocked above.
  if (isPendantCategory(candidate.category) && pendants.some(slot => !next.equipment[slot]?.pendantId)) reasons.push("펜던트 종류를 확인해주세요. 고유 아이템 중복 착용 여부를 확인해야 합니다.");
  if(!candidate.equipment.requiredLevel?.trim())reasons.push("후보 사진의 REQ LEV 인식값이 없습니다. 원본의 요구 레벨을 확인해주세요.");
  if(!candidate.equipment.requiredSub.trim())reasons.push("후보 사진의 요구 스탯 인식값이 없습니다. OCR 검토값을 확인해주세요.");
  if(before.statAttack<=0 || before.convertedAttack<=0)reasons.push("현재 공격력이 0인 항목은 상승률을 계산할 수 없습니다.");
  const ready=reasons.length===0;
  return {preset,status:ready?"ready":"review",reasons,before,after,
    stat:change(before.statAttack,after.statAttack,ready),converted:change(before.convertedAttack,after.convertedAttack,ready)};
}
export function compareCandidatePresets(input:CalculatorInput,candidate:PurchaseCandidate) {
  return WEAPON_PRESETS.map(preset=>compareCandidate(input,candidate,preset.id));
}
