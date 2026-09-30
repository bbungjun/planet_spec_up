"use client";

import { useCallback } from "react";
import type { CalculatorInput } from "../domain/types";
import { CAPTAIN_BETA_STORAGE_KEY, ARAN_BETA_STORAGE_KEY, deserializeSetup, serializeSetup, STORAGE_KEY, DEVELOPMENT_STORAGE_KEY } from "../storage";

export function useSavedSetup(captainBeta = false, development = false, aranBeta = false, developmentDefault: string | null = null) {
  const key = aranBeta ? ARAN_BETA_STORAGE_KEY : captainBeta ? CAPTAIN_BETA_STORAGE_KEY : development ? DEVELOPMENT_STORAGE_KEY : STORAGE_KEY;
  const load = useCallback(() => {
    const current = window.localStorage.getItem(key);
    // An explicit reset must not resurrect either the legacy setup or local defaults.
    if (current === "null") return { ok: false as const, message: "empty" };
    const raw = current ?? (captainBeta ? window.localStorage.getItem(STORAGE_KEY) : null) ?? developmentDefault;
    if (raw === null) return { ok: false as const, message: "empty" };
    const saved = deserializeSetup(raw);
    if (saved.ok && captainBeta && saved.value.input.character.job !== "corsair")
      return { ok: false as const, message: "unsupported-job" };
    if (saved.ok && aranBeta && saved.value.input.character.job !== "aran")
      return { ok: false as const, message: "unsupported-aran-job" };
    return saved;
  }, [captainBeta, aranBeta, key, developmentDefault]);

  const save = useCallback((input: CalculatorInput) => {
    if (captainBeta && input.character.job !== "corsair") throw new Error("Captain beta only");
    if (aranBeta && input.character.job !== "aran") throw new Error("Aran beta only");
    const savedAt = new Date().toISOString();
    window.localStorage.setItem(key, serializeSetup(input, savedAt));
    return savedAt;
  }, [captainBeta, aranBeta, key]);

  const clear = useCallback(() => {
    if (captainBeta || developmentDefault !== null) window.localStorage.setItem(key, "null");
    else window.localStorage.removeItem(key);
  }, [captainBeta, key, developmentDefault]);

  return { load, save, clear };
}
