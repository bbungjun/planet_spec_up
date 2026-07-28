"use client";

import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
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

const findClipboardImage = (event: ClipboardEvent<HTMLDivElement>): File | null => {
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

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (file !== null) processFile(file);
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const file = findClipboardImage(event);
    if (file === null) return;
    event.preventDefault();
    processFile(file);
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
  ];

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
        이미지를 선택하거나 붙여넣고, 인식된 네 가지 스탯을 확인한 뒤 적용하세요.
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
          onPaste={handlePaste}
        >
          Ctrl+V로 붙여넣기
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
          <div className="equipment-ocr-proposal-grid">
            {fieldDefinitions.map(({ field, label, max, step }) => (
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
          <div className="equipment-ocr-actions">
            <button
              type="button"
              className="equipment-ocr-apply"
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
