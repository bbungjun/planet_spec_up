import { beforeEach, expect, it } from "vitest";
import { createCalculatorRuntime } from "@/features/calculator/runtime";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { ARAN_BETA_STORAGE_KEY, CAPTAIN_BETA_STORAGE_KEY, DEVELOPMENT_STORAGE_KEY, MARKSMAN_BETA_STORAGE_KEY, STORAGE_KEY, serializeSetup } from "@/features/calculator/storage";

beforeEach(() => localStorage.clear());
it.each([
  ["captain", "corsair", CAPTAIN_BETA_STORAGE_KEY, "/"], ["aran", "aran", ARAN_BETA_STORAGE_KEY, "/aran"], ["marksman", "marksman", MARKSMAN_BETA_STORAGE_KEY, "/marksman"],
] as const)("couples %s initial job, navigation and isolated key", (mode, job, key, route) => {
  const runtime = createCalculatorRuntime(mode);
  expect(runtime.initialJob).toBe(job); expect(runtime.jobs).not.toContain("night_lord");
  expect(runtime.destination(job)).toBe(route); expect(runtime.destination("night_lord")).toBeNull();
  runtime.save(localStorage, createDefaultInput(job));
  expect(localStorage.getItem(key)).not.toBeNull(); expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(() => runtime.save(localStorage, createDefaultInput("night_lord"))).toThrow();
});
it("keeps Marksman isolated from legacy and local seed, and reset cannot resurrect them", () => {
  const seed = serializeSetup(createDefaultInput("marksman")); localStorage.setItem(STORAGE_KEY, seed); localStorage.setItem(CAPTAIN_BETA_STORAGE_KEY, seed);
  const runtime = createCalculatorRuntime("marksman", seed);
  expect(runtime.load(localStorage)).toEqual({ ok: false, message: "empty" });
  runtime.save(localStorage, createDefaultInput("marksman")); runtime.clear(localStorage);
  expect(localStorage.getItem(MARKSMAN_BETA_STORAGE_KEY)).toBe("null");
  expect(createCalculatorRuntime("marksman", seed).load(localStorage)).toEqual({ ok: false, message: "empty" });
  expect(localStorage.getItem(STORAGE_KEY)).toBe(seed);
});
it("keeps development Night Lord access, seed and explicit-reset sentinel separate", () => {
  const seed = serializeSetup(createDefaultInput("night_lord")); const runtime = createCalculatorRuntime("development", seed);
  expect(runtime.jobs).toContain("night_lord"); expect(runtime.destination("aran")).toBeNull();
  expect(runtime.load(localStorage)).toMatchObject({ ok: true, value: { input: { character: { job: "night_lord" } } } });
  runtime.clear(localStorage); expect(localStorage.getItem(DEVELOPMENT_STORAGE_KEY)).toBe("null");
  expect(runtime.load(localStorage)).toEqual({ ok: false, message: "empty" });
});
it("keeps unseeded Aran removeItem semantics and wrong-job load rejection", () => {
  const runtime = createCalculatorRuntime("aran"); localStorage.setItem(ARAN_BETA_STORAGE_KEY, serializeSetup(createDefaultInput("corsair")));
  expect(runtime.load(localStorage)).toEqual({ ok: false, message: "unsupported-aran-job" });
  runtime.clear(localStorage); expect(localStorage.getItem(ARAN_BETA_STORAGE_KEY)).toBeNull();
});
