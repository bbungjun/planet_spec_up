import { useEffect, useRef } from "react";
import type { InputMode } from "../domain/types";
import { ThemeToggle } from "./ThemeToggle";
import { GameIcon } from "./GameVisuals";

type AppHeaderProps = {
  captainBeta?: boolean;
  aranBeta?: boolean;
  inputMode: InputMode;
  savedAt: string | null;
  storageError: string | null;
  onToggleMode: () => void;
  onSave: () => void;
  onLoad: () => void;
  onReset: () => void;
};

export function AppHeader({
  captainBeta = false,
  aranBeta = false,
  inputMode,
  savedAt,
  storageError,
  onToggleMode,
  onSave,
  onLoad,
  onReset,
}: AppHeaderProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const root = document.documentElement;
    const previousHeight = root.style.getPropertyValue("--app-toolbar-height");
    // Wrapped controls and storage messages can change the sticky bar's height.
    const updateHeight = () => {
      const height = Math.ceil(toolbar.getBoundingClientRect().height);
      if (height > 0) root.style.setProperty("--app-toolbar-height", `${height}px`);
    };
    updateHeight();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateHeight);
    observer?.observe(toolbar);
    window.addEventListener("resize", updateHeight);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateHeight);
      if (previousHeight) root.style.setProperty("--app-toolbar-height", previousHeight);
      else root.style.removeProperty("--app-toolbar-height");
    };
  }, []);

  return (
    <>
      <header className="app-header" id="page-top">
        <div className="app-topbar">
          <a className="app-brand" href="#page-top" aria-label="플래닛 계산기 처음으로">
            <span className="brand-symbol"><GameIcon name="leaf" /></span>
            <span>플래닛<span className={`brand-secondary${captainBeta || aranBeta ? " beta-release-label" : ""}`}>{aranBeta ? "아란 참고 베타" : captainBeta ? "캡틴 전용 베타" : "EQUIPMENT LAB"}</span></span>
            <span className="beta-badge">BETA</span>
          </a>
          <ThemeToggle />
          {(captainBeta || aranBeta) && <nav aria-label="공개 직업 계산기"><a href={aranBeta ? "/" : "/aran"}>{aranBeta ? "캡틴 계산기" : "아란 계산기"}</a></nav>}
        </div>
      </header>
      <div className="app-toolbar" ref={toolbarRef}>
        <nav className="app-nav" aria-label="계산기 바로가기">
          <a href="#setup-import-heading">스크린샷 등록</a>
          <a href="#guild-skills-heading">길드 스킬</a>
          <a href="#weapon-presets-heading">무기 프리셋</a>
          <a href="#equipment-workspace">장비 계산</a>
          <a href="#stat-simulator">수동 비교</a>
          <a href="#candidate-comparison">후보 비교</a>
          <a href="/feedback" target="_blank" rel="noopener noreferrer" aria-label="오류 제보 (새 탭)">오류 제보</a>
        </nav>
        <div className="app-header-actions">
          {storageError === null ? (
            <p role="status" aria-label="저장 상태">
              {savedAt === null ? (
                "저장된 세팅 없음"
              ) : (
                <>저장됨 <time dateTime={savedAt}>{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(savedAt))}</time></>
              )}
            </p>
          ) : (
            <p role="alert">{storageError}</p>
          )}
          <button
            type="button"
            className="secondary-button"
            aria-pressed={inputMode === "bulk"}
            onClick={onToggleMode}
          >
            {inputMode === "cards" ? "일괄 입력 보기" : "카드 입력 보기"}
          </button>
          <button type="button" className="secondary-button" onClick={onLoad}>
            불러오기
          </button>
          <button type="button" className="secondary-button save-button" onClick={onSave}>
            저장
          </button>
          <button type="button" className="secondary-button" onClick={onReset}>
            초기화
          </button>
        </div>
      </div>
    </>
  );
}
