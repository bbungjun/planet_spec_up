"use client";

/**
 * 첫 화면의 스크린샷 일괄 등록과 검토 후 적용·저장을 연결하는 진입 UI.
 * 사진은 임시 상태로 유지하고 진행 중 목록의 이탈 보호·저장 성공 안내를 상위 계산기와 공유한다.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { CalculatorInput } from "../domain/types";
import { getEquipmentSlotLabel, getVisibleEquipmentSlots } from "../domain/slots";
import { MAX_BATCH_BYTES, MAX_BATCH_FILES, type ApplyOcrBatch } from "../ocr/batch";
import { clipboardImages } from "../ocr/clipboard";
import { EquipmentOcrBatchPanel } from "./EquipmentOcrBatchPanel";
import { CharacterIcon, GameIcon } from "./GameVisuals";

type Props = {
  input: CalculatorInput;
  disabled: boolean;
  savedAt: string | null;
  onApplyAndSave: ApplyOcrBatch;
  onPendingChange?: (pending: boolean) => void;
  children: ReactNode;
};

/**
 * 입력 제한 안의 여러 파일을 목록으로 넘기고 검토한 배치의 적용·저장 성공 이후 사진 목록을 비운다.
 * 후보 비교 영역의 이미지 붙여넣기는 가로채지 않으며 일반 텍스트 붙여넣기는 기본 동작을 유지한다.
 */
export function SetupImportPanel({ input, disabled, onApplyAndSave, onPendingChange, children }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const successMessage = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<File[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    onPendingChange?.(files !== null);
    return () => onPendingChange?.(false);
  }, [files, onPendingChange]);

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

        <h1 id="setup-import-heading">나의 장비 작업실 <span aria-hidden="true">✦</span></h1>

      </div>
      <div className={`setup-import-dropzone${dragging ? " is-dragging" : ""}`}
        onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={event => { event.preventDefault(); setDragging(false); acceptFiles(Array.from(event.dataTransfer.files)); }}>
        <button type="button" className="setup-import-button" aria-label="장비 스크린샷 한 번에 선택" disabled={disabled || files !== null} onClick={() => fileInput.current?.click()}>
          <GameIcon name="upload" /> {files ? `${files.length}장 확인 중` : "스크린샷으로 장비 등록"}<kbd>Ctrl V</kbd>
        </button>
        <input ref={fileInput} className="equipment-ocr-file-input" type="file" multiple
          accept="image/png,image/jpeg,image/webp" aria-label="프리셋 등록 스크린샷" tabIndex={-1}
          disabled={disabled || files !== null} onChange={event => {
            acceptFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }} />
        <small>설명창 전체·마지막 옵션까지 가림 없이 · 여러 장 끌어놓기</small>
        <small className="setup-image-storage-note">사진은 새로고침·종료 시 사라집니다. 저장한 옵션·설정만 이 브라우저에 남습니다.</small>
      </div>
    </div>
    <div className="workshop-character-bar">
      <span className="workshop-character-icon"><CharacterIcon job={input.character.job} /></span>
      {children}
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
  </section>;
}
