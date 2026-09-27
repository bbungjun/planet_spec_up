"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { JOB_RULES } from "../domain/job-rules";
import { compareStatWindow, isStatWindowSnapshot } from "../domain/statWindow";
import type { CalculationResult, CalculatorInput, JobId, StatWindowSnapshot } from "../domain/types";
import { recognizeStatWindow } from "../ocr/recognizeStatWindow.client";
import type { StatDraft } from "../ocr/parseStatWindow";
import { clipboardImages } from "../ocr/clipboard";
import { isSupportedTooltipImage, MAX_TOOLTIP_IMAGE_BYTES } from "../ocr/recognizeTooltip.client";

type Props={embedded?:boolean;showReconciliation?:boolean;input:CalculatorInput;result:CalculationResult;onSave:(snapshot:StatWindowSnapshot)=>string|null};
const observed = [["maxAttack","최대 스탯공"],["minAttack","최소 스탯공"],["totalDamagePercent","총데미지 (%)"],["bossDamagePercent","보스공격력 (%)"],["ignoreDefensePercent","방어율 무시 (%)"],["criticalRate","크리티컬 확률 (%)"],["accuracy","명중률"]] as const;
export function CharacterStatWindowPanel({input,result,onSave,embedded=false,showReconciliation=false}:Props) {
  const [draft,setDraft]=useState<StatDraft|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[preview,setPreview]=useState("");
  const [warnings,setWarnings]=useState<string[]>([]);
  const controller=useRef<AbortController|null>(null),saveRef=useRef(onSave);
  const section=useRef<HTMLElement>(null);
  useEffect(()=>{saveRef.current=onSave;},[onSave]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
  const saveDraft=useCallback((candidate:StatDraft)=>{
    const snapshot={...candidate,capturedAt:new Date().toISOString()};
    if(!isStatWindowSnapshot(snapshot)){setMessage("직업·레벨·주/부스탯의 순수값과 합계·최대 스탯공을 확인해주세요. 합계는 순수값 이상이어야 합니다.");return;}
    const error=saveRef.current(snapshot);
    if(error){setMessage(error);return;}
    setDraft(null);setWarnings([]);setMessage("능력창 정보를 저장했습니다.");
  },[]);
  const read=useCallback(async(file:File)=>{
    controller.current?.abort();const current=new AbortController();controller.current=current;
    setBusy(true);setDraft(null);setWarnings([]);setPreview(URL.createObjectURL(file));setMessage("능력창을 읽고 있습니다.");
    try {
      const recognized=await recognizeStatWindow(file,current.signal,text=>{if(!current.signal.aborted&&controller.current===current)setMessage(text);});
      if(current.signal.aborted)return;
      setDraft(recognized.draft);setWarnings(recognized.warnings);
      if(recognized.automatic)saveDraft(recognized.draft);
      else setMessage("빈칸·확인 항목을 검토해주세요.");
    } catch(error){if(!current.signal.aborted)setMessage(error instanceof Error?error.message:"능력창 인식에 실패했습니다. 다시 시도해주세요.");}
    finally{if(controller.current===current){controller.current=null;setBusy(false);}}
  },[saveDraft]);
  const acceptImages=useCallback((files:File[])=>{
    if(!files.length||section.current?.closest("fieldset[disabled]"))return;
    if(controller.current){setMessage("능력창을 읽는 중입니다. 완료 후 다시 붙여넣어주세요.");return;}
    if(files.length!==1){setMessage("능력창 사진은 한 장씩 넣어주세요.");return;}
    const file=files[0];
    if(!isSupportedTooltipImage(file)||file.size>MAX_TOOLTIP_IMAGE_BYTES){setMessage("12MB 이하 PNG/JPG/WebP 이미지를 선택해주세요.");return;}
    void read(file);
  },[read]);
  useEffect(()=>{
    if(!embedded)return;
    const paste=(event:ClipboardEvent)=>{
      if(event.defaultPrevented||!section.current?.closest("dialog")?.hasAttribute("open"))return;
      const images=clipboardImages(event.clipboardData);
      if(!images.length)return;
      // Claim modal image pastes before document-level equipment handlers run,
      // including when focus is on the dialog's close button.
      event.preventDefault();event.stopPropagation();acceptImages(images);
    };
    document.addEventListener("paste",paste,true);
    return()=>document.removeEventListener("paste",paste,true);
  },[embedded,acceptImages]);
  const rows=showReconciliation?compareStatWindow(input,result):[];
  return <section ref={section} className={`stat-window-panel${embedded?" is-embedded":""}`} aria-label="능력창 사진 등록" onPaste={event=>{
    if(event.defaultPrevented)return;
    const images=clipboardImages(event.clipboardData);
    if(images.length){event.preventDefault();event.stopPropagation();acceptImages(images);}
  }}>
    <div>{!embedded&&<h2>능력창 등록</h2>}<p>스탯창과 상세 공격력 창이 함께 보이는 사진</p></div>
    <label className="stat-upload">능력창 사진 선택<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="능력창 사진 선택" disabled={busy} onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value="";acceptImages(files);}} /></label>
    <div className="equipment-ocr-paste-zone stat-window-paste-zone" role="group" aria-label="능력창 사진 붙여넣기" tabIndex={0} aria-disabled={busy} onClick={event=>event.currentTarget.focus()}>
      {embedded?"이 창에서 Ctrl+V로 능력창 사진 붙여넣기":"여기를 클릭하고 Ctrl+V로 능력창 사진 붙여넣기"}
    </div>
    {busy&&<button type="button" onClick={()=>{controller.current?.abort();controller.current=null;setBusy(false);setMessage("인식을 취소했습니다. 기존 저장값은 유지됩니다.");}}>능력창 인식 취소</button>}
    {!input.character.pureMain && <p>등록 전 순수 스탯은 임시값입니다.</p>}
    <p role="status" aria-label="능력창 인식 상태">{message}</p>
    {draft&&<div className="stat-window-review">
      {/* Local object URL is never persisted or sent to an inference service. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {preview&&<img src={preview} alt="확인할 능력창 원본" />}
      {warnings.length>0&&<ul>{warnings.map(text=><li key={text}>{text}</li>)}</ul>}
      <div className="stat-review-fields">
        <label>인식 직업<select aria-label="능력창 직업" value={draft.job??""} onChange={e=>setDraft({...draft,job:e.target.value as JobId})}><option value="">확인 필요</option>{Object.values(JOB_RULES).map(rule=><option value={rule.id} key={rule.id}>{rule.label}</option>)}</select></label>
        <label>인식 레벨<input aria-label="능력창 레벨" type="number" min="1" max="220" value={draft.level??""} onChange={e=>setDraft({...draft,level:e.target.value===""?undefined:Number(e.target.value)})}/></label>
        {(["STR","DEX","INT","LUK"] as const).flatMap(stat=>(["pure","total"] as const).map(group=><label key={`${stat}-${group}`}>{stat} {group==="pure"?"순수":"합계"}<input aria-label={`${stat} ${group==="pure"?"순수":"합계"}`} type="number" min="0" step="1" value={draft[group][stat]??""} onChange={e=>{const next={...draft[group]};if(e.target.value==="")delete next[stat];else next[stat]=Number(e.target.value);setDraft({...draft,[group]:next});}}/></label>))}
        {observed.map(([field,label])=><label key={field}>{label}<input aria-label={`능력창 ${label}`} type="number" min="0" value={draft[field]??""} onChange={e=>setDraft({...draft,[field]:e.target.value===""?undefined:Number(e.target.value)})}/></label>)}
      </div>
      <p>순수 스탯은 괄호 안의 첫 번째 숫자입니다.</p>
      <button type="button" onClick={()=>saveDraft(draft)}>확인하고 능력창 저장</button>
    </div>}
    {rows.length>0&&<div className="stat-reconciliation"><p>촬영 당시 장비·프리셋·버프 기준</p>
      <table><caption>능력창과 현재 계산 비교</caption><thead><tr><th>항목</th><th>능력창</th><th>현재 계산</th><th>점검</th></tr></thead><tbody>{rows.map(row=><tr key={row.label}><th>{row.label}</th><td>{row.observed?.toLocaleString()??"미인식"}</td><td>{row.calculated?.toLocaleString()??"—"}</td><td className={row.status==="different"?"stat-mismatch":""}>{row.status==="match"?"일치":row.status==="different"?`차이 ${row.difference!>0?"+":""}${Number(row.difference!.toFixed(4)).toLocaleString()}`:row.status==="unread"?"확인 필요":"비교 불가"}</td></tr>)}</tbody></table>
      <p>명중률은 참고값이며 계산하지 않습니다.</p>
    </div>}
  </section>;
}
