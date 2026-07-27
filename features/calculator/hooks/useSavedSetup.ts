"use client";

import { useCallback } from "react";
import type { CalculatorInput } from "../domain/types";
import { deserializeSetup, serializeSetup, STORAGE_KEY } from "../storage";

export function useSavedSetup() {
  const load = useCallback(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? { ok: false as const, message: "empty" as const } : deserializeSetup(raw);
  }, []);

  const save = useCallback((input: CalculatorInput) => {
    window.localStorage.setItem(STORAGE_KEY, serializeSetup(input));
  }, []);

  const clear = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { load, save, clear };
}
