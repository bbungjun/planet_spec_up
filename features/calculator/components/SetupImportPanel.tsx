"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { CalculatorInput } from "../domain/types";
import { getEquipmentSlotLabel, getVisibleEquipmentSlots } from "../domain/slots";
import { MAX_BATCH_BYTES, MAX_BATCH_FILES, type ApplyOcrBatch } from "../ocr/batch";
import { clipboardImages } from "../ocr/clipboard";
import { EquipmentOcrBatchPanel } from "./EquipmentOcrBatchPanel";

type Props = {
  input: CalculatorInput;
  disabled: boolean;
  savedAt: string | null;
  onApplyAndSave: ApplyOcrBatch;
  children: ReactNode;
};

export function SetupImportPanel({ input, disabled, onApplyAndSave, children }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const successMessage = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<File[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (savedCount) successMessage.current?.focus();
  }, [savedCount]);

  const acceptFiles = useCallback((incoming: File[]) => {
    if (disabled || incoming.length === 0) return;
    if (files) {
      setError("현재 인식 목록을 저장하거나 닫은 뒤 다음 스크린샷을 넣어주세요.");
      return;
    }
    if (incoming.length > MAX_BATCH_FILES || incoming.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) {
      setError("한 번에 최대 50장, 합계 120MB까지 넣을 수 있습니다.");
      return;
    }
    setError(null);
    setSavedCount(0);
    setFiles(incoming);
  }, [disabled, files]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (disabled || event.defaultPrevented || (event.target instanceof Element && event.target.closest("[data-candidate-comparison]"))) return;
      const incoming = clipboardImages(event.clipboardData);
      if (!incoming.length) return;
      event.preventDefault();
      acceptFiles(incoming);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [acceptFiles, disabled]);

  return <section className="setup-import panel" aria-labelledby="setup-import-heading">
    <div className="setup-import-start">
      <div className="setup-import-intro">

        <h2 id="setup-import-heading">장비 스크린샷을<br />한 번에 넣어주세요</h2>

        {children}

      </div>
      <div className={`setup-import-dropzone${dragging ? " is-dragging" : ""}`}
        onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={event => { event.preventDefault(); setDragging(false); acceptFiles(Array.from(event.dataTransfer.files)); }}>
        <svg className="setup-import-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <rect x="8" y="15" width="37" height="39" rx="6" stroke="currentColor" strokeWidth="2" opacity=".35" />
          <rect x="19" y="7" width="37" height="39" rx="6" fill="var(--surface)" stroke="currentColor" strokeWidth="2" />
          <path d="m24 37 9-10 7 6 5-5 6 9M37 13v10m-5-5h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <strong>{files ? `${files.length}장 확인 중` : "사진을 끌어놓거나 Ctrl+V"}</strong>

        <button type="button" className="setup-import-button" disabled={disabled || files !== null} onClick={() => fileInput.current?.click()}>
          장비 스크린샷 한 번에 선택
        </button>
        <input ref={fileInput} className="equipment-ocr-file-input" type="file" multiple
          accept="image/png,image/jpeg,image/webp" aria-label="프리셋 등록 스크린샷" tabIndex={-1}
          disabled={disabled || files !== null} onChange={event => {
            acceptFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }} />
        <small>설명창 전체가 보이게 캡처<br />PNG, JPG, WebP · 이미지당 12MB · 최대 50장 / 합계 120MB</small>
      </div>
    </div>
    {error && <p role="alert" className="setup-import-error">{error}</p>}
    {files && <EquipmentOcrBatchPanel files={files} job={input.character.job}
      choices={getVisibleEquipmentSlots(input).map(slot => ({ slot, label: getEquipmentSlotLabel(input, slot), equipment: input.equipment[slot]! }))}
      saveOnApply onApply={(job, entries) => {
        const message = onApplyAndSave(job, entries);
        if (!message) {
          setSavedCount(entries.length);
          setFiles(null);
          setError(null);
        }
        return message;
      }} onClose={() => { setFiles(null); setError(null); }} />}
    {savedCount > 0 && <div ref={successMessage} className="setup-import-success" role="status" tabIndex={-1}>
      <div><strong>{savedCount}개 장비와 프리셋 저장 완료</strong></div>
      <a href="#weapon-presets-heading">프리셋 확인 →</a>
    </div>}
    <p className="setup-import-privacy">이 브라우저에만 저장 · 이미지 외부 전송 없음</p>
  </section>;
}
