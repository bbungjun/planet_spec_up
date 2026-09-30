import { useEffect, useRef } from "react";

export function SaveConfirmationDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    if (typeof node.showModal === "function") node.showModal();
    else node.setAttribute("open", "");
    document.body.style.overflow = "hidden";
    confirmButton.current?.focus();
    return () => {
      node.close?.();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return <dialog ref={dialog} className="save-confirmation-dialog" aria-labelledby="save-confirmation-heading"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <span className="save-confirmation-mark" aria-hidden="true">✓</span>
    <h2 id="save-confirmation-heading">저장되었습니다</h2>
    <button ref={confirmButton} type="button" className="secondary-button" onClick={onClose}>확인</button>
  </dialog>;
}
