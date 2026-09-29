"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { EquipmentSlot, JobId } from "../domain/types";
import { JOB_RULES } from "../domain/job-rules";
import { parseMapleTooltip } from "../ocr/parseMapleTooltip";
import { mapRecognizedStats } from "../ocr/mapRecognizedStats";
import { createBrowserTooltipRecognizer, recognitionErrorMessage, type TooltipRecognizer } from "../ocr/recognizeTooltip.client";
import { existingDuplicate, imageFingerprint, matchingSlots, occupied, tooltipIdentity, validReplacement, type ApplyOcrBatch, type OcrSlotChoice } from "../ocr/batch";
import { batchConcurrency, recognizeBatch, type BatchRecognitionResult } from "../ocr/recognizeBatch.client";
import type { OcrBounds, OcrReview, StatReplacement } from "../ocr/types";
import { mapReviewedStats, overrideReviewRequirement, reviewBlocked, reviewQuestions, reviewText } from "../ocr/reviewRecognition";
import { OcrReviewIssues } from "./OcrReviewIssues";
import { TooltipRegionSelector } from "./TooltipRegionSelector";
import type { OcrDestination } from "../ocr/batch";
import { WEAPON_PRESETS } from "../domain/weapon-presets";
import { RING_SLOTS } from "../domain/slots";
import { isPendantCategory, pendantFromName, PENDANT_SLOTS } from "../domain/pendants";
import { PendantSelect } from "./PendantSelect";

type Row = {
  file: File;
  preview: File;
  state: "waiting" | "queued" | "working" | "recognized" | "ready" | "error" | "applied";
  text: string;
  replacement: StatReplacement | null;
  review: OcrReview | null;
  overrides: StatReplacement;
  attempt: number;
  destination: OcrDestination;
  needsDestination: boolean;
  label: string;
  category: string | null;
  pendantChoice?: string;
  included: boolean;
  allowDuplicate: boolean;
  warning: string | null;
  error: string | null;
  progress: number;
  region?: OcrBounds;
};
type Props = { files: File[]; job: JobId; choices: OcrSlotChoice[]; onApply: ApplyOcrBatch; onClose: () => void; createRecognizer?: () => TooltipRecognizer; saveOnApply?: boolean };

function ImagePreview({file, original = file}: {file: File; original?: File}) {
  const [url, setUrl] = useState<string | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return;
    const next = URL.createObjectURL(file);
    // The preview resource is owned and released by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next);
    const full = file !== original ? URL.createObjectURL(original) : null;
    setOriginalUrl(full);
    return () => { URL.revokeObjectURL(next); if (full) URL.revokeObjectURL(full); };
  }, [file, original]);
  return url ? <div><a className="ocr-batch-image-link" href={url} target="_blank" rel="noreferrer" aria-label={`${original.name} ${originalUrl ? "인식 영역" : "원본"} 크게 보기 (새 탭)`}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className="ocr-batch-preview" src={url} alt={`${original.name} ${originalUrl ? "인식 영역" : "원본"}`} loading="lazy" />
  </a>{originalUrl && <p className="ocr-crop-caption"><a href={originalUrl} target="_blank" rel="noreferrer">전체 원본 보기</a></p>}</div> : null;
}

export function EquipmentOcrBatchPanel({files, job, choices, onApply, onClose, createRecognizer, saveOnApply = false}: Props) {
  const id = useId();
  const [recognizerFactory] = useState(() => createRecognizer ?? createBrowserTooltipRecognizer);
  const [concurrency] = useState(() => batchConcurrency(files.length, undefined, Math.max(0, ...files.map(file => file.size))));
  const initialChoices = useRef(choices);
  const [rows, setRows] = useState<Row[]>(() => files.map(file => ({
    file, preview: file, state: "waiting", text: "", replacement: null, review: null, overrides: {}, attempt: 0, destination: "new", label: "추가 장비", category: null,
    included: true, allowDuplicate: false, warning: null, error: null, progress: 0, needsDestination: false,
  })));
  const [applyError, setApplyError] = useState<string | null>(null);
  const applicationLock = useRef(false);
  const stopInitial = useRef<() => void>(() => {});
  const retryOperations = useRef(new Map<number, { controller: AbortController; recognizer?: TooltipRecognizer; shared: boolean }>());
  const retryQueue = useRef(new Map<number, (recognizer?: TooltipRecognizer) => Promise<void>>());
  const initialActive = useRef(true);
  const draining = useRef(false);
  const drainPending = useRef<() => Promise<void>>(async () => {});
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const retryFingerprints = useRef(new WeakMap<File, Promise<string | null>>());

  useEffect(() => {
    initialActive.current = true;
    const controller = new AbortController();
    let disposed = false;
    const seenEquipment = new Map<string, string>();
    const reserved = new Set<EquipmentSlot>();
    const results = new Map<number, BatchRecognitionResult>();
    let nextReview = 0;
    const update = (index: number, patch: Partial<Row>) => {
      if (!controller.signal.aborted) setRows(current => current.map((row, i) => i === index && row.attempt === 0 ? {...row, ...patch} : row));
    };
    const flushInOrder = () => {
      while (!controller.signal.aborted && results.has(nextReview)) {
        const index = nextReview++;
        const file = files[index];
        const result = results.get(index)!;
        results.delete(index);
        if (!result.ok) {
          update(index, {state: "error", included: false, error: recognitionErrorMessage(result.error)});
          continue;
        }
        const { text, preview } = result;
        const parsed = { ...parseMapleTooltip(text), ...(result.review ? { category: result.review.category } : {}) };
        const replacement = result.review ? mapReviewedStats(result.review, job) : mapRecognizedStats(parsed, job);
        const identity = tooltipIdentity(text);
        const earlier = identity.signature ? seenEquipment.get(identity.signature) : null;
        const warning = result.duplicateOf !== undefined ? `${files[result.duplicateOf].name}와 동일한 이미지입니다.`
          : earlier && parsed.category !== "반지" ? `${earlier}와 ${identity.name ? "이름·옵션" : "옵션"}이 같은 장비입니다. 중복 여부를 확인하세요.`
          : existingDuplicate(parsed, job, initialChoices.current);
        if (!Object.values(replacement).some(value => value !== "") && !(result.review && reviewQuestions(result.review, job).length)) {
          update(index, {state: "error", text, included: false, error: "계산에 적용할 옵션을 찾지 못했습니다. 툴팁 부분을 캡처해 다시 선택하세요."});
          continue;
        }
        const candidate = matchingSlots(parsed.category, initialChoices.current).find(choice => !occupied(choice.equipment) && !reserved.has(choice.slot));
        const isWeapon = ["건", "석궁", "아대", "무기"].includes(parsed.category ?? "");
        const destination: OcrDestination = isWeapon
          ? `preset:${Number(replacement.ignoreDefensePercent) > 0 ? "chaos" : Number(replacement.bossDamagePercent) > 0 ? "boss" : "hunting"}`
          : !warning && candidate ? candidate.slot : "new";
        if (destination !== "new" && !destination.startsWith("preset:")) reserved.add(destination as EquipmentSlot);
        update(index, {state: "ready", text, preview, replacement, review: result.review ?? null, destination,
          needsDestination: parsed.category === null || ((parsed.category === "반지" || isPendantCategory(parsed.category)) && destination === "new"),
          category: parsed.category, label: parsed.category ?? "추가 장비", warning, included: !warning});
        if (identity.signature && !earlier) seenEquipment.set(identity.signature, file.name);
      }
    };
    stopInitial.current = () => {
      if (controller.signal.aborted) return;
      for (let index = nextReview; index < files.length; index++) if (!results.has(index)) results.set(index, { ok: false, error: { code: "CANCELLED", retryable: true } });
      flushInOrder();
      controller.abort();
    };
    void recognizeBatch(files, {
      signal: controller.signal, concurrency, createRecognizer: recognizerFactory,
      onStart: index => update(index, { state: "working" }),
      onProgress: (index, progress) => update(index, { progress }),
      onPrepared: (index, preview) => update(index, { preview }),
      onResult: (index, result) => {
        update(index, { state: "recognized", progress: 1 });
        results.set(index, result);
        // Completion order never decides which ring slot or duplicate wins.
        flushInOrder();
      },
      takePriorityTask: () => {
        const entry = retryQueue.current.entries().next().value;
        if (!entry) return undefined;
        retryQueue.current.delete(entry[0]);
        return entry[1];
      },
    }).finally(() => {
      if (disposed) return;
      initialActive.current = false;
      void drainPending.current();
    });
    const retries = retryOperations.current;
    return () => {
      disposed = true;
      controller.abort();
      retries.forEach(({ controller, recognizer, shared }) => { controller.abort(); if (!shared) void recognizer?.terminate(); });
      retries.clear();
      retryQueue.current.clear();
    };
  }, [files, job, recognizerFactory, concurrency]);

  const rowBusy = (row: Row) => row.state === "waiting" || row.state === "queued" || row.state === "working" || row.state === "recognized";
  const busy = rows.some(rowBusy);
  const duplicateFor = (row: Row) => row.warning ?? (row.state === "ready" ? existingDuplicate(parseMapleTooltip(row.text), job, choices) : null);
  const isIncluded = (row: Row) => row.included && (!duplicateFor(row) || row.allowDuplicate);
  const selected = rows.filter(row => isIncluded(row) && row.state === "ready" && row.replacement);
  const completed = rows.filter(row => row.state !== "waiting" && row.state !== "queued" && row.state !== "working").length;
  const edit = (index: number, patch: Partial<Row>) => {
    if (retryOperations.current.has(index)) return;
    setRows(current => current.map((row, i) => i === index ? {...row, ...patch} : row));
  };
  const setReview = (index: number, review: OcrReview) => setRows(current => current.map((row, i) => i !== index || retryOperations.current.has(index) ? row : {
    ...row, review, text: reviewText(review),
    replacement: { ...mapReviewedStats(review, job), ...row.overrides },
  }));
  const retry = async (index: number, region?: OcrBounds, replacementFile?: File) => {
    const original = rowsRef.current[index];
    if (!original || rowBusy(original) || original.state === "applied" || retryOperations.current.has(index) || applicationLock.current) return;
    setCropIndex(null);
    setApplyError(null);
    const file = replacementFile ?? original.file;
    const crop = region ?? (replacementFile ? undefined : original.region);
    const controller = new AbortController(), attempt = original.attempt + 1;
    const operation: { controller: AbortController; recognizer?: TooltipRecognizer; shared: boolean } = { controller, shared: false };
    retryOperations.current.set(index, operation);
    const patch = (value: Partial<Row>) => {
      if (controller.signal.aborted) return;
      setRows(current => current.map((row, i) => !controller.signal.aborted && i === index && row.file === file && row.attempt === attempt ? {...row, ...value} : row));
    };
    setRows(current => current.map((row, i) => i === index ? { ...row, file, region: crop, state: "queued", progress: 0, error: null, attempt } : row));
    const run = async (sharedRecognizer?: TooltipRecognizer) => {
      if (controller.signal.aborted || retryOperations.current.get(index) !== operation) return;
      let recognizer: TooltipRecognizer | undefined;
      let preview = file, review: OcrReview | undefined;
      try {
        recognizer = sharedRecognizer ?? recognizerFactory();
        operation.recognizer = recognizer;
        operation.shared = !!sharedRecognizer;
        patch({ preview: file, state: "working", replacement: null, review: null, overrides: {} });
        const text = await recognizer.recognize(file, {
          signal: controller.signal, region: crop, enhance: !crop && !replacementFile,
          onProgress: ({ progress }) => patch({ progress }),
          onPrepared: image => { preview = image; patch({ preview }); },
          onReview: result => { review = result; },
        });
        if (controller.signal.aborted) return;
        const parsed = { ...parseMapleTooltip(text), ...(review ? { category: review.category } : {}) };
        const replacement = review ? mapReviewedStats(review, job) : mapRecognizedStats(parsed, job);
        if (!Object.values(replacement).some(value => value !== "") && !(review && reviewQuestions(review, job).length)) throw new Error("No options");
        const identity = tooltipIdentity(text);
        const fingerprint = (image: File) => {
          let pending = retryFingerprints.current.get(image);
          if (!pending) { pending = imageFingerprint(image); retryFingerprints.current.set(image, pending); }
          return pending;
        };
        const hash = await fingerprint(file);
        const sameImages = new Set<File>();
        if (hash) for (const [otherIndex, row] of rowsRef.current.entries()) {
          if (controller.signal.aborted) return;
          if (otherIndex !== index && (row.state === "ready" || row.state === "applied") && await fingerprint(row.file) === hash) sameImages.add(row.file);
        }
        if (controller.signal.aborted) return;
        setRows(current => {
          if (controller.signal.aborted || current[index]?.file !== file || current[index]?.attempt !== attempt) return current;
          const sameImage = current.find((row, i) => i !== index && sameImages.has(row.file));
          const repeated = parsed.category !== "반지" && current.find((row, i) => i !== index && row.state === "ready" && identity.signature && tooltipIdentity(row.text).signature === identity.signature);
          const warning = sameImage ? `${sameImage.file.name}와 동일한 이미지입니다.`
            : repeated ? `${repeated.file.name}와 이름·옵션이 같은 장비입니다. 중복 여부를 확인하세요.` : existingDuplicate(parsed, job, choices);
          const taken = new Set(current.filter((row, i) => i !== index && row.included && row.state === "ready").map(row => row.destination));
          const candidate = matchingSlots(parsed.category, choices).find(choice => !occupied(choice.equipment) && !taken.has(choice.slot));
          const weapon = ["건", "석궁", "아대", "무기"].includes(parsed.category ?? "");
          const sameDestination = !replacementFile && parsed.category === original.category;
          const destination: OcrDestination = sameDestination ? original.destination : weapon ? `preset:${Number(replacement.ignoreDefensePercent) > 0 ? "chaos" : Number(replacement.bossDamagePercent) > 0 ? "boss" : "hunting"}` : !warning && candidate ? candidate.slot : "new";
          return current.map((row, i) => i !== index ? row : { ...row, state: "ready", progress: 1, text, preview, replacement, review: review ?? null,
            warning, included: !warning, allowDuplicate: false, pendantChoice: sameDestination ? original.pendantChoice : undefined, destination, category: parsed.category, label: sameDestination ? original.label : parsed.category ?? "추가 장비",
            needsDestination: sameDestination ? original.needsDestination : initialActive.current || parsed.category === null || ((parsed.category === "반지" || isPendantCategory(parsed.category)) && destination === "new") });
        });
      } catch (error) {
        patch({ state: "error", included: false, error: recognitionErrorMessage(error) });
      } finally {
        if (retryOperations.current.get(index) === operation) retryOperations.current.delete(index);
        if (!sharedRecognizer) await recognizer?.terminate();
      }
    };
    retryQueue.current.set(index, run);
    if (!initialActive.current) void drainPending.current();
  };
  drainPending.current = async () => {
    if (draining.current || initialActive.current) return;
    draining.current = true;
    try {
      while (retryQueue.current.size && !initialActive.current) {
        const [index, run] = retryQueue.current.entries().next().value!;
        retryQueue.current.delete(index);
        await run();
      }
    } finally { draining.current = false; }
  };
  const cancel = () => {
    stopInitial.current();
    retryQueue.current.clear();
    retryOperations.current.forEach(({ controller, recognizer, shared }, index) => {
      controller.abort(); if (!shared) void recognizer?.terminate();
      retryOperations.current.delete(index);
      edit(index, { state: "error", included: false, error: "이 사진의 인식을 취소했습니다. 다시 읽을 수 있어요." });
    });
  };
  const {mainStat, subStat} = JOB_RULES[job];
  const fields: [keyof StatReplacement, string][] = [
    ["mainFlat", mainStat], ["subFlat", subStat], ["mainPercent", `${mainStat}%`], ["subPercent", `${subStat}%`],
    ["attackFlat", "공격력"], ["attackPercent", "공격력%"], ["criticalRate", "크리티컬 확률%"], ["requiredLevel", "요구 레벨"], ["requiredSub", `요구 ${subStat}`],
    ["totalDamagePercent", "총데미지%"], ["bossDamagePercent", "보스공격력%"], ["ignoreDefensePercent", "방어율 무시%"],
  ];

  return <section className={`ocr-batch${saveOnApply ? " is-saving" : ""}`} aria-label="여러 장비 인식 목록">
    <div className="equipment-ocr-review-heading"><h4>{saveOnApply ? "원본과 인식값을 확인해주세요" : "여러 장비 검토"}</h4><span role="status">{completed}/{rows.length}장 인식 완료</span></div>
    {busy && <p className="ocr-batch-selection" role="status">{`최대 ${concurrency}장 동시 인식 · 처리 중 ${rows.filter(row => row.state === "working").length}장 · 대기 ${rows.filter(row => row.state === "waiting" || row.state === "queued").length}장`}</p>}

    <p>미인식 값은 유지됩니다. 삭제하려면 0을 입력하세요.</p>
    <button type="button" className="secondary-button" aria-pressed={attentionOnly} onClick={() => setAttentionOnly(value => !value)}>{attentionOnly ? "모든 사진 보기" : "확인 필요한 사진만 보기"}</button>
    {saveOnApply && <p className="ocr-batch-selection" role="status">저장할 장비 {selected.length}개 · 제외 {rows.filter(row => row.state === "ready" && !isIncluded(row)).length}개 · 인식 실패 {rows.filter(row => row.state === "error").length}개</p>}
    <ol className="ocr-batch-list">
      {rows.map((row, index) => {
        const identity = row.text ? tooltipIdentity(row.text) : null;
        const pendant = isPendantCategory(row.category) || PENDANT_SLOTS.includes(row.destination as EquipmentSlot);
        const limitedSlots = row.category === "반지" ? RING_SLOTS : pendant ? PENDANT_SLOTS : null;
        const duplicate = duplicateFor(row);
        const questions = row.review ? Number(reviewBlocked(row.review, job)) : 0;
        if (attentionOnly && cropIndex !== index && row.state !== "error" && !row.needsDestination && !questions && !duplicate && !rowBusy(row)) return null;
        return <li key={index} className={duplicate ? "has-duplicate" : ""}>
          <div className="ocr-batch-row-heading"><strong>{index + 1}. {identity?.name ?? row.review?.category ?? row.file.name}</strong><span>{row.state === "working" ? `인식 ${Math.round(row.progress * 100)}%` : ({waiting: "대기", queued: "선택 영역 재인식 대기", recognized: "인식 완료 · 정리 중", ready: duplicate ? "중복 의심" : row.needsDestination ? "부위 확인 필요" : questions ? "옵션 확인 필요" : "검토 가능", error: "실패", applied: "적용 완료"} as const)[row.state]}</span></div>
          <small>{row.file.name}</small>
          {saveOnApply && <ImagePreview file={row.preview} original={row.file} />}
          {row.error && <p role="alert">{row.error}</p>}
          {duplicate && <p className="ocr-duplicate-message">{duplicate}</p>}
          {row.state !== "applied" && <div className="ocr-row-retry equipment-ocr-actions">
            <button type="button" className="secondary-button" disabled={rowBusy(row) || applicationLock.current} onClick={() => setCropIndex(index)}>{index + 1}번 영역 직접 선택</button>
            <button type="button" className="secondary-button" disabled={rowBusy(row) || applicationLock.current} onClick={() => { void retry(index); }}>{index + 1}번 대비 보정 후 다시 읽기</button>
            <label className="ocr-replace-file secondary-button">다른 사진 선택<input type="file" accept="image/png,image/jpeg,image/webp" disabled={rowBusy(row) || applicationLock.current} aria-label={`${index + 1}번 다른 사진 선택`} onChange={event => {
              const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
              if (file) void retry(index, undefined, file);
            }} /></label>
          </div>}
          {cropIndex === index && <TooltipRegionSelector file={row.file} onSelect={region => { void retry(index, region); }} onCancel={() => setCropIndex(null)} />}
          {row.replacement && <>
            <label className="check-field"><input type="checkbox" checked={isIncluded(row)} disabled={row.state === "applied" || rowBusy(row)}
              onChange={event => edit(index, {included: event.currentTarget.checked, allowDuplicate: event.currentTarget.checked && !!duplicate})} />{index + 1}번 {duplicate ? "별도 장비로 포함" : "적용에 포함"}</label>
            <div className="field"><label htmlFor={`${id}-batch-destination-${index}`}>{index + 1}번 적용 위치</label>
              <select id={`${id}-batch-destination-${index}`} value={row.needsDestination ? "" : row.destination} disabled={row.state === "applied" || rowBusy(row)}
                aria-invalid={row.needsDestination || undefined}
                onChange={event => edit(index, {destination: event.currentTarget.value as Row["destination"], needsDestination: false})}>
                <option value="" disabled>{row.category === "반지" ? "적용할 반지 칸을 선택하세요" : "장비 부위를 선택하세요"}</option>
                {!limitedSlots && <option value="new">새 장비 부위로 추가</option>}
                {!limitedSlots && WEAPON_PRESETS.map(preset => <option key={preset.id} value={`preset:${preset.id}`}>{preset.label} 무기 프리셋 (교체)</option>)}
                {choices.filter(choice => !limitedSlots || limitedSlots.includes(choice.slot)).map(choice => <option key={choice.slot} value={choice.slot}>{choice.label}{occupied(choice.equipment) ? " (기존 값 교체)" : " (빈칸)"}</option>)}
              </select>
            </div>
            {row.needsDestination && <p className="ocr-duplicate-message">{row.category === "반지" ? "반지는 최대 4개입니다. 적용할 반지 칸을 선택하거나 이 사진을 제외하세요." : pendant ? "펜던트는 최대 2개입니다. 적용할 펜던트 칸을 선택하거나 이 사진을 제외하세요." : "장비 부위를 읽지 못했습니다. 원본을 보고 적용 위치를 선택하세요."}</p>}
            {row.destination === "new" && !limitedSlots && <div className="field"><label htmlFor={`${id}-batch-label-${index}`}>{index + 1}번 새 장비 이름</label>
              <input id={`${id}-batch-label-${index}`} maxLength={30} value={row.label} disabled={row.state === "applied" || rowBusy(row)} onChange={event => edit(index, {label: event.currentTarget.value})} />
            </div>}
            {pendant && <PendantSelect label={`${index + 1}번 펜던트 종류`} value={row.pendantChoice ?? pendantFromName(identity?.name)} disabled={row.state === "applied" || rowBusy(row)} onChange={value => edit(index, { pendantChoice: value })} />}
            <p className="ocr-batch-stats">{fields.filter(([key]) => row.replacement![key] !== undefined && row.replacement![key] !== "").map(([key, label]) => `${label} ${row.replacement![key]}`).join(" · ") || "아직 확정할 수 있는 옵션이 없어요."}</p>
            {row.review && row.state !== "applied" && <fieldset disabled={rowBusy(row)} style={{ border: 0, padding: 0, margin: 0 }}><OcrReviewIssues key={row.attempt} review={row.review} job={job} image={row.preview} onChange={review => setReview(index, review)} /></fieldset>}
            {!validReplacement(row.replacement) && <p role="alert">{index + 1}번 인식값을 확인하세요. 스탯·공격력은 0~9999, 비율은 0~999, 방무는 0~100이며, 적용할 값이 필요합니다.</p>}
            <details><summary>{index + 1}번 이미지·인식값 확인 및 수정</summary>
              {!saveOnApply && <ImagePreview file={row.preview} original={row.file} />}

              <div className="equipment-ocr-proposal-grid">{fields.map(([key, label]) => <div className="field" key={key}>
                <label htmlFor={`${id}-batch-${index}-${key}`}>{index + 1}번 인식 {label}</label>
                <input id={`${id}-batch-${index}-${key}`} type="number" min={0} max={(key === "ignoreDefensePercent" || key === "criticalRate") ? 100 : key.endsWith("Percent") ? 999 : 9999} step={(key.endsWith("Percent") || key === "criticalRate") ? "any" : 1}
                  value={row.replacement![key] ?? ""} placeholder={row.review && row.replacement![key] === undefined ? "미인식 · 기존 값 유지" : undefined} disabled={row.state === "applied" || rowBusy(row)} onChange={event => {
                    const value = event.currentTarget.value, review = overrideReviewRequirement(row.review, job, key, value);
                    edit(index, { replacement: {...row.replacement!, [key]: value}, overrides: { ...row.overrides, [key]: value },
                      review, text: review ? reviewText(review) : row.text });
                  }} />
              </div>)}</div>
            </details>
          </>}
        </li>;
      })}
    </ol>
    {applyError && <p role="alert" className="ocr-duplicate-message">{applyError}</p>}
    <div className="equipment-ocr-actions">
      <button type="button" className="equipment-ocr-apply" disabled={busy || selected.length === 0 || selected.some(row => row.needsDestination || (row.review && reviewBlocked(row.review, job)) || !validReplacement(row.replacement!))} onClick={() => {
        if (applicationLock.current) return;
        applicationLock.current = true;
        try {
          const error = onApply(job, selected.map(row => ({replacement: row.replacement!, destination: row.destination, label: row.label,
            ...(row.category === "반지" || isPendantCategory(row.category) ? { category: row.category } : {}),
            ...(isPendantCategory(row.category) || PENDANT_SLOTS.includes(row.destination as EquipmentSlot) ? { pendantId: row.pendantChoice ?? pendantFromName(tooltipIdentity(row.text).name) } : {})})));
          setApplyError(error);
          if (!error) setRows(current => current.map(row => selected.includes(row) ? {...row, state: "applied", included: false} : row));
        } finally { applicationLock.current = false; }
      }}>{saveOnApply ? `확인하고 프리셋 저장 (${selected.length}개 장비)` : `검토한 ${selected.length}개 장비 적용`}</button>
      <button type="button" className="equipment-ocr-cancel" onClick={busy ? cancel : onClose}>{busy ? "전체 인식 취소" : "목록 닫기"}</button>
    </div>
  </section>;
}
