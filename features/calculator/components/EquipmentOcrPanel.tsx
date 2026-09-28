"use client";

import {
  useCallback,
  useId,
  useEffect,
  useState,
  useRef,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { JOB_RULES } from "../domain/job-rules";
import { matchingSlots } from "../domain/slots";
import { EQUIPMENT_SLOT_LABELS } from "../labels";
import {
  createBrowserTooltipRecognizer,
  isSupportedTooltipImage,
  MAX_TOOLTIP_IMAGE_BYTES,
  toRecognitionError,
  recognitionErrorMessage,
  type TooltipRecognizer,
} from "../ocr/recognizeTooltip.client";
import { mapRecognizedStats } from "../ocr/mapRecognizedStats";
import { parseMapleTooltip } from "../ocr/parseMapleTooltip";
import type { OcrBounds, OcrReview, OcrTarget, OcrSource, StatReplacement } from "../ocr/types";
import { isPendantCategory, pendantFromName, PENDANT_SLOTS } from "../domain/pendants";
import { PendantSelect } from "./PendantSelect";
import { mapReviewedStats, reviewBlocked, reviewText } from "../ocr/reviewRecognition";
import { OcrReviewIssues } from "./OcrReviewIssues";
import { TooltipRegionSelector } from "./TooltipRegionSelector";
import { EquipmentOcrBatchPanel } from "./EquipmentOcrBatchPanel";
import { tooltipIdentity, existingDuplicate, MAX_BATCH_BYTES, MAX_BATCH_FILES, type ApplyOcrBatch, type OcrSlotChoice } from "../ocr/batch";
import { clipboardImages } from "../ocr/clipboard";

export type EquipmentOcrPanelProps = {
  target: OcrTarget;
  slotLabel?: string;
  onApply: (target: OcrTarget, replacement: StatReplacement, source?: OcrSource) => void;
  purpose?: "equipment" | "candidate";
  onAddAsNew?: (target: OcrTarget, label: string, replacement: StatReplacement) => void;
  createRecognizer?: () => TooltipRecognizer;
  slotChoices?: OcrSlotChoice[];
  /** Candidate destinations are resolved after OCR without changing the active OCR target. */
  candidateSlots?: Pick<OcrSlotChoice, "slot" | "label">[];
  uploadFields?: ReactNode;
  onApplyBatch?: ApplyOcrBatch;
  captureDocumentPaste?: boolean;
};

type PanelStatus = "idle" | "loading" | "recognizing" | "ready" | "error";

type ActiveOperation = {
  id: number;
  controller: AbortController;
};

const createPreviewUrl = (file: File): string | null => {
  if (typeof URL.createObjectURL !== "function") return null;

  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
};

const revokePreviewUrl = (url: string | null): void => {
  if (url === null || typeof URL.revokeObjectURL !== "function") return;
  URL.revokeObjectURL(url);
};

const progressMessage = (
  status: Exclude<PanelStatus, "idle" | "ready" | "error">,
  progress: number,
): string => {
  const percent = Math.round(progress * 100);
  return status === "loading"
    ? `인식 기능을 준비하는 중입니다 (${percent}%).`
    : `장비 옵션을 인식하는 중입니다 (${percent}%).`;
};

export function EquipmentOcrPanel({
  target,
  purpose = "equipment",
  slotLabel: providedSlotLabel,
  onApply,
  onAddAsNew,
  createRecognizer,
  slotChoices = [],
  candidateSlots,
  uploadFields,
  onApplyBatch,
  captureDocumentPaste = true,
}: EquipmentOcrPanelProps) {
  const panelId = useId();
  const [candidateConfirmed,setCandidateConfirmed] = useState(false);
  const [candidateSlot, setCandidateSlot] = useState("");
  const [pendantChoice, setPendantChoice] = useState<string | null>(null);
  const [recognizer] = useState<TooltipRecognizer>(() => (
    createRecognizer === undefined
      ? createBrowserTooltipRecognizer()
      : createRecognizer()
  ));

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const operationIdRef = useRef(0);
  const activeOperationRef = useRef<ActiveOperation | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [status, setStatus] = useState<PanelStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [proposal, setProposal] = useState<StatReplacement | null>(null);
  const [review, setReview] = useState<OcrReview | null>(null);
  const [reviewImage, setReviewImage] = useState<File | null>(null);
  const [overrides, setOverrides] = useState<StatReplacement>({});
  const [selectingRegion, setSelectingRegion] = useState(false);
  const [recognizedText, setRecognizedText] = useState("");
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [batch, setBatch] = useState<{id: number; job: OcrTarget["job"]; files: File[]} | null>(null);
  const batchId = useRef(0);
  const [capturedTarget, setCapturedTarget] = useState<OcrTarget | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [error, setError] = useState<{
    message: string;
    retryable: boolean;
  } | null>(null);

  const clearPreview = useCallback(() => {
    const currentUrl = previewUrlRef.current;
    previewUrlRef.current = null;
    if (currentUrl !== null) revokePreviewUrl(currentUrl);
    setPreviewUrl(null);
  }, []);

  const cancelCurrent = useCallback((clearProposal = true) => {
    operationIdRef.current += 1;
    const active = activeOperationRef.current;
    activeOperationRef.current = null;

    if (active !== null) {
      active.controller.abort();
      void recognizer.terminate();
    }
    clearPreview();
    setStatus("idle");
    setProgress(0);
    setError(null);
    setLastFile(null);
    setReview(null);
    setReviewImage(null);
    setOverrides({});
    setCandidateConfirmed(false);
    setCandidateSlot("");
    setPendantChoice(null);
    setSelectingRegion(false);
    if (clearProposal) {
      setAllowDuplicate(false);
      setProposal(null);
      setRecognizedText("");
      setCapturedTarget(null);
    }
  }, [clearPreview, recognizer]);

  const processFile = useCallback((file: File, region?: OcrBounds, enhance = false) => {
    cancelCurrent();

    if (!isSupportedTooltipImage(file)) {
      setStatus("error");
      setError({ message: recognitionErrorMessage({ code: "UNSUPPORTED_FILE", retryable: false }), retryable: false });
      return;
    }
    if (file.size > MAX_TOOLTIP_IMAGE_BYTES) {
      setStatus("error");
      setError({ message: recognitionErrorMessage({ code: "FILE_TOO_LARGE", retryable: false }), retryable: false });
      return;
    }

    setLastFile(file);
    setReviewImage(file);
    const id = operationIdRef.current + 1;
    operationIdRef.current = id;
    const controller = new AbortController();
    const captured = { ...target };
    const nextPreviewUrl = createPreviewUrl(file);
    previewUrlRef.current = nextPreviewUrl;
    setPreviewUrl(nextPreviewUrl);
    activeOperationRef.current = {
      id,
      controller,
    };
    setStatus("loading");
    setProgress(0);
    setError(null);

    void (async () => {
      let recognizedReview: OcrReview | undefined;
      let succeeded = false;
      try {
        const text = await recognizer.recognize(file, {
          signal: controller.signal, region, enhance,
          onReview: result => { recognizedReview = result; },
          onPrepared: image => {
            if (controller.signal.aborted || activeOperationRef.current?.id !== id) return;
            setReviewImage(image);
            revokePreviewUrl(previewUrlRef.current);
            const url = createPreviewUrl(image);
            previewUrlRef.current = url;
            setPreviewUrl(url);
          },
          onProgress: ({ status: nextStatus, progress: nextProgress }) => {
            if (
              activeOperationRef.current?.id !== id ||
              controller.signal.aborted
            ) {
              return;
            }
            setStatus(nextStatus);
            setProgress(nextProgress);
          },
        });

        if (
          activeOperationRef.current?.id !== id ||
          operationIdRef.current !== id ||
          controller.signal.aborted
        ) {
          return;
        }

        setRecognizedText(text);
        setReview(recognizedReview ?? null);
        setProposal(recognizedReview ? mapReviewedStats(recognizedReview, captured.job) : mapRecognizedStats(parseMapleTooltip(text), captured.job));
        setCapturedTarget(captured);
        setStatus("ready");
        setProgress(1);
        succeeded = true;
      } catch (recognitionError) {
        if (
          activeOperationRef.current?.id !== id ||
          operationIdRef.current !== id ||
          controller.signal.aborted
        ) {
          return;
        }

        const normalized = toRecognitionError(recognitionError);
        if (normalized.code === "CANCELLED") {
          setStatus("idle");
          setError(null);
          return;
        }

        setStatus("error");
        setError({
          message: recognitionErrorMessage(normalized),
          retryable: normalized.retryable,
        });
      } finally {
        if (activeOperationRef.current?.id !== id) return;
        activeOperationRef.current = null;
        if (!succeeded) clearPreview();
      }
    })();
  }, [cancelCurrent, clearPreview, recognizer, target]);

  const processFiles = useCallback((files: File[]) => {
    if (!files.length) return;
    if (purpose === "candidate" && files.length > 1) { setError({message:"후보 사진은 한 장씩 추가해주세요.",retryable:false}); return; }
    if (files.length > MAX_BATCH_FILES || files.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) {
      setError({message: "한 번에 최대 50장, 합계 120MB까지 선택할 수 있습니다.", retryable: false});
      return;
    }
    if (onApplyBatch && (files.length > 1 || batch !== null)) {
      cancelCurrent();
      setBatch({id: ++batchId.current, job: target.job, files});
    } else {
      setBatch(null);
      processFile(files[0]);
    }
  }, [onApplyBatch, batch, cancelCurrent, target.job, processFile, purpose]);

  useEffect(() => {
    return () => {
      operationIdRef.current += 1;
      const active = activeOperationRef.current;
      activeOperationRef.current = null;
      active?.controller.abort();
      clearPreview();
      void recognizer.terminate();
    };
  }, [clearPreview, recognizer]);

  useEffect(() => {
    // A target change intentionally resets local proposal state after cancelling
    // the operation that captured the previous target.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cancelCurrent();
    setBatch(current => current?.job !== target.job ? null : current);
  }, [cancelCurrent, target.job, target.slot]);

  useEffect(() => {
    if (!captureDocumentPaste) return;
    const handleDocumentPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      if (purpose === "candidate" && !fileInputRef.current?.closest("dialog")?.hasAttribute("open")) return;
      const files = clipboardImages(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      if (purpose === "candidate") event.stopPropagation();
      processFiles(files);
    };

    document.addEventListener("paste", handleDocumentPaste, purpose === "candidate");
    return () => document.removeEventListener("paste", handleDocumentPaste, purpose === "candidate");
  }, [processFiles, captureDocumentPaste, purpose]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    processFiles(files);
  };

  const updateProposal = (field: keyof StatReplacement, value: string) => {
    setCandidateConfirmed(false);
    setOverrides(current => ({ ...current, [field]: value }));
    setProposal((current) => current === null
      ? current
      : { ...current, [field]: value });
  };
  const updateReview = (next: OcrReview) => {
    setCandidateConfirmed(false);
    setReview(next);
    setRecognizedText(reviewText(next));
    setProposal({ ...mapReviewedStats(next, target.job), ...overrides });
  };

  const rule = JOB_RULES[target.job];
  const slotLabel = providedSlotLabel ?? EQUIPMENT_SLOT_LABELS[target.slot as keyof typeof EQUIPMENT_SLOT_LABELS] ?? "추가 장비";
  const fieldDefinitions: Array<{
    field: keyof StatReplacement;
    label: string;
    max: number;
    step: number | "any";
  }> = [
    { field: "mainFlat", label: `인식 ${rule.mainStat}`, max: 9999, step: 1 },
    { field: "subFlat", label: `인식 ${rule.subStat}`, max: 9999, step: 1 },
    { field: "mainPercent", label: `인식 ${rule.mainStat}%`, max: 999, step: "any" },
    { field: "subPercent", label: `인식 ${rule.subStat}%`, max: 999, step: "any" },
    { field: "attackFlat", label: "인식 공격력", max: 9999, step: 1 },
    { field: "attackPercent", label: "인식 공격력%", max: 999, step: "any" },
    { field: "requiredLevel", label: "인식 요구 레벨", max: 9999, step: 1 },
    { field: "requiredSub", label: `인식 요구 ${rule.subStat}`, max: 9999, step: 1 },
    { field: "totalDamagePercent", label: "인식 총데미지%", max: 999, step: "any" },
    { field: "bossDamagePercent", label: "인식 보스공격력%", max: 999, step: "any" },
    { field: "ignoreDefensePercent", label: "인식 방어율 무시%", max: 100, step: "any" },
  ];
  const parsed = { ...parseMapleTooltip(recognizedText), ...(review ? { category: review.category } : {}) };
  const candidateMatches = matchingSlots(parsed.category, candidateSlots ?? []);
  const candidateChoices = parsed.category ? candidateMatches : candidateSlots ?? [];
  const candidateDestination = candidateMatches.length === 1 ? candidateMatches[0]
    : candidateChoices.find(choice => choice.slot === candidateSlot);
  const needsCandidateSlot = purpose === "candidate" && candidateSlots !== undefined && !candidateDestination;
  const reviewingPendant = isPendantCategory(parsed.category) || (purpose === "candidate" ? !!candidateDestination && PENDANT_SLOTS.includes(candidateDestination.slot) : PENDANT_SLOTS.includes(target.slot));
  const pendantId = pendantChoice ?? pendantFromName(tooltipIdentity(recognizedText).name);
  const needsPendantTarget = purpose === "equipment" && isPendantCategory(parsed.category) && !PENDANT_SLOTS.includes(target.slot);
  const duplicate = existingDuplicate(parsed, target.job, slotChoices);
  const duplicateBlocked = duplicate !== null && !allowDuplicate;
  const needsReview = review ? reviewBlocked(review, target.job) : false;
  const hasApplicableOptions = Object.values(proposal ?? {}).some(value => value !== undefined && value !== "");
  const proposalValid = fieldDefinitions.every(({field, max, step}) => {
    const raw = proposal?.[field];
    if (raw === undefined || raw === "") return true;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= max && (step === "any" || Number.isInteger(value));
  });

  return (
    <section
      className={`equipment-ocr-panel${purpose === "candidate" ? " candidate-import-panel" : ""}`}
      aria-labelledby={`${panelId}-heading`}
      tabIndex={purpose === "candidate" ? 0 : undefined}
      onPaste={event => { if(purpose!=="candidate")return; const files=clipboardImages(event.clipboardData);if(files.length){event.preventDefault();event.stopPropagation();processFiles(files);} }}
      onDragOver={event=>{if(purpose==="candidate")event.preventDefault();}}
      onDrop={event=>{if(purpose==="candidate"){event.preventDefault();event.stopPropagation();processFiles(Array.from(event.dataTransfer.files));}}}
    >
      <div className={purpose === "candidate" ? "candidate-sr-only" : "equipment-ocr-heading"}>
        <div>

          <h3 id={`${panelId}-heading`}>{batch && batch.job === target.job ? "여러 장비" : slotLabel} 스크린샷 인식</h3>
        </div>

      </div>

      <div className="equipment-ocr-upload">
        <button
          type="button"
          className="equipment-ocr-select-button"
          onClick={() => fileInputRef.current?.click()}
        >
          {purpose === "candidate" ? lastFile ? "사진 변경" : "장비 사진 선택" : "스크린샷 선택"}
        </button>
        <input
          ref={fileInputRef}
          className="equipment-ocr-file-input"
          type="file"
          multiple={purpose !== "candidate"}
          accept="image/png,image/jpeg,image/webp"
          aria-label={purpose === "candidate" ? "비교 후보 스크린샷" : "장비 스크린샷 파일"}
          tabIndex={-1}
          onChange={handleFileChange}
        />
        {(captureDocumentPaste || purpose === "candidate") && <div
          className="equipment-ocr-paste-zone"
          tabIndex={0}
          role="group"
          aria-label="장비 스크린샷 붙여넣기"
        >
          Ctrl+V로 붙여넣기
        </div>}
      </div>
      {uploadFields}
      {batch && batch.job === target.job && onApplyBatch && <EquipmentOcrBatchPanel key={batch.id}
        files={batch.files} job={batch.job} choices={slotChoices} onApply={onApplyBatch}
        createRecognizer={createRecognizer} onClose={() => setBatch(null)} />}

      <div className={purpose === "candidate" && proposal !== null ? "candidate-review-layout" : "equipment-recognition-content"}>
      {previewUrl === null ? null : (
        <figure className="equipment-ocr-preview">
          {purpose === "candidate" && <figcaption>장비 사진</figcaption>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="선택한 장비 스크린샷 미리보기" />
        </figure>
      )}

      {status !== "idle" && (!batch || batch.job !== target.job) && <p className="equipment-ocr-status" role="status" aria-live="polite">
        {status === "loading" && progressMessage("loading", progress)}
        {status === "recognizing" && progressMessage("recognizing", progress)}
        {status === "ready" && "인식 완료"}
        {status === "error" && "인식에 실패했습니다."}
      </p>}

      {status === "loading" || status === "recognizing" ? (
        <button
          type="button"
          className="equipment-ocr-cancel"
          onClick={() => cancelCurrent()}
        >
          인식 취소
        </button>
      ) : null}

      {error === null ? null : (
        <div className="equipment-ocr-error" role="alert" aria-live="assertive">
          <span>{error.message}</span>
          {error.retryable && lastFile !== null ? (
            <button
              type="button"
              className="equipment-ocr-retry"
              onClick={() => {
                const file = lastFile;
                if (file !== null) processFile(file);
              }}
            >
              다시 시도
            </button>
          ) : null}
        </div>
      )}

      {lastFile && (status === "error" || status === "ready") && <div className="equipment-ocr-actions">
        <button type="button" className="secondary-button" onClick={() => setSelectingRegion(true)}>설명창 영역 직접 선택</button>
        <button type="button" className="secondary-button" onClick={() => processFile(lastFile, undefined, true)}>대비 보정 후 다시 읽기</button>
      </div>}
      {selectingRegion && lastFile && <TooltipRegionSelector file={lastFile} onSelect={region => processFile(lastFile, region)} onCancel={() => setSelectingRegion(false)} />}

      {proposal === null ? null : (
        <div className="equipment-ocr-review">
          <div className="equipment-ocr-review-heading">
            <h4>인식값 검토</h4>
            <span>{purpose === "candidate" ? candidateDestination ? `${candidateDestination.label} 교체` : "구매 후보" : capturedTarget?.slot === target.slot ? "현재 카드" : "이전 카드"}</span>
          </div>
          {purpose === "candidate" && candidateSlots !== undefined && candidateMatches.length !== 1 && <div className="candidate-slot-review">
            <p role="status">{parsed.category
              ? candidateChoices.length ? `${parsed.category} 장착 칸이 여러 개입니다. 교체할 장비를 선택해주세요.` : `인식 부위(${parsed.category})에 맞는 장비 부위를 먼저 추가해주세요.`
              : "부위를 인식하지 못했습니다. 교체할 장비를 선택해주세요."}</p>
            {candidateChoices.length > 0 && <label>교체할 장비<select aria-label="교체할 장비 부위" value={candidateDestination?.slot ?? ""} onChange={event => setCandidateSlot(event.target.value)}>
              <option value="" disabled>부위 선택</option>{candidateChoices.map(choice => <option key={choice.slot} value={choice.slot}>{choice.label}</option>)}
            </select></label>}
          </div>}
          <p>{purpose === "candidate" ? "미입력 옵션은 0으로 비교합니다. 요구 레벨·스탯은 확인해주세요." : "미인식 값은 유지됩니다. 삭제하려면 0을 입력하세요."}</p>
          {reviewingPendant && <PendantSelect label="인식 펜던트 종류" value={pendantId} onChange={value => { setPendantChoice(value); setCandidateConfirmed(false); }} />}
          {needsPendantTarget && <p role="alert">펜던트 1·2 카드를 선택한 뒤 사진을 넣어주세요.</p>}
          {review && reviewImage && <OcrReviewIssues review={review} job={target.job} image={reviewImage} onChange={updateReview} />}
          {duplicate && <div className="ocr-duplicate-message" role="alert">
            <p>{duplicate} 같은 옵션의 실제 별도 장비인지 확인하세요.</p>
            <label className="check-field"><input type="checkbox" checked={allowDuplicate} onChange={event => setAllowDuplicate(event.currentTarget.checked)} />중복 확인 후 적용 허용</label>
          </div>}
          <div className="equipment-ocr-proposal-grid">
            {fieldDefinitions.map(({ field, label, max, step }) => (
              <div className="field" key={field}>
                <label htmlFor={`${panelId}-${field}`}>{purpose === "candidate" ? label.replace(/^인식 /, "") : label}</label>
                <input
                  id={`${panelId}-${field}`}
                  aria-label={label}
                  type="number"
                  min={0}
                  max={max}
                  step={step}
                  value={proposal[field] ?? ""}
                  placeholder={review && proposal[field] === undefined ? purpose === "candidate" ? "미인식 · 직접 입력" : "미인식 · 기존 값 유지" : undefined}
                  onChange={(event) => updateProposal(field, event.currentTarget.value)}
                />
              </div>
            ))}
          </div>
          {!hasApplicableOptions && <p role="alert">계산에 적용할 옵션을 찾지 못했습니다. 위 항목에 직접 입력하거나 다른 사진을 넣어주세요.</p>}
          {!proposalValid && <p role="alert">검토값의 범위를 확인하세요. 스탯·공격력은 0~9999, 비율은 0~999입니다.</p>}
          {purpose === "candidate" && <label className="check-field"><input type="checkbox" checked={candidateConfirmed} onChange={event=>setCandidateConfirmed(event.target.checked)} />원본의 모든 옵션을 확인했습니다</label>}
          <div className="equipment-ocr-actions">
            {parsed.category && !isPendantCategory(parsed.category) && onAddAsNew && (
              <button
                type="button"
                className="equipment-ocr-apply"
                disabled={!hasApplicableOptions || !proposalValid || duplicateBlocked || needsReview}
                onClick={() => {
                  if (capturedTarget) onAddAsNew(capturedTarget, parsed.category!, proposal);
                }}
              >
                {parsed.category} 새 장비로 추가
              </button>
            )}
            <button
              type="button"
              className="equipment-ocr-apply"
              disabled={!hasApplicableOptions || !proposalValid || duplicateBlocked || needsReview || needsCandidateSlot || needsPendantTarget || (purpose === "candidate" && !candidateConfirmed)}
              onClick={() => {
                if (capturedTarget === null) return;
                if (purpose === "candidate" || (reviewingPendant && pendantId !== undefined)) {
                  onApply(purpose === "candidate" ? {...capturedTarget, slot:candidateDestination?.slot ?? capturedTarget.slot} : capturedTarget, proposal,
                    {category:parsed.category,name:tooltipIdentity(recognizedText).name,file:lastFile,previewFile:reviewImage,...(reviewingPendant && pendantId !== undefined ? {pendantId} : {})});
                } else onApply(capturedTarget, proposal);
              }}
            >
              {purpose === "candidate" ? "후보로 비교" : "인식값 적용"}
            </button>
            <button
              type="button"
              className="equipment-ocr-cancel"
              onClick={() => cancelCurrent()}
            >
              취소
            </button>
          </div>
        </div>
      )}
      </div>
    </section>
  );
}
