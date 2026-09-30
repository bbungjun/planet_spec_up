import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readDevelopmentDefault } from "@/features/calculator/developmentDefault.server";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { createCalculatorRuntime } from "@/features/calculator/runtime";
import { useSavedSetup } from "@/features/calculator/hooks/useSavedSetup";
import { CAPTAIN_BETA_STORAGE_KEY, DEVELOPMENT_STORAGE_KEY, STORAGE_KEY, serializeSetup } from "@/features/calculator/storage";

const input = createDefaultInput("corsair");
input.equipment.weapon!.attackFlat = "87";
const seed = serializeSetup(input);

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("PLANET_LOCAL_DEFAULT_SETUP", seed);
});
afterEach(() => vi.unstubAllEnvs());

it("reads a valid local default and ignores missing or invalid configuration", async () => {
  expect(await readDevelopmentDefault()).toBe(seed);
  vi.stubEnv("PLANET_LOCAL_DEFAULT_SETUP", "{bad");
  expect(await readDevelopmentDefault()).toBeNull();
  vi.stubEnv("PLANET_LOCAL_DEFAULT_SETUP", undefined);
  expect(await readDevelopmentDefault()).toBeNull();
});

it.each(["production", "test"])("ignores even an injected personal fixture in %s mode", async mode => {
  vi.stubEnv("NODE_ENV", mode);
  expect(await readDevelopmentDefault()).toBeNull();
});

it("ignores a personal fixture on Vercel even with development mode", async () => {
  vi.stubEnv("VERCEL", "1");
  expect(await readDevelopmentDefault()).toBeNull();
});

it("uses the personal default only in an empty browser, preserving saved overrides and corrupt data", () => {
  const { result } = renderHook(() => useSavedSetup(createCalculatorRuntime("captain", seed)));
  expect(result.current.load()).toMatchObject({ ok: true, value: { input } });
  expect(localStorage.getItem(CAPTAIN_BETA_STORAGE_KEY)).toBeNull();
  const changed = createDefaultInput("corsair");
  changed.equipment.weapon!.attackFlat = "99";
  result.current.save(changed);
  expect(result.current.load()).toMatchObject({ ok: true, value: { input: changed } });
  localStorage.setItem(CAPTAIN_BETA_STORAGE_KEY, "{bad");
  expect(result.current.load().ok).toBe(false);
  expect(localStorage.getItem(CAPTAIN_BETA_STORAGE_KEY)).toBe("{bad");
});

it("keeps existing legacy captain data ahead of the default", () => {
  const legacy = createDefaultInput("corsair");
  legacy.character.level = "150";
  localStorage.setItem(STORAGE_KEY, serializeSetup(legacy));
  const { result } = renderHook(() => useSavedSetup(createCalculatorRuntime("captain", seed)));
  expect(result.current.load()).toMatchObject({ ok: true, value: { input: legacy } });
});

it.each([true, false])("does not resurrect a cleared default (captain beta: %s)", captainBeta => {
  const { result } = renderHook(() => useSavedSetup(createCalculatorRuntime(captainBeta ? "captain" : "development", seed)));
  result.current.clear();
  expect(result.current.load()).toEqual({ ok: false, message: "empty" });
  expect(localStorage.getItem(captainBeta ? CAPTAIN_BETA_STORAGE_KEY : DEVELOPMENT_STORAGE_KEY)).toBe("null");
});

it("keeps an ordinary unseeded browser empty", () => {
  const { result } = renderHook(() => useSavedSetup(createCalculatorRuntime("captain")));
  expect(result.current.load()).toEqual({ ok: false, message: "empty" });
});
