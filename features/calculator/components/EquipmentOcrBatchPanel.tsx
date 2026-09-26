"use client";

import { useEffect, useRef, useState } from "react";
import type { EquipmentSlot, JobId } from "../domain/types";
import { JOB_RULES } from "../domain/job-rules";
import { parseMapleTooltip } from "../ocr/parseMapleTooltip";
import { mapRecognizedStats } from "../ocr/mapRecognizedStats";
import { createBrowserTooltipRecognizer, isSupportedTooltipImage, MAX_TOOLTIP_IMAGE_BYTES, type TooltipRecognizer } from "../ocr/recognizeTooltip.client";
import { existingDuplicate, imageFingerprint, matchingSlots, occupied, tooltipIdentity, validReplacement, type ApplyOcrBatch, type OcrSlotChoice } from "../ocr/batch";
import type { StatReplacement } from "../ocr/types";
import type { OcrDestination } from "../ocr/batch";
import { WEAPON_PRESETS } from "../domain/weapon-presets";

type Row = {
  file: File;
  state: "waiting" | "working" | "ready" | "error" | "applied";
  text: string;
  replacement: StatReplacement | null;
  destination: OcrDestination;
  label: string;
  included: boolean;
  allowDuplicate: boolean;
  warning: string | null;
  error: string | null;
  progress: number;
};
type Props = { files: File[]; job: JobId; choices: OcrSlotChoice[]; onApply: ApplyOcrBatch; onClose: () => void; createRecognizer?: () => TooltipRecognizer };

function ImagePreview({file}: {file: File}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return;
    const next = URL.createObjectURL(file);
    // The preview resource is owned and released by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img className="ocr-batch-preview" src={url} alt={`${file.name} 원본`} loading="lazy" /> : null;
}

export function EquipmentOcrBatchPanel({files, job, choices, onApply, onClose, createRecognizer}: Props) {
  const [recognizer] = useState(() => createRecognizer?.() ?? createBrowserTooltipRecognizer());
  const initialChoices = useRef(choices);
  const [rows, setRows] = useState<Row[]>(() => files.map(file => ({
    file, state: "waiting", text: "", replacement: null, destination: "new", label: "추가 장비",
    included: true, allowDuplicate: false, warning: null, error: null, progress: 0,
  })));
  const [applyError, setApplyError] = useState<string | null>(null);
  const applicationLock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const seenImages = new Map<string, {text: string; name: string}>();
    const seenEquipment = new Map<string, string>();
    const reserved = new Set<EquipmentSlot>();
    const update = (index: number, patch: Partial<Row>) => {
      if (!controller.signal.aborted) setRows(current => current.map((row, i) => i === index ? {...row, ...patch} : row));
    };
    void (async () => {
      for (let index = 0; index < files.length; index += 1) {
        if (controller.signal.aborted) return;
        const file = files[index];
        if (!isSupportedTooltipImage(file) || file.size > MAX_TOOLTIP_IMAGE_BYTES) {
          update(index, {state: "error", included: false, error: "PNG·JPEG·WebP, 이미지당 12MB 이하만 가능합니다."});
          continue;
        }
        update(index, {state: "working"});
        try {
          const hash = await imageFingerprint(file);
          if (controller.signal.aborted) return;
          const repeatedImage = hash ? seenImages.get(hash) : undefined;
          const text = repeatedImage?.text ?? await recognizer.recognize(file, {
            signal: controller.signal,
            onProgress: ({progress}) => update(index, {progress}),
          });
          if (controller.signal.aborted) return;
          const parsed = parseMapleTooltip(text);
          const replacement = mapRecognizedStats(parsed, job);
          const identity = tooltipIdentity(text);
          const earlier = identity.signature ? seenEquipment.get(identity.signature) : null;
          const warning = repeatedImage ? `${repeatedImage.name}와 동일한 이미지입니다.`
            : earlier ? `${earlier}와 ${identity.name ? "이름·옵션" : "옵션"}이 같은 장비입니다. 중복 여부를 확인하세요.`
            : existingDuplicate(parsed, job, initialChoices.current);
          if (!Object.values(replacement).some(value => value !== "")) {
            update(index, {state: "error", text, included: false, error: "계산에 적용할 옵션을 찾지 못했습니다. 툴팁 부분을 캡처해 다시 선택하세요."});
            continue;
          }
          const candidate = matchingSlots(parsed.category, initialChoices.current).find(choice => !occupied(choice.equipment) && !reserved.has(choice.slot));
          const isWeapon = ["건", "석궁", "아대", "무기"].includes(parsed.category ?? "");
          const destination: OcrDestination = isWeapon
            ? `preset:${Number(replacement.ignoreDefensePercent) > 0 ? "chaos" : Number(replacement.bossDamagePercent) > 0 ? "boss" : "hunting"}`
            : !warning && candidate ? candidate.slot : "new";
          if (destination !== "new" && !destination.startsWith("preset:")) reserved.add(destination as EquipmentSlot);
          update(index, {state: "ready", text, replacement, destination, label: parsed.category ?? "추가 장비", warning, included: !warning});
          if (hash) seenImages.set(hash, {text, name: file.name});
          if (identity.signature && !earlier) seenEquipment.set(identity.signature, file.name);
        } catch {
          if (controller.signal.aborted) return;
          update(index, {state: "error", included: false, error: "인식에 실패했습니다. 이 이미지를 다시 선택해 재시도하세요."});
        }
      }
    })();
    return () => { controller.abort(); void recognizer.terminate(); };
  }, [files, job, recognizer]);

  const busy = rows.some(row => row.state === "waiting" || row.state === "working");
  const duplicateFor = (row: Row) => row.warning ?? (row.state === "ready" ? existingDuplicate(parseMapleTooltip(row.text), job, choices) : null);
  const isIncluded = (row: Row) => row.included && (!duplicateFor(row) || row.allowDuplicate);
  const selected = rows.filter(row => isIncluded(row) && row.state === "ready" && row.replacement);
  const completed = rows.filter(row => row.state !== "waiting" && row.state !== "working").length;
  const edit = (index: number, patch: Partial<Row>) => setRows(current => current.map((row, i) => i === index ? {...row, ...patch} : row));
  const {mainStat, subStat} = JOB_RULES[job];
  const fields: [keyof StatReplacement, string][] = [
    ["mainFlat", mainStat], ["subFlat", subStat], ["mainPercent", `${mainStat}%`], ["subPercent", `${subStat}%`],
    ["attackFlat", "공격력"], ["attackPercent", "공격력%"], ["requiredSub", `요구 ${subStat}`],
    ["totalDamagePercent", "총데미지%"], ["bossDamagePercent", "보스공격력%"], ["ignoreDefensePercent", "방어율 무시%"],
  ];

  return <section className="ocr-batch" aria-label="여러 장비 인식 목록">
    <div className="equipment-ocr-review-heading"><h4>여러 장비 검토</h4><span role="status">{completed}/{rows.length}장 인식 완료</span></div>
    <p>중복 의심 항목은 기본 제외합니다. 같은 옵션의 실제 별도 장비라면 포함을 선택하세요. 다른 파일을 선택하면 현재 목록을 새로 시작합니다.</p>
    <p>무기는 방무·보공 옵션으로 프리셋을 추천합니다. 적용 위치를 확인하세요. 기존 프리셋을 선택하면 해당 무기 값을 교체합니다. 총데미지·보공·방무의 빈칸은 0으로 교체되므로 누락된 옵션을 확인하세요.</p>
    <ol className="ocr-batch-list">
      {rows.map((row, index) => {
        const identity = row.text ? tooltipIdentity(row.text) : null;
        const duplicate = duplicateFor(row);
        return <li key={index} className={duplicate ? "has-duplicate" : ""}>
          <div className="ocr-batch-row-heading"><strong>{index + 1}. {identity?.name ?? row.file.name}</strong><span>{row.state === "working" ? `인식 ${Math.round(row.progress * 100)}%` : ({waiting: "대기", ready: duplicate ? "중복 의심" : "검토 가능", error: "실패", applied: "적용 완료"} as const)[row.state]}</span></div>
          <small>{row.file.name}</small>
          {row.error && <p role="alert">{row.error}</p>}
          {duplicate && <p className="ocr-duplicate-message">{duplicate}</p>}
          {row.replacement && <>
            <label className="check-field"><input type="checkbox" checked={isIncluded(row)} disabled={row.state === "applied"}
              onChange={event => edit(index, {included: event.currentTarget.checked, allowDuplicate: event.currentTarget.checked && !!duplicate})} />{index + 1}번 {duplicate ? "별도 장비로 포함" : "적용에 포함"}</label>
            <div className="field"><label htmlFor={`batch-destination-${index}`}>{index + 1}번 적용 위치</label>
              <select id={`batch-destination-${index}`} value={row.destination} disabled={row.state === "applied"}
                onChange={event => edit(index, {destination: event.currentTarget.value as Row["destination"]})}>
                <option value="new">새 장비 부위로 추가</option>
                {WEAPON_PRESETS.map(preset => <option key={preset.id} value={`preset:${preset.id}`}>{preset.label} 무기 프리셋 (교체)</option>)}
                {choices.map(choice => <option key={choice.slot} value={choice.slot}>{choice.label}{occupied(choice.equipment) ? " (기존 값 교체)" : " (빈칸)"}</option>)}
              </select>
            </div>
            {row.destination === "new" && <div className="field"><label htmlFor={`batch-label-${index}`}>{index + 1}번 새 장비 이름</label>
              <input id={`batch-label-${index}`} maxLength={30} value={row.label} disabled={row.state === "applied"} onChange={event => edit(index, {label: event.currentTarget.value})} />
            </div>}
            <p className="ocr-batch-stats">{fields.filter(([key]) => row.replacement![key] !== undefined && row.replacement![key] !== "").map(([key, label]) => `${label} ${row.replacement![key]}`).join(" · ")}</p>
            {!validReplacement(row.replacement) && <p role="alert">{index + 1}번 인식값을 확인하세요. 스탯·공격력은 0~9999, 비율은 0~999, 방무는 0~100이며, 적용할 값이 필요합니다.</p>}
            <details><summary>{index + 1}번 이미지·인식값 확인 및 수정</summary>
              <ImagePreview file={row.file} />
              <div className="equipment-ocr-proposal-grid">{fields.filter(([key]) => row.replacement![key] !== undefined).map(([key, label]) => <div className="field" key={key}>
                <label htmlFor={`batch-${index}-${key}`}>{index + 1}번 OCR {label}</label>
                <input id={`batch-${index}-${key}`} type="number" min={0} max={key === "ignoreDefensePercent" ? 100 : key.endsWith("Percent") ? 999 : 9999} step={key.endsWith("Percent") ? "any" : 1}
                  value={row.replacement![key]} disabled={row.state === "applied"} onChange={event => edit(index, {replacement: {...row.replacement!, [key]: event.currentTarget.value}})} />
              </div>)}</div>
              <label htmlFor={`batch-text-${index}`}>{index + 1}번 인식 텍스트</label>
              <textarea id={`batch-text-${index}`} rows={6} value={row.text} disabled={row.state === "applied"} onChange={event => {
                const text = event.currentTarget.value;
                edit(index, {text, replacement: mapRecognizedStats(parseMapleTooltip(text), job)});
              }} />
            </details>
          </>}
        </li>;
      })}
    </ol>
    {applyError && <p role="alert" className="ocr-duplicate-message">{applyError}</p>}
    <div className="equipment-ocr-actions">
      <button type="button" className="equipment-ocr-apply" disabled={busy || selected.length === 0 || selected.some(row => !validReplacement(row.replacement!))} onClick={() => {
        if (applicationLock.current) return;
        applicationLock.current = true;
        try {
          const error = onApply(job, selected.map(row => ({replacement: row.replacement!, destination: row.destination, label: row.label})));
          setApplyError(error);
          if (!error) setRows(current => current.map(row => selected.includes(row) ? {...row, state: "applied", included: false} : row));
        } finally { applicationLock.current = false; }
      }}>검토한 {selected.length}개 장비 적용</button>
      <button type="button" className="equipment-ocr-cancel" onClick={onClose}>{busy ? "전체 인식 취소" : "목록 닫기"}</button>
    </div>
  </section>;
}
