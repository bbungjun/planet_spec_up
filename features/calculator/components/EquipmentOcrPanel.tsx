"use client";

import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type ChangeEvent,
} from "react";
import { JOB_RULES } from "../domain/job-rules";
import { EQUIPMENT_SLOT_LABELS } from "../labels";
import {
  createBrowserTooltipRecognizer,
  isSupportedTooltipImage,
  MAX_TOOLTIP_IMAGE_BYTES,
  toRecognitionError,
  type TooltipRecognizer,
} from "../ocr/recognizeTooltip.client";
import { mapRecognizedStats } from "../ocr/mapRecognizedStats";
import { parseMapleTooltip } from "../ocr/parseMapleTooltip";
import type { OcrTarget, StatReplacement } from "../ocr/types";

export type EquipmentOcrPanelProps = {
  target: OcrTarget;
  onApply: (target: OcrTarget, replacement: StatReplacement) => void;
  createRecognizer?: () => TooltipRecognizer;
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

type ClipboardDataEvent = {
  clipboardData: DataTransfer | null;
};

const findClipboardImage = (event: ClipboardDataEvent): File | null => {
  const clipboard = event.clipboardData;
  if (clipboard === null) return null;

  for (const item of Array.from(clipboard.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file !== null && file.type.toLowerCase().startsWith("image/")) {
      return file;
    }
  }

  for (const file of Array.from(clipboard.files ?? [])) {
    if (file.type.toLowerCase().startsWith("image/")) return file;
  }

  return null;
};

const errorMessage = (code: string): string => {
  switch (code) {
    case "UNSUPPORTED_FILE":
      return "지원되지 않는 이미지 형식입니다. PNG, JPEG, WebP를 선택하세요.";
    case "FILE_TOO_LARGE":
      return "이미지가 너무 큽니다. 12MB 이하의 이미지를 선택하세요.";
    case "CANCELLED":
      return "OCR을 취소했습니다.";
    default:
      return "이미지에서 장비 옵션을 읽지 못했습니다. 다시 시도하세요.";
  }
};

const progressMessage = (
  status: Exclude<PanelStatus, "idle" | "ready" | "error">,
  progress: number,
): string => {
  const percent = Math.round(progress * 100);
  return status === "loading"
    ? `OCR 언어 데이터를 준비하는 중입니다 (${percent}%).`
    : `장비 옵션을 인식하는 중입니다 (${percent}%).`;
};

export function EquipmentOcrPanel({
  target,
  onApply,
  createRecognizer,
}: EquipmentOcrPanelProps) {
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
  const [recognizedText, setRecognizedText] = useState("");
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
    if (clearProposal) {
      setProposal(null);
      setRecognizedText("");
      setCapturedTarget(null);
    }
  }, [clearPreview, recognizer]);

  const processFile = useCallback((file: File) => {
    cancelCurrent();

    if (!isSupportedTooltipImage(file)) {
      setStatus("error");
      setError({ message: errorMessage("UNSUPPORTED_FILE"), retryable: false });
      return;
    }
    if (file.size > MAX_TOOLTIP_IMAGE_BYTES) {
      setStatus("error");
      setError({ message: errorMessage("FILE_TOO_LARGE"), retryable: false });
      return;
    }

    setLastFile(file);
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
      try {
        const text = await recognizer.recognize(file, {
          signal: controller.signal,
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
        setProposal(mapRecognizedStats(parseMapleTooltip(text), captured.job));
        setCapturedTarget(captured);
        setStatus("ready");
        setProgress(1);
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
          message: errorMessage(normalized.code),
          retryable: normalized.retryable,
        });
      } finally {
        if (activeOperationRef.current?.id !== id) return;
        activeOperationRef.current = null;
        clearPreview();
      }
    })();
  }, [cancelCurrent, clearPreview, recognizer, target]);

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
  }, [cancelCurrent, target.job, target.slot]);

  useEffect(() => {
    const handleDocumentPaste = (event: ClipboardEvent) => {
      const file = findClipboardImage(event);
      if (file === null) return;
      event.preventDefault();
      processFile(file);
    };

    document.addEventListener("paste", handleDocumentPaste);
    return () => document.removeEventListener("paste", handleDocumentPaste);
  }, [processFile]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (file !== null) processFile(file);
  };

  const updateProposal = (field: keyof StatReplacement, value: string) => {
    setProposal((current) => current === null
      ? current
      : { ...current, [field]: value });
  };

  const rule = JOB_RULES[target.job];
  const slotLabel = EQUIPMENT_SLOT_LABELS[target.slot];
  const fieldDefinitions: Array<{
    field: keyof StatReplacement;
    label: string;
    max: number;
    step: number | "any";
  }> = [
    { field: "mainFlat", label: `OCR ${rule.mainStat}`, max: 9999, step: 1 },
    { field: "subFlat", label: `OCR ${rule.subStat}`, max: 9999, step: 1 },
    { field: "mainPercent", label: `OCR ${rule.mainStat}%`, max: 999, step: "any" },
    { field: "subPercent", label: `OCR ${rule.subStat}%`, max: 999, step: "any" },
    { field: "attackFlat", label: "OCR 공격력", max: 9999, step: 1 },
    { field: "attackPercent", label: "OCR 공격력%", max: 999, step: "any" },
    { field: "requiredSub", label: `OCR 요구 ${rule.subStat}`, max: 9999, step: 1 },
    { field: "damagePercent", label: "OCR 보공·총데미지%", max: 999, step: "any" },
  ];
  const parsed = parseMapleTooltip(recognizedText);
  const hasApplicableOptions = parsed.options.some(option => {
    const mapped = mapRecognizedStats(parseMapleTooltip(option.raw), target.job);
    return Object.values(mapped).some(value => value !== "");
  });
  const proposalValid = fieldDefinitions.every(({field, max, step}) => {
    const raw = proposal?.[field];
    if (raw === undefined || raw === "") return true;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= max && (step === "any" || Number.isInteger(value));
  });

  return (
    <section
      className="equipment-ocr-panel"
      aria-labelledby="equipment-ocr-heading"
    >
      <div className="equipment-ocr-heading">
        <div>
          <p className="panel-kicker">로컬 OCR</p>
          <h3 id="equipment-ocr-heading">{slotLabel} 스크린샷 인식</h3>
        </div>
        <span className="job-chip">{rule.mainStat} / {rule.subStat}</span>
      </div>
      <p className="equipment-ocr-description">
        이미지를 붙여넣으면 스탯·공격력·잠재 옵션을 읽습니다. 인식값을 확인한 뒤 선택한 장비에 적용하세요.
      </p>

      <div className="equipment-ocr-upload">
        <button
          type="button"
          className="equipment-ocr-select-button"
          onClick={() => fileInputRef.current?.click()}
        >
          스크린샷 선택
        </button>
        <input
          ref={fileInputRef}
          className="equipment-ocr-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="장비 스크린샷 파일"
          tabIndex={-1}
          onChange={handleFileChange}
        />
        <div
          className="equipment-ocr-paste-zone"
          tabIndex={0}
          role="group"
          aria-label="장비 스크린샷 붙여넣기"
        >
          페이지 어디서든 Ctrl+V로 붙여넣기
        </div>
      </div>

      {previewUrl === null ? null : (
        <figure className="equipment-ocr-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="선택한 장비 스크린샷 미리보기" />
        </figure>
      )}

      <p className="equipment-ocr-status" role="status" aria-live="polite">
        {status === "idle" && "스크린샷을 선택하거나 붙여넣으세요."}
        {status === "loading" && progressMessage("loading", progress)}
        {status === "recognizing" && progressMessage("recognizing", progress)}
        {status === "ready" && "인식 결과를 확인한 뒤 적용할 수 있습니다."}
        {status === "error" && "인식에 실패했습니다."}
      </p>

      {status === "loading" || status === "recognizing" ? (
        <button
          type="button"
          className="equipment-ocr-cancel"
          onClick={() => cancelCurrent()}
        >
          OCR 취소
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

      {proposal === null ? null : (
        <div className="equipment-ocr-review">
          <div className="equipment-ocr-review-heading">
            <h4>인식값 검토</h4>
            <span>{capturedTarget?.slot === target.slot ? "현재 카드" : "이전 카드"}</span>
          </div>
          <p>기본 스탯 4개는 교체합니다. 공격력·요구 스탯·보공·총데미지는 인식된 항목만 교체합니다.</p>
          {parsed.options.some(option => option.label.replace(/\s/g, "") === "흑수정강화공격력") && (
            <p>사진에 표시된 공격력 수치를 그대로 입력합니다. 흑수정 강화 공격력은 별도 표기로 목록에만 표시합니다.</p>
          )}
          <div className="equipment-ocr-proposal-grid">
            {fieldDefinitions.filter(({field}) => proposal[field] !== undefined).map(({ field, label, max, step }) => (
              <div className="field" key={field}>
                <label htmlFor={`equipment-ocr-${field}`}>{label}</label>
                <input
                  id={`equipment-ocr-${field}`}
                  type="number"
                  min={0}
                  max={max}
                  step={step}
                  value={proposal[field]}
                  onChange={(event) => updateProposal(field, event.currentTarget.value)}
                />
              </div>
            ))}
          </div>
          <details className="equipment-ocr-details" open>
            <summary>인식한 전체 옵션 ({parsed.options.length})</summary>
            <ul>
              {parsed.options.map((option, index) => {
                const supported = Object.values(mapRecognizedStats(parseMapleTooltip(option.raw), target.job)).some(value => value !== "");
                return <li key={index}>{option.requirement ? "요구 " : ""}{option.label}: {option.value}{option.percent ? "%" : ""} — {supported ? "계산 반영" : "참고용 · 현재 계산식 미반영"}</li>;
              })}
            </ul>
          </details>
          <details className="equipment-ocr-details">
            <summary>인식 텍스트 확인·수정 / 옵션 추가</summary>
            <p>누락된 옵션은 한 줄씩 추가할 수 있습니다. 예: 공격력 +106, 총데미지 +9%, REQ STR: 120</p>
            <label htmlFor="ocr-recognized-text">인식 텍스트</label>
            <textarea id="ocr-recognized-text" rows={10} value={recognizedText} onChange={event => {
              const text = event.currentTarget.value;
              setRecognizedText(text);
              setProposal(mapRecognizedStats(parseMapleTooltip(text), target.job));
            }} />
            <p>숫자나 옵션 이름이 잘못 읽힌 줄은 이미지와 대조해 수정하세요. 텍스트를 수정하면 위 검토값을 다시 계산합니다.</p>
          </details>
          {!hasApplicableOptions && <p role="alert">계산에 적용할 옵션을 찾지 못했습니다. 인식 텍스트를 확인하거나 다른 캡처를 넣어주세요.</p>}
          {!proposalValid && <p role="alert">검토값의 범위를 확인하세요. 스탯·공격력은 0~9999, 비율은 0~999입니다.</p>}
          <div className="equipment-ocr-actions">
            <button
              type="button"
              className="equipment-ocr-apply"
              disabled={!hasApplicableOptions || !proposalValid}
              onClick={() => {
                if (capturedTarget !== null) onApply(capturedTarget, proposal);
              }}
            >
              인식값 적용
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
    </section>
  );
}
