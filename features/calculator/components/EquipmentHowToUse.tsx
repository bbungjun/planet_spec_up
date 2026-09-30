"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";

const GUIDES = {
  registration: {
    title: "장비 등록 방법",
    buttonLabel: "장비 등록 하는법",
    image: "/guides/equipment-registration-v2.png",
    width: 1095,
    height: 1437,
    alt: "PrtSc 파일 선택과 Win + Shift + S 영역 캡처를 이용한 장비 등록 안내",
  },
  comparison: {
    title: "장비 비교 방법",
    buttonLabel: "장비 비교 하는법",
    image: "/guides/equipment-comparison-v2.png",
    width: 916,
    height: 1717,
    alt: "비교 대상 추가, 경매장 매물 영역 캡처, Ctrl + V로 붙여넣기, 원본 옵션 확인 후 후보로 비교하는 방법",
  },
} as const;

type GuideKind = keyof typeof GUIDES;

function EquipmentGuideDialog({ id, kind, onClose }: { id: string; kind: GuideKind; onClose: () => void }) {
  const guide = GUIDES[kind];
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
      <h2 id={`${id}-heading`}>{guide.title}</h2>
      <div className="equipment-guide-actions">
        <a href={guide.image} target="_blank" rel="noopener noreferrer">원본 보기 <span aria-hidden="true">↗</span></a>
        <button ref={closeButton} type="button" className="secondary-button" onClick={onClose} aria-label={`${guide.title} 닫기`}>닫기 <span aria-hidden="true">×</span></button>
      </div>
    </div>
    <div className="equipment-guide-content" role="region" aria-label={`${guide.title} 안내 이미지`} tabIndex={0}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={guide.image} width={guide.width} height={guide.height} decoding="async" alt={guide.alt} />
      {kind === "registration" && <p className="equipment-guide-storage-note">사진은 새로고침·종료 시 사라집니다. 저장한 옵션·설정만 이 브라우저에 남습니다.</p>}
      <div className="equipment-guide-text">
        {kind === "comparison" ? <>
          <h3>장비 비교 순서</h3>
          <ol>
            <li>이 안내를 닫고 장비 비교 영역의 비교 대상 추가를 누릅니다.</li>
            <li>경매장 매물에 커서를 올리고 Win + Shift + S를 누릅니다. 마지막 옵션까지 화면에 보이게 한 뒤 아이템 설명창의 테두리 전체를 선택해 캡처합니다.</li>
            <li>사진 등록 창에서 복사한 장비 이미지를 Ctrl + V로 붙여넣습니다. 가격 대비 효율을 보려면 구매 가격을 억 메소 단위로 입력합니다.</li>
            <li>인식값과 원본 옵션을 확인하고 원본의 모든 옵션을 확인했습니다에 체크한 뒤 후보로 비교를 누릅니다.</li>
            <li>현재 장비와 후보의 최대 스탯공·환산공 상승률, 구매 가격과 가격 대비 효율을 비교합니다.</li>
          </ol>
          <p>결과 수치는 예시입니다. 후보를 추가해도 현재 장비는 바뀌지 않습니다.</p>
        </> : <>
        <h3>방법 1. PrtSc로 사진 선택</h3>
        <ol>
          <li>아이템에 커서를 올리고 PrtSc를 누릅니다. 설명창의 마지막 옵션까지 보이게 촬영합니다.</li>
          <li>계산기에서 스크린샷으로 장비 등록 버튼을 누릅니다.</li>
          <li>사진, MapleStory Worlds 폴더에서 방금 찍은 장비 사진을 선택하고 열기를 누릅니다. 여러 장은 Ctrl을 누른 채 선택합니다.</li>
        </ol>
        <h3>방법 2. 영역 캡처 후 붙여넣기</h3>
        <ol>
          <li>아이템에 커서를 올립니다.</li>
          <li>Win + Shift + S를 누르고 마지막 옵션까지 가림 없이 보이는 설명창 전체를 드래그해 캡처합니다.</li>
          <li>이 안내를 닫고 계산기 상단 장비 등록 영역에서 Ctrl + V로 붙여넣습니다.</li>
        </ol>
        <p>여러 사진을 장비 등록 영역에 끌어놓아도 됩니다. 사진을 선택하거나 붙여넣으면 장비 인식이 시작됩니다.</p>
        </>}
      </div>
    </div>
  </dialog>;
}

export function EquipmentHowToUse({ kind = "registration" }: { kind?: GuideKind }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return <>
    <button type="button" className="equipment-guide-trigger" aria-haspopup="dialog"
      aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(true)}>
      <span className="equipment-guide-number" aria-hidden="true">{kind === "registration" ? "1" : "2"}</span>
      <span className="equipment-guide-label">{GUIDES[kind].buttonLabel}</span>
    </button>
    {open && <EquipmentGuideDialog id={id} kind={kind} onClose={() => setOpen(false)} />}
  </>;
}
