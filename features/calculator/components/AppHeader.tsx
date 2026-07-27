import type { InputMode } from "../domain/types";

type AppHeaderProps = {
  inputMode: InputMode;
  savedAt: string | null;
  storageError: string | null;
  onToggleMode: () => void;
  onSave: () => void;
  onLoad: () => void;
  onReset: () => void;
};

export function AppHeader({
  inputMode,
  savedAt,
  storageError,
  onToggleMode,
  onSave,
  onLoad,
  onReset,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <div>
        <p className="app-eyebrow">PLANET LAB</p>
        <h1>플래닛 데미지 계산기</h1>
        <p className="app-subtitle">장비 입력 · 스탯 공격력 · 환산 공격력</p>
      </div>
      <div className="app-header-actions">
        {storageError === null ? (
          <p role="status" aria-label="저장 상태">
            {savedAt === null ? (
              "저장된 세팅 없음"
            ) : (
              <>마지막 저장: <time dateTime={savedAt}>{savedAt}</time></>
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
        <button type="button" className="secondary-button" onClick={onSave}>
          저장
        </button>
        <button type="button" className="secondary-button" onClick={onReset}>
          초기화
        </button>
      </div>
    </header>
  );
}
