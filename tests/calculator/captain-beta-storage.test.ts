import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { useSavedSetup } from "@/features/calculator/hooks/useSavedSetup";
import { CAPTAIN_BETA_STORAGE_KEY, STORAGE_KEY, serializeSetup } from "@/features/calculator/storage";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("reads a legacy captain setup without writing or changing it", () => {
  const input = createDefaultInput("corsair"); input.character.pureMain = "800";
  const raw = serializeSetup(input); localStorage.setItem(STORAGE_KEY, raw);
  const { result } = renderHook(() => useSavedSetup(true));
  expect(result.current.load()).toMatchObject({ ok: true, value: { input: { character: { job: "corsair", pureMain: "800" } } } });
  expect(localStorage.getItem(CAPTAIN_BETA_STORAGE_KEY)).toBeNull();
  expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
});

it.each(["marksman", "night_lord"] as const)("preserves legacy %s through beta save, load and reset", job => {
  const original = serializeSetup(createDefaultInput(job)); localStorage.setItem(STORAGE_KEY, original);
  const { result } = renderHook(() => useSavedSetup(true));
  expect(result.current.load()).toEqual({ ok: false, message: "unsupported-job" });
  const captain = createDefaultInput("corsair"); captain.character.level = "199";
  act(() => { result.current.save(captain); });
  expect(result.current.load()).toMatchObject({ ok: true, value: { input: { character: { job: "corsair", level: "199" } } } });
  act(() => result.current.clear());
  expect(result.current.load()).toEqual({ ok: false, message: "empty" });
  expect(localStorage.getItem(STORAGE_KEY)).toBe(original);
});

it("does not restore an old captain setup after an explicit beta reset or remount", () => {
  const raw = serializeSetup(createDefaultInput("corsair")); localStorage.setItem(STORAGE_KEY, raw);
  const hook = renderHook(() => useSavedSetup(true)); act(() => hook.result.current.clear()); hook.unmount();
  const { result } = renderHook(() => useSavedSetup(true));
  expect(result.current.load()).toEqual({ ok: false, message: "empty" });
  expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
});

it("preserves both stored records on write or reset failure and refuses another job", () => {
  const original = serializeSetup(createDefaultInput("night_lord")); localStorage.setItem(STORAGE_KEY, original);
  const beta = serializeSetup(createDefaultInput("corsair")); localStorage.setItem(CAPTAIN_BETA_STORAGE_KEY, beta);
  const { result } = renderHook(() => useSavedSetup(true));
  expect(() => result.current.save(createDefaultInput("marksman"))).toThrow();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  expect(() => result.current.save(createDefaultInput("corsair"))).toThrow("quota");
  expect(() => result.current.clear()).toThrow("quota");
  expect(localStorage.getItem(STORAGE_KEY)).toBe(original);
  expect(localStorage.getItem(CAPTAIN_BETA_STORAGE_KEY)).toBe(beta);
});

it("does not silently replace corrupt beta data with a legacy save", () => {
  localStorage.setItem(STORAGE_KEY, serializeSetup(createDefaultInput("corsair")));
  localStorage.setItem(CAPTAIN_BETA_STORAGE_KEY, "corrupt");
  const { result } = renderHook(() => useSavedSetup(true));
  expect(result.current.load().ok).toBe(false);
  expect(localStorage.getItem(CAPTAIN_BETA_STORAGE_KEY)).toBe("corrupt");
});
