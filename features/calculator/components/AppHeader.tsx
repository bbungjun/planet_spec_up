import { ThemeToggle } from "./ThemeToggle";
import { GameIcon } from "./GameVisuals";

type AppHeaderProps = {
  captainBeta?: boolean;
  aranBeta?: boolean;
  marksmanBeta?: boolean;
  onSave: () => void;
  onLoad: () => void;
  onReset: () => void;
};

export function AppHeader({
  captainBeta = false,
  aranBeta = false,
  marksmanBeta = false,
  onSave,
  onLoad,
  onReset,
}: AppHeaderProps) {
  return (
    <>
      <header className="app-header" id="page-top">
        <div className="app-topbar">
          <a className="app-brand" href="#page-top" aria-label="플래닛 계산기 처음으로">
            <span className="brand-symbol"><GameIcon name="leaf" /></span>
            <span>플래닛{!captainBeta && <span className={`brand-secondary${aranBeta || marksmanBeta ? " beta-release-label" : ""}`}>{aranBeta ? "아란 참고 베타" : marksmanBeta ? "신궁 베타" : "EQUIPMENT LAB"}</span>}</span>
            <span className="beta-badge">BETA</span>
          </a>
          <ThemeToggle />
        </div>
      </header>
      <div className="app-toolbar">
        <nav className="app-nav" aria-label="계산기 바로가기">
          <a href="#setup-import-heading">스크린샷 등록</a>
          <a href="#guild-skills-heading">길드 스킬</a>
          <a href="#weapon-presets-heading">무기 프리셋</a>
          <a href="#equipment-workspace">장비 계산</a>
          <a href="#stat-simulator">수동 비교</a>
          <a href="#candidate-comparison">장비 비교</a>
        </nav>
        <div className="app-header-actions">
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
