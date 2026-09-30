import type { InputMode } from "../domain/types";

const tabs = [
  { mode: "bulk", label: "전체장비 직접입력" },
  { mode: "cards", label: "장비별 입력" },
] as const;

export function EquipmentInputTabs({ mode, onChange }: { mode: InputMode; onChange: (mode: InputMode) => void }) {
  return <div className="equipment-input-tabs" role="tablist" aria-label="장비 입력 방식">
    {tabs.map((tab, index) => <button key={tab.mode} type="button" role="tab"
      id={`equipment-mode-${tab.mode}`} aria-selected={mode === tab.mode}
      aria-controls="equipment-editor-area" tabIndex={mode === tab.mode ? 0 : -1}
      onClick={() => onChange(tab.mode)}
      onKeyDown={event => {
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
          : event.key === "ArrowRight" ? (index + 1) % tabs.length
            : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : null;
        if (next === null) return;
        event.preventDefault();
        onChange(tabs[next].mode);
        document.getElementById(`equipment-mode-${tabs[next].mode}`)?.focus();
      }}>{tab.label}</button>)}
  </div>;
}
