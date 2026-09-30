"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";

const GUIDE_IMAGE = "/guides/equipment-registration-v2.png";

function EquipmentGuideDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const backdropPointer = useRef(false);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    if (typeof node.showModal === "function") node.showModal();
    else node.setAttribute("open", "");
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      node.close?.();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const isBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return false;
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom;
  };

  return <dialog ref={dialog} id={id} className="equipment-guide-dialog" aria-labelledby={`${id}-heading`}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onPointerDown={event => { backdropPointer.current = isBackdrop(event); }}
    onClick={event => { if (backdropPointer.current && isBackdrop(event)) onClose(); }}
    onPaste={event => event.stopPropagation()}
    onDragOver={event => event.preventDefault()}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); }}>
    <div className="equipment-guide-heading">
      <h2 id={`${id}-heading`}>장비 등록 방법</h2>
      <div className="equipment-guide-actions">
        <a href={GUIDE_IMAGE} target="_blank" rel="noopener noreferrer">원본 보기 <span aria-hidden="true">↗</span></a>
        <button ref={closeButton} type="button" className="secondary-button" onClick={onClose} aria-label="장비 등록 방법 닫기">닫기 <span aria-hidden="true">×</span></button>
      </div>
    </div>
    <div className="equipment-guide-content" role="region" aria-label="장비 등록 안내 이미지" tabIndex={0}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={GUIDE_IMAGE} width={1095} height={1437} decoding="async"
        alt="PrtSc 파일 선택과 Win + Shift + S 영역 캡처를 이용한 장비 등록 안내" />
      <div className="equipment-guide-text">
        <h3>방법 1. PrtSc로 사진 선택</h3>
        <ol>
          <li>아이템에 커서를 올리고 PrtSc를 누릅니다. 설명창의 마지막 옵션까지 보이게 촬영합니다.</li>
          <li>계산기에서 스크린샷으로 장비 등록 버튼을 누릅니다.</li>
          <li>사진, MapleStory Worlds 폴더에서 방금 찍은 장비 사진을 선택하고 열기를 누릅니다. 여러 장은 Ctrl을 누른 채 선택합니다.</li>
        </ol>
        <h3>방법 2. 영역 캡처 후 붙여넣기</h3>
        <ol>
          <li>아이템에 커서를 올립니다.</li>
          <li>Win + Shift + S를 누르고 설명창 전체를 드래그해 캡처합니다.</li>
          <li>이 안내를 닫고 계산기 상단 장비 등록 영역에서 Ctrl + V로 붙여넣습니다.</li>
        </ol>
        <p>사진을 선택하거나 붙여넣으면 장비 인식이 시작됩니다.</p>
      </div>
    </div>
  </dialog>;
}

export function EquipmentHowToUse() {
  const [open, setOpen] = useState(false);
  const id = useId();

  return <>
    <button type="button" className="secondary-button equipment-guide-trigger" aria-haspopup="dialog"
      aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(true)}>
      <span aria-hidden="true">?</span> How to use
    </button>
    {open && <EquipmentGuideDialog id={id} onClose={() => setOpen(false)} />}
  </>;
}
