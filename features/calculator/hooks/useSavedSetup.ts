"use client";

import { useCallback } from "react";
import type { CalculatorInput } from "../domain/types";
import { CAPTAIN_BETA_STORAGE_KEY, deserializeSetup, serializeSetup, STORAGE_KEY } from "../storage";

export function useSavedSetup(captainBeta = false) {
  const key = captainBeta ? CAPTAIN_BETA_STORAGE_KEY : STORAGE_KEY;
  const load = useCallback(() => {
    const current = window.localStorage.getItem(key);
    // An explicit reset must not resurrect the untouched legacy setup.
    if (captainBeta && current === "null") return { ok: false as const, message: "empty" };
    const raw = current ?? (captainBeta ? window.localStorage.getItem(STORAGE_KEY) : null);
    if (raw === null) return { ok: false as const, message: "empty" };
    const saved = deserializeSetup(raw);
    if (saved.ok && captainBeta && saved.value.input.character.job !== "corsair")
      return { ok: false as const, message: "unsupported-job" };
    return saved;
  }, [captainBeta, key]);

  const save = useCallback((input: CalculatorInput) => {
    if (captainBeta && input.character.job !== "corsair") throw new Error("Captain beta only");
    const savedAt = new Date().toISOString();
    window.localStorage.setItem(key, serializeSetup(input, savedAt));
    return savedAt;
  }, [captainBeta, key]);

  const clear = useCallback(() => {
    if (captainBeta) window.localStorage.setItem(key, "null");
    else window.localStorage.removeItem(key);
  }, [captainBeta, key]);

  return { load, save, clear };
}
