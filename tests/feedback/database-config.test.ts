// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it.each([undefined, "file:reports.sqlite", "http://remote.example", "https://remote.example"])("requires a durable authenticated remote store on Vercel: %s", async (url) => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("FEEDBACK_DATABASE_URL", url);
  vi.stubEnv("FEEDBACK_DATABASE_TOKEN", "");
  const { getFeedbackDatabase } = await import("@/features/feedback/server/database");
  await expect(getFeedbackDatabase()).rejects.toMatchObject({ status: 503 });
});

it("ignores client-supplied proxy headers in local Node and trusts only the identified Vercel runtime", async () => {
  const { getFeedbackClientAddress } = await import("@/features/feedback/server/database");
  const request = new Request("http://localhost/", { headers: { "x-forwarded-for": "203.0.113.1", "cf-ray": "forged", "cf-connecting-ip": "203.0.113.2" } });
  vi.stubEnv("VERCEL", "");
  expect(getFeedbackClientAddress(request)).toBe("local");
  vi.stubEnv("VERCEL", "1");
  expect(getFeedbackClientAddress(request)).toBe("203.0.113.1");
});
