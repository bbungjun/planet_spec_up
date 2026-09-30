"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import type { OcrBounds } from "../ocr/types";

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
