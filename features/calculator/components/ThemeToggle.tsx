"use client";

import { useState, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY, type Theme } from "../theme";

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) {
      document.documentElement.dataset.theme = event.newValue === "dark" ? "dark" : "light";
      onChange();
    }
  };
  window.addEventListener("planet-theme-change", onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("planet-theme-change", onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe,
    () => document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    () => "light");
  const [storageUnavailable, setStorageUnavailable] = useState(false);

  const change = (next: Theme) => {
    document.documentElement.dataset.theme = next;
    window.dispatchEvent(new Event("planet-theme-change"));
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      setStorageUnavailable(false);
    } catch {
      setStorageUnavailable(true);
    }
  };

  return <div className="theme-control">
    <div className="theme-toggle" role="group" aria-label="화면 모드">
      <button type="button" aria-pressed={theme === "light"} onClick={() => change("light")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>
        기본 모드
      </button>
      <button type="button" aria-pressed={theme === "dark"} onClick={() => change("dark")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20.5 14A8.7 8.7 0 0 1 10 3.5 8.7 8.7 0 1 0 20.5 14Z"/></svg>
        다크 모드
      </button>
    </div>
    {storageUnavailable && <span role="status" className="theme-storage-note">모드는 적용됐지만 다음 방문을 위해 저장하지 못했어요.</span>}
  </div>;
}
