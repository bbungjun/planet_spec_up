"use client";

import { useCallback } from "react";
import type { CalculatorInput } from "../domain/types";
import { DEFAULT_CALCULATOR_RUNTIME, type CalculatorRuntime } from "../runtime";

/** React only provides stable browser operations; page policy belongs to the runtime. */
export function useSavedSetup(runtime: CalculatorRuntime = DEFAULT_CALCULATOR_RUNTIME) {
  const load = useCallback(() => runtime.load(window.localStorage), [runtime]);
  const save = useCallback((input: CalculatorInput) => runtime.save(window.localStorage, input), [runtime]);
  const clear = useCallback(() => runtime.clear(window.localStorage), [runtime]);
  return { load, save, clear };
}
