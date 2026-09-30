"use client";

/**
 * 자동 탐지에 실패한 설명창의 영역을 드래그 또는 키보드 숫자로 지정하는 모달.
 * 이미지 표시 비율을 유지하며 선택값은 원본 폭·높이에 대한 상대 좌표로 인식기에 전달한다.
 */

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import type { OcrBounds } from "../ocr/types";

/**
 * 드래그 좌표를 실제 표시 이미지의 경계 기준 0~1로 환산하고 유효한 사각형만 다시 읽기에 전달한다.
 * 모달 종료 시 이전 포커스로 돌아가며 파일 미리보기 URL은 해제한다. 원본 이미지를 직접 수정하지 않는다.
 */
export function TooltipRegionSelector({ file, onSelect, onCancel }: { file: File; onSelect: (region: OcrBounds) => void; onCancel: () => void }) {
  const id = useId();
  const imageRef = useRef<HTMLImageElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [region, setRegion] = useState<OcrBounds>({ x: 0, y: 0, width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 600, height: 400 });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    }
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (!URL.createObjectURL) return;
    const next = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  // 화면에서 축소/확대된 이미지의 좌표를 정규화하므로 선택 영역은 표시 배율과 무관하게 원본에 대응한다.
  const point = (event: PointerEvent<HTMLElement>) => {
    const rect = imageRef.current?.getBoundingClientRect();
    return rect ? { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) } : null;
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const end = point(event), anchor = start.current;
    if (!end || !anchor) return;
    setRegion({ x: Math.min(anchor.x, end.x), y: Math.min(anchor.y, end.y), width: Math.abs(end.x - anchor.x), height: Math.abs(end.y - anchor.y) });
  };
  const valid = region.width > .01 && region.height > .01 && region.x + region.width <= 1.001 && region.y + region.height <= 1.001;
  return <dialog ref={dialogRef} className="ocr-region-selector" aria-label="장비 설명창 영역 선택" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <p>설명창의 이름부터 마지막 옵션까지 드래그해주세요. 사진에 설명창이 없으면 다른 사진을 선택하세요.</p>
    <div className="ocr-crop-stage"><div className="ocr-crop-surface" style={{ width: `min(100%, calc(min(55dvh, 520px) * ${imageSize.width / imageSize.height}))` }} onPointerDown={event => { const p = point(event); if (!p) return; event.preventDefault(); start.current = p; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={move} onPointerUp={event => { move(event); start.current = null; }} onPointerCancel={() => { start.current = null; }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img ref={imageRef} src={url} alt="영역을 선택할 원본" width={imageSize.width} height={imageSize.height} draggable={false} onLoad={event => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth > 0 && naturalHeight > 0) setImageSize({ width: naturalWidth, height: naturalHeight });
      }} />}
      <div className="ocr-crop-rectangle" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />
    </div></div>
    <details><summary>키보드로 영역 조정</summary><div className="equipment-ocr-proposal-grid">
      {([["x", "왼쪽 위치"], ["y", "위쪽 위치"], ["width", "영역 너비"], ["height", "영역 높이"]] as const).map(([key, label]) => <div className="field" key={key}>
        <label htmlFor={`${id}-${key}`}>{label} (%)</label><input id={`${id}-${key}`} name={`crop.${key}`} autoComplete="off" inputMode="decimal" type="number" min={0} max={100} step={.1} value={Math.round(region[key] * 1000) / 10}
          onChange={event => { const value = Math.max(0, Math.min(1, Number(event.currentTarget.value) / 100)); setRegion(current => ({ ...current, [key]: value })); }} />
      </div>)}
    </div></details>
    <div className="equipment-ocr-actions">
      <button type="button" className="equipment-ocr-apply" disabled={!valid} onClick={() => onSelect(region)}>선택 영역 다시 읽기</button>
      <button type="button" className="secondary-button" onClick={() => setRegion({ x: 0, y: 0, width: 1, height: 1 })}>전체 이미지 선택</button>
      <button type="button" className="secondary-button" onClick={onCancel}>영역 선택 취소</button>
    </div>
  </dialog>;
}
