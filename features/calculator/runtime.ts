import type { CalculatorInput, JobId } from "./domain/types";
import { ARAN_BETA_STORAGE_KEY, CAPTAIN_BETA_STORAGE_KEY, DEVELOPMENT_STORAGE_KEY, MARKSMAN_BETA_STORAGE_KEY, STORAGE_KEY, deserializeSetup, serializeSetup } from "./storage";

export type CalculatorMode = "captain" | "aran" | "marksman" | "development" | "sandbox";
const PUBLIC_ROUTES = { corsair: "/", aran: "/aran", marksman: "/marksman" } as const;
const PUBLIC_JOBS: readonly JobId[] = ["corsair", "aran", "marksman"];
const ALL_JOBS: readonly JobId[] = [...PUBLIC_JOBS, "night_lord"];
const MODES = {
  captain: { job: "corsair", key: CAPTAIN_BETA_STORAGE_KEY, error: "unsupported-job", brand: null },
  aran: { job: "aran", key: ARAN_BETA_STORAGE_KEY, error: "unsupported-aran-job", brand: "아란 참고 베타" },
  marksman: { job: "marksman", key: MARKSMAN_BETA_STORAGE_KEY, error: "unsupported-marksman-job", brand: "신궁 베타" },
  development: { job: "corsair", key: DEVELOPMENT_STORAGE_KEY, error: null, brand: "EQUIPMENT LAB" },
  sandbox: { job: "corsair", key: STORAGE_KEY, error: null, brand: "EQUIPMENT LAB" },
} as const;
type SetupStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** One page context owns job selection, navigation, and the existing storage semantics.
 * Storage is supplied by the browser hook; serialization and calculation JobRules stay separate.
 */
export function createCalculatorRuntime(mode: CalculatorMode = "sandbox", developmentDefault: string | null = null) {
  const config = MODES[mode];
  const isPublic = config.error !== null;
  const seed = mode === "marksman" ? null : developmentDefault;
  return {
    initialJob: config.job,
    development: mode === "development",
    brand: config.brand,
    publicSelection: isPublic,
    jobs: isPublic ? PUBLIC_JOBS : ALL_JOBS,
    destination(job: JobId): string | null {
      return isPublic && job !== "night_lord" ? PUBLIC_ROUTES[job] : null;
    },
    load(storage: SetupStorage) {
      const current = storage.getItem(config.key);
      if (current === "null") return { ok: false as const, message: "empty" };
      const raw = current ?? (mode === "captain" ? storage.getItem(STORAGE_KEY) : null) ?? seed;
      if (raw === null) return { ok: false as const, message: "empty" };
      const saved = deserializeSetup(raw);
      if (saved.ok && isPublic && saved.value.input.character.job !== config.job)
        return { ok: false as const, message: config.error };
      return saved;
    },
    save(storage: SetupStorage, input: CalculatorInput) {
      if (isPublic && input.character.job !== config.job) throw new Error(`${mode} beta only`);
      const savedAt = new Date().toISOString();
      storage.setItem(config.key, serializeSetup(input, savedAt));
      return savedAt;
    },
    clear(storage: SetupStorage) {
      if (mode === "captain" || mode === "marksman" || seed !== null) storage.setItem(config.key, "null");
      else storage.removeItem(config.key);
    },
  };
}
export type CalculatorRuntime = ReturnType<typeof createCalculatorRuntime>;
export const DEFAULT_CALCULATOR_RUNTIME = createCalculatorRuntime();
