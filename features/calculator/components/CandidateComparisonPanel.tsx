"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { calculateDamageResult } from "../domain/calculate";
import { compareCandidate, compareCandidatePresets, comparableSlots, candidateEquipment, parseCandidatePrice, candidatePriceEfficiency, type PurchaseCandidate, type CandidateComparison, type MetricChange } from "../domain/candidates";
import { getEquipmentSlotLabel, RING_SLOTS } from "../domain/slots";
import { activeWeaponPreset, WEAPON_PRESETS } from "../domain/weapon-presets";
import { JOB_RULES } from "../domain/job-rules";
import type { CalculatorInput, EquipmentSlot, EquipmentInput, WeaponPresetId } from "../domain/types";
import { EquipmentOcrPanel } from "./EquipmentOcrPanel";
import { EQUIPMENT_FIELD_DEFINITIONS } from "./EquipmentEditor";
import { isPendantSlot, pendantLabel } from "../domain/pendants";
import { isWearBlocked } from "../domain/requirements";
import { PendantSelect } from "./PendantSelect";
import { HuntingSkillComparison } from "./HuntingSkillComparison";
import { RingComparisonTargets } from "./RingComparisonTargets";

const format = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
const signed = (n: number) => `${n > 0 ? "+" : ""}${format(n)}`;
const percent = (n: number) => n !== 0 && Math.abs(n) < .01 ? `${n > 0 ? "+" : "−"}<0.01%` : `${signed(n)}%`;
const Plus = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>;
const More = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>;
const Close = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>;

function CandidatePhoto({ file, originalFile = file, alt = "비교 후보 원본", showOriginalLink = false }: { file: File; originalFile?: File; alt?: string; showOriginalLink?: boolean }) {
  const image = useRef<HTMLImageElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(file);
    const originalUrl = showOriginalLink && originalFile !== file ? URL.createObjectURL(originalFile) : url;
    if (image.current) image.current.src = url;
    if (link.current) link.current.href = originalUrl;
    return () => { URL.revokeObjectURL(url); if (originalUrl !== url) URL.revokeObjectURL(originalUrl); };
  }, [file, originalFile, showOriginalLink]);
  // eslint-disable-next-line @next/next/no-img-element
  return <><img ref={image} alt={alt} className="candidate-photo"/>
    {showOriginalLink && <a ref={link} className="candidate-original-link" target="_blank" rel="noopener noreferrer">전체 원본 열기 ↗</a>}</>;
}

export function CandidateDialog({ title, onClose, children, className = "" }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof node.showModal === "function") node.showModal();
    else node.setAttribute("open", "");
    return () => {
      node.close?.();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={dialog} className={`candidate-dialog ${className}`} aria-label={title} data-candidate-comparison onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="candidate-dialog-heading"><h3>{title}</h3><button type="button" className="candidate-icon-button" aria-label={`${title} 닫기`} onClick={onClose}><Close/></button></div>
    {children}
  </dialog>;
}

function Metric({ label, value, emphasized = false }: { label: string; value: MetricChange | undefined; emphasized?: boolean }) {
  const direction = value && value.difference > 0 ? "is-up" : value && value.difference < 0 ? "is-down" : "";
  return <div className={`candidate-metric${emphasized ? " is-main" : ""}`} aria-label={`${label} 비교`}>
    <span className="candidate-metric-label">{label}</span>
    <div className="candidate-metric-value"><span className="candidate-sr-only">현재 {value ? format(value.before) : "—"} → 교체 후 </span><strong>{value ? format(value.after) : "—"}</strong></div>
    <div className={`candidate-change ${direction}`}>
      {value && <strong>{value.percent == null ? "확인 필요" : value.percent === 0 ? "변화 없음" : percent(value.percent)}</strong>}
      {value && <span>{signed(value.difference)}</span>}
    </div>
  </div>;
}

function ComparisonNotice({ value }: { value: CandidateComparison }) {
  if (value.status === "ready") return null;
  return <div className="candidate-notice" role="status"><strong>{value.status === "blocked" ? "비교 불가" : "조건 확인 필요 · 가정값"}</strong><p>{value.reasons[0]}</p>
    {value.reasons.length > 1 && <details><summary>확인할 항목 {value.reasons.length - 1}개 더 보기</summary><ul>{value.reasons.slice(1).map(reason => <li key={reason}>{reason}</li>)}</ul></details>}
  </div>;
}

function CharacterStatChanges({ value, input }: { value: CandidateComparison; input: CalculatorInput }) {
  const rule = JOB_RULES[input.character.job];
  const fields = [[rule.mainStat, "mainStat"], [rule.subStat, "subStat"], ["공격력", "totalAttack"]] as const;
  return <table className="candidate-stat-comparison" aria-label="캐릭터 스탯 변경 전후">
    <caption>캐릭터 합계</caption>
    <thead><tr><th scope="col">항목</th><th scope="col">현재</th><th scope="col">교체 후</th><th scope="col">증감</th></tr></thead>
    <tbody>{fields.map(([label, key]) => {
      const before = value.status !== "blocked" ? value.before?.[key] : undefined;
      const after = value.status !== "blocked" ? value.after?.[key] : undefined;
      const available = before !== undefined && after !== undefined && Number.isFinite(before) && Number.isFinite(after);
      const difference = available ? after - before : undefined;
      return <tr key={key}><th scope="row">{label}</th><td>{available ? format(before) : "—"}</td><td><strong>{available ? format(after) : "—"}</strong></td>
        <td className={difference && difference > 0 ? "is-up" : difference && difference < 0 ? "is-down" : ""}>{difference === undefined ? "—" : signed(difference)}</td></tr>;
    })}</tbody>
  </table>;
}

function BaselineCard({ input, onRegisterStats }: { input: CalculatorInput; onRegisterStats: () => void }) {
  const fixed = !!input.character.pureMain?.trim() && !!input.character.pureSub?.trim();
  const result = calculateDamageResult(input);
  const valid = !result.issues.some(issue => issue.severity === "error" || issue.code === "MISSING_WEAPON_ATTACK" || isWearBlocked(issue));
  const rule = JOB_RULES[input.character.job];
  return <div className="comparison-baseline" role="group" aria-label="현재 장비 비교 기준">
    <div className="comparison-card-top"><span className="comparison-card-label">{fixed ? "비교 기준" : "추정 기준"}</span><span className="comparison-baseline-dot"/></div>
    <div className="comparison-item-heading"><h3>현재 장비</h3><p>{rule.label} · Lv. {input.character.level || "—"}</p></div>
    <div className="comparison-key-metrics">
    <div className="candidate-metric is-main"><span className="candidate-metric-label">최대 스탯공</span><div className="candidate-metric-value"><strong>{valid ? format(result.statAttack) : "—"}</strong></div><span className="baseline-marker">기준값</span></div>
    <div className="candidate-metric"><span className="candidate-metric-label">환산 공격력</span><div className="candidate-metric-value"><strong>{valid ? format(result.convertedAttack) : "—"}</strong></div><span className="baseline-marker">기준값</span></div>
    </div>
    <div className="comparison-base-stats"><span>{rule.mainStat}<b>{input.character.job === "aran" && !valid ? "—" : format(result.mainStat)}</b></span><span>{rule.subStat}<b>{input.character.job === "aran" && !valid ? "—" : format(result.subStat)}</b></span><span>공격력<b>{input.character.job === "aran" && !valid ? "—" : format(result.totalAttack)}</b></span></div>
    <div className="comparison-baseline-footer">{fixed ? "순수 스탯 고정" : <button type="button" className="candidate-register-stats" onClick={onRegisterStats}>순수 스탯 입력</button>}</div>
  </div>;
}

function CandidateCard({ input, candidate, index, onChange, onRemove, onDetails, onRegisterStats }: { input: CalculatorInput; candidate: PurchaseCandidate; index: number; onChange: (next: PurchaseCandidate) => void; onRemove: () => void; onDetails: () => void; onRegisterStats: () => void }) {
  const [imageOpen, setImageOpen] = useState(false);
  const current = compareCandidate(input, candidate);
  const priceInvalid = !!candidate.price.trim() && parseCandidatePrice(candidate.price) === null;
  const efficiency = candidatePriceEfficiency(current, candidate.price);
  return <article className="candidate-card" aria-label={`${candidate.name} 비교 결과`} data-candidate-id={candidate.id}>
    <div className="comparison-card-top"><span className="comparison-card-label">후보 {String(index + 1).padStart(2, "0")}</span><div className="comparison-card-actions"><button type="button" className="candidate-icon-button" onClick={onDetails} aria-label={`${candidate.name} 상세 보기`} title="원본·옵션"><More/></button><button type="button" className="candidate-icon-button" onClick={onRemove} aria-label={`${candidate.name} 삭제`}><Close/></button></div></div>
    <div className="comparison-item-heading"><h3 title={candidate.name}>{candidate.name}</h3><p>{getEquipmentSlotLabel(input, candidate.slot)} 교체 후</p></div>
    <div className="comparison-key-metrics" aria-label="선택 프리셋 비교"><Metric label="최대 스탯공" value={current.stat} emphasized/><Metric label="환산 공격력" value={current.converted}/></div>
    {current.blocker === "missing-base-stats" ? <div className="candidate-registration-notice"><p>기준 캐릭터의 순수 스탯이 필요합니다.</p><button type="button" className="candidate-register-stats" onClick={onRegisterStats}>순수 스탯 입력</button></div> : current.status !== "ready" && <div className="candidate-card-status" role="status"><span title={current.reasons.join("\n")}>{current.status === "blocked" ? "비교 불가" : "조건 확인 필요"} · {current.reasons[0]}</span></div>}
    <CharacterStatChanges value={current} input={input}/>
    {input.character.job === "corsair" && current.preset === "hunting" && <HuntingSkillComparison comparison={current}/>}
    {candidate.image && <button type="button" className="candidate-source-preview" aria-label={`${candidate.name} 원본 이미지 확대`} onClick={() => setImageOpen(true)}>
      <span>원본 이미지 <small>확대 ↗</small></span><CandidatePhoto file={candidate.previewImage ?? candidate.image} alt={`${candidate.name} 원본 이미지`}/>
    </button>}
    <label className="candidate-price"><span>구매 가격</span><span className="candidate-price-input"><input type="number" min="0" step="any" value={candidate.price} placeholder="미입력" aria-label={`${candidate.name} 구매 가격`} aria-invalid={priceInvalid || undefined} onChange={event => onChange({ ...candidate, price: event.target.value })}/><span>억 메소</span></span></label>
    {priceInvalid && <p className="candidate-price-error" role="alert">0보다 큰 가격을 입력하세요.</p>}
    <div className={`candidate-efficiency${efficiency !== null && efficiency < 0 ? " is-down" : ""}`}>
      <span>1억 메소당<small>환산공 상승률</small></span>
      <output aria-label={`${candidate.name} 1억 메소당 환산공 상승률`}>{efficiency === null ? "—" : percent(efficiency)}</output>
    </div>
    {efficiency === null && !priceInvalid && current.blocker !== "missing-base-stats" && <p className="candidate-efficiency-hint">{!candidate.price.trim() ? "가격 입력 필요" : "비교 조건 확인 필요"}</p>}
    {imageOpen && candidate.image && <CandidateDialog title={`${candidate.name} 원본 이미지`} className="candidate-image-dialog" onClose={() => setImageOpen(false)}>
      <CandidatePhoto file={candidate.previewImage ?? candidate.image} originalFile={candidate.image} alt={`${candidate.name} 원본 장비 이미지`} showOriginalLink/>
    </CandidateDialog>}
  </article>;
}

function CandidateDetails({ input, candidate, onChange }: { input: CalculatorInput; candidate: PurchaseCandidate; onChange: (next: PurchaseCandidate) => void }) {
  const current = compareCandidate(input, candidate), rule = JOB_RULES[input.character.job];
  const fields = EQUIPMENT_FIELD_DEFINITIONS.filter(field => field.field !== "damagePercent");
  return <>
    <ComparisonNotice value={current}/>
    {candidate.image && <CandidatePhoto file={candidate.image}/>}
    <div className="candidate-import-fields">
      <label>비교 부위<select aria-label="후보 비교 부위 수정" value={comparableSlots(input).includes(candidate.slot) ? candidate.slot : ""} onChange={event => onChange({ ...candidate, slot: event.target.value as EquipmentSlot })}><option value="" disabled>부위 선택</option>{comparableSlots(input).map(slot => <option key={slot} value={slot}>{getEquipmentSlotLabel(input, slot)}</option>)}</select></label></div>
    {RING_SLOTS.includes(candidate.slot) && <RingComparisonTargets job={input.character.job} selected={candidate.slot}
      choices={RING_SLOTS.map(slot => ({ slot, label: getEquipmentSlotLabel(input, slot), equipment: input.equipment[slot] }))}
      onSelect={slot => onChange({ ...candidate, slot })} />}
    {isPendantSlot(input, candidate.slot) && <PendantSelect label="후보 펜던트 종류" value={candidate.equipment.pendantId} onChange={pendantId => onChange({ ...candidate, name: pendantLabel(pendantId) ?? candidate.name, equipment: { ...candidate.equipment, pendantId } })} />}
    <div className="candidate-option-grid">{fields.map(({ field, suffix, max, step }) => <label key={field}>{suffix(rule.mainStat, rule.subStat)}<small>현재 {input.equipment[candidate.slot]?.[field]?.trim() || "—"}</small><input type="number" min="0" max={max} step={step} value={candidate.equipment[field] ?? ""} aria-label={`${candidate.name} ${suffix(rule.mainStat, rule.subStat)}`} placeholder={field.startsWith("required") ? "확인 필요" : "0"} onChange={event => onChange({ ...candidate, equipment: { ...candidate.equipment, [field]: event.target.value } as EquipmentInput })}/></label>)}</div>
    <details className="candidate-other-presets"><summary>다른 프리셋에서 비교</summary>{compareCandidatePresets(input, candidate).filter(value => value.preset !== current.preset).map(value => <section key={value.preset}><h4>{WEAPON_PRESETS.find(preset => preset.id === value.preset)!.label}</h4><div className="candidate-detail-metrics"><Metric label="최대 스탯공" value={value.stat}/><Metric label="환산 공격력" value={value.converted}/></div><ComparisonNotice value={value}/></section>)}</details>
  </>;
}

export function CandidateComparisonPanel({ input, initialSlot, onPresetSelect, onEditBaseStats }: { input: CalculatorInput; initialSlot: EquipmentSlot; onPresetSelect?: (id: WeaponPresetId) => void; onEditBaseStats: () => void }) {
  const [candidates, setCandidates] = useState<PurchaseCandidate[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [inputMethod, setInputMethod] = useState<"photo" | "manual">("photo");
  const [manualEquipment, setManualEquipment] = useState<EquipmentInput>(() => candidateEquipment({}));
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [draftSlot, setDraftSlot] = useState<EquipmentSlot>(() => comparableSlots(input).includes(initialSlot) ? initialSlot : "weapon");
  const [name, setName] = useState(""), [price, setPrice] = useState("");
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const nextNumber = useRef(1);
  const slots = comparableSlots(input);
  const detailCandidate = candidates.find(candidate => candidate.id === detailsId);
  useEffect(() => {
    if (!lastAddedId) return;
    board.current?.querySelector<HTMLElement>(`[data-candidate-id="${lastAddedId}"]`)?.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [lastAddedId]);
  const changeCandidate = (next: PurchaseCandidate) => setCandidates(current => current.map(item => item.id === next.id ? next : item));
  const openImport = () => { setDraftSlot(slots.includes(initialSlot) ? initialSlot : "weapon"); setName(`후보 ${nextNumber.current}`); setPrice(""); setInputMethod("photo"); setManualEquipment(candidateEquipment({})); setImportOpen(true); };
  const addCandidate = (candidate: Omit<PurchaseCandidate, "id">) => {
    const id = crypto.randomUUID();
    nextNumber.current += 1;
    setCandidates(current => [...current, { ...candidate, id }]);
    setImportOpen(false); setLastAddedId(id);
  };
  return <section className="panel candidate-comparison" id="candidate-comparison" aria-label="구매 후보 비교" data-candidate-comparison>
    <div className="game-window-heading"><span className="game-window-label" aria-hidden="true">ITEM COMPARISON</span><span>구매 후보 비교</span></div>
    <div className="comparison-toolbar"><div><h2>장비 비교 <span>{candidates.length}</span></h2></div>
      <div className="comparison-toolbar-actions"><select aria-label="비교 전투 프리셋" value={activeWeaponPreset(input)} disabled={!onPresetSelect} onChange={event => onPresetSelect?.(event.target.value as WeaponPresetId)}>{WEAPON_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select><button type="button" className="comparison-add-button" onClick={openImport} aria-label="비교 후보 추가"><Plus/></button></div>
    </div>
    <div className="comparison-board" ref={board} role="group" aria-label="장비 비교 카드 목록" tabIndex={0}>
      <BaselineCard input={input} onRegisterStats={onEditBaseStats}/>
      {candidates.map((candidate, index) => <CandidateCard key={candidate.id} input={input} candidate={candidate} index={index} onChange={changeCandidate} onRemove={() => setCandidates(current => current.filter(item => item.id !== candidate.id))} onDetails={() => setDetailsId(candidate.id)} onRegisterStats={onEditBaseStats}/>)}
      <button type="button" className="comparison-add-card" onClick={openImport} aria-label="비교 카드 추가"><span className="comparison-add-symbol"><Plus/></span><strong>비교 대상 추가</strong></button>
    </div>
    <p className="comparison-footnote">구매 후보·사진·가격은 임시 비교용이며, 새로고침하거나 페이지를 닫으면 사라집니다.</p>
    {importOpen && <CandidateDialog title="비교할 장비 추가" onClose={() => setImportOpen(false)}>
      <div className="candidate-input-method" role="group" aria-label="후보 입력 방식">
        <button type="button" aria-pressed={inputMethod === "photo"} onClick={() => setInputMethod("photo")}>사진 등록</button>
        <button type="button" aria-pressed={inputMethod === "manual"} onClick={() => setInputMethod("manual")}>직접 입력</button>
      </div>
      {inputMethod === "manual" ? <form onSubmit={event => {
        event.preventDefault();
        if (!slots.includes(draftSlot)) return;
        addCandidate({ name: (isPendantSlot(input, draftSlot) && pendantLabel(manualEquipment.pendantId)) || name, price,
          job: input.character.job, slot: draftSlot, category: null, inputMethod: "manual",
          equipment: candidateEquipment({ ...manualEquipment, pendantId: isPendantSlot(input, draftSlot) ? manualEquipment.pendantId : undefined }) });
      }}>
        <div className="candidate-import-fields">
          <label>비교 부위<select aria-label="직접 입력 비교 부위" value={slots.includes(draftSlot) ? draftSlot : ""} required onChange={event => setDraftSlot(event.target.value as EquipmentSlot)}>
            <option value="" disabled>부위 선택</option>{slots.map(slot => <option key={slot} value={slot}>{getEquipmentSlotLabel(input, slot)}</option>)}
          </select></label>
          <label>가격 (억 메소)<input aria-label="새 후보 구매 가격" type="number" min="0" step="any" value={price} placeholder="예: 0.3" onChange={event => setPrice(event.target.value)}/></label>
        </div>
        {RING_SLOTS.includes(draftSlot) && <RingComparisonTargets job={input.character.job} selected={draftSlot}
          choices={RING_SLOTS.map(slot => ({ slot, label: getEquipmentSlotLabel(input, slot), equipment: input.equipment[slot] }))}
          onSelect={setDraftSlot} />}
        {isPendantSlot(input, draftSlot) && <PendantSelect label="후보 펜던트 종류" value={manualEquipment.pendantId}
          onChange={pendantId => setManualEquipment(current => ({ ...current, pendantId }))} />}
        <div className="candidate-option-grid">{EQUIPMENT_FIELD_DEFINITIONS.filter(field => field.field !== "damagePercent").map(({ field, suffix, max, step }) => {
          const rule = JOB_RULES[input.character.job], label = suffix(rule.mainStat, rule.subStat);
          return <label key={field}>{label}<input type="number" min="0" max={max} step={step} value={manualEquipment[field] ?? ""}
            aria-label={`새 후보 ${label}`} placeholder={field.startsWith("required") ? "미입력" : "0"}
            onChange={event => setManualEquipment(current => ({ ...current, [field]: event.target.value }))}/></label>;
        })}</div>
        <div className="candidate-manual-actions"><button type="submit" className="equipment-ocr-apply">후보로 비교</button></div>
      </form> : <EquipmentOcrPanel key={`${draftSlot}:${activeWeaponPreset(input)}`} target={{ job: input.character.job, slot: draftSlot }} slotLabel="구매 후보" purpose="candidate"
        candidateSlots={slots.map(slot => ({ slot, label: getEquipmentSlotLabel(input, slot), equipment: input.equipment[slot] }))}
        uploadFields={<div className="candidate-import-fields candidate-import-price"><label>가격 (억 메소)<input aria-label="새 후보 구매 가격" type="number" min="0" step="any" value={price} placeholder="예: 0.3" onChange={event => setPrice(event.target.value)}/></label></div>}
        onApply={(target, replacement, source) => {
        if (target.job !== input.character.job || !slots.includes(target.slot)) return;
        const candidateName = pendantLabel(source?.pendantId) || source?.name || name;
        addCandidate({ name: candidateName, price, job: target.job, slot: target.slot, category: source?.category ?? null, equipment: candidateEquipment({ ...replacement, ...(isPendantSlot(input, target.slot) && source?.pendantId !== undefined ? { pendantId: source.pendantId } : {}) }), image: source?.file ?? undefined, previewImage: source?.previewFile ?? undefined });
      }}/>}
    </CandidateDialog>}
    {detailCandidate && <CandidateDialog title={`${detailCandidate.name} 상세`} onClose={() => setDetailsId(null)}><CandidateDetails input={input} candidate={detailCandidate} onChange={changeCandidate}/></CandidateDialog>}
  </section>;
}
