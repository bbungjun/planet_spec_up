import { deserializeSetup } from "./storage";

/** Only local dev configuration injects the ignored personal fixture. */
export function readDevelopmentDefault(): string | null {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL) return null;
  const raw = process.env.PLANET_LOCAL_DEFAULT_SETUP;
  return raw && deserializeSetup(raw).ok ? raw : null;
}
