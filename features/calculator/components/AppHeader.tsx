type AppHeaderProps = {
  onReset: () => void;
};

export function AppHeader({ onReset }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div>
        <p className="app-eyebrow">PLANET LAB</p>
        <h1>플래닛 데미지 계산기</h1>
        <p className="app-subtitle">장비 입력 · 스탯 공격력 · 환산 공격력</p>
      </div>
      <div className="app-header-actions">
        <button type="button" className="secondary-button" onClick={onReset}>
          초기화
        </button>
      </div>
    </header>
  );
}
