// @vitest-environment node
import { createClient, type Client } from "@libsql/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SCHEMA, type FeedbackDatabase } from "@/features/feedback/server/sql";
import { FeedbackStore } from "@/features/feedback/server/store";
import { ADMIN_COOKIE, createSession, isAdmin, passwordMatches } from "@/features/feedback/server/security";
import { GET, POST } from "@/app/api/feedback/route";
import { PATCH, DELETE } from "@/app/api/feedback/[id]/route";
import { GET as sessionGET, POST as login, DELETE as logout } from "@/app/api/feedback/session/route";
import { MAX_BODY_BYTES, readJson, validateInput } from "@/features/feedback/server/validation";
import type { FeedbackInput } from "@/features/feedback/types";

let database: FeedbackDatabase;
let client: Client;
const password = "test-only-administrator-password-12345";
vi.mock("@/features/feedback/server/database", () => ({ getFeedbackDatabase: () => Promise.resolve(database), getFeedbackClientAddress: () => "local" }));

beforeEach(async () => {
  vi.stubEnv("FEEDBACK_ADMIN_PASSWORD", password);
  client = createClient({ url: ":memory:" });
  database = {
    execute: async (statement) => {
      const result = await client.execute(statement);
      return { rows: result.rows as unknown as Record<string, unknown>[], rowsAffected: result.rowsAffected };
    },
    batch: async (statements) => (await client.batch(statements, "write")).map((result) => ({ rows: result.rows as unknown as Record<string, unknown>[], rowsAffected: result.rowsAffected })),
  };
  await database.batch(SCHEMA);
});
afterEach(() => { client.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function input(overrides: Partial<FeedbackInput> = {}): FeedbackInput {
  return { id: crypto.randomUUID(), title: "장갑 공격력 누락", category: "recognition", description: "장갑 사진을 등록하면 공격력 12가 빈칸으로 표시됩니다.", environment: "PC / Chrome", ...overrides };
}
function request(method: string, body?: unknown, cookie?: string, path = "/api/feedback") {
  return new Request(`http://localhost:3000${path}`, { method, headers: { Origin: "http://localhost:3000", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function adminCookie() { return `${ADMIN_COOKIE}=${await createSession()}`; }

describe("private anonymous reports", () => {
  it("accepts anonymously, returns only a receipt, and keeps contents behind authentication", async () => {
    const draft = input();
    const response = await POST(request("POST", draft));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: draft.id });
    const anonymous = await GET(request("GET"));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.text()).not.toContain(draft.title);
    const authorized = await GET(request("GET", undefined, await adminCookie()));
    expect(authorized.headers.get("cache-control")).toContain("no-store");
    expect(authorized.headers.get("vary")).toBe("Cookie");
    expect((await authorized.json()).reports[0]).toMatchObject({ ...draft, status: "received" });
  });
  it("rejects anonymous mutation and cross-origin submission, login, and deletion", async () => {
    const draft = input();
    const context = { params: Promise.resolve({ id: draft.id }) };
    expect((await PATCH(request("PATCH", {}), context)).status).toBe(401);
    expect((await DELETE(request("DELETE", {}), context)).status).toBe(401);
    for (const action of [POST, login]) {
      const foreign = request("POST", draft); foreign.headers.set("origin", "https://foreign.example");
      expect((await action(foreign)).status).toBe(403);
    }
    const foreignDelete = request("DELETE", {}, await adminCookie()); foreignDelete.headers.set("origin", "https://foreign.example");
    expect((await DELETE(foreignDelete, context)).status).toBe(403);
  });
  it("stores status and notes, rejects stale edits/deletes, and supports authorized deletion", async () => {
    const draft = input(); const cookie = await adminCookie();
    await POST(request("POST", draft));
    const before = (await (await GET(request("GET", undefined, cookie))).json()).reports[0];
    const context = { params: Promise.resolve({ id: draft.id }) };
    const update = { status: "resolved", adminNote: "누락 영역을 다시 인식하도록 수정함", updatedAt: before.updatedAt };
    const saved = await PATCH(request("PATCH", update, cookie), context);
    expect(saved.status).toBe(200);
    const after = (await saved.json()).report;
    expect(after).toMatchObject({ status: "resolved", adminNote: update.adminNote });
    expect(after.updatedAt).not.toBe(before.updatedAt);
    expect((await PATCH(request("PATCH", update, cookie), context)).status).toBe(409);
    expect((await DELETE(request("DELETE", { updatedAt: before.updatedAt }, cookie), context)).status).toBe(409);
    expect((await DELETE(request("DELETE", { updatedAt: after.updatedAt }, cookie), context)).status).toBe(200);
    expect((await (await GET(request("GET", undefined, cookie))).json()).reports).toEqual([]);
  });
  it("does not disclose database error messages, credentials, or partial success", async () => {
    vi.spyOn(database, "batch").mockRejectedValue(new Error("secret-token private-report raw-driver-url"));
    const response = await POST(request("POST", input()));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret-token|private-report|raw-driver-url/);
  });
  it("fails closed when the operator password is missing", async () => {
    vi.stubEnv("FEEDBACK_ADMIN_PASSWORD", "");
    expect((await POST(request("POST", input()))).status).toBe(503);
    expect((await GET(request("GET"))).status).toBe(401);
  });
});

describe("storage admission and recovery", () => {
  it("handles a lost acknowledgement without duplicate insertion or quota consumption", async () => {
    const store = new FeedbackStore(database); const draft = input();
    await store.create(draft, "user-a");
    for (let index = 0; index < 8; index++) expect(await store.create(draft, "user-a")).toEqual({ id: draft.id });
    expect((await store.list(new URLSearchParams())).reports).toHaveLength(1);
    for (let index = 0; index < 4; index++) await store.create(input(), "user-a");
    await expect(store.create(input(), "user-a")).rejects.toMatchObject({ status: 429 });
  });
  it("enforces persisted quotas across separate store instances and resets expired windows", async () => {
    const first = new FeedbackStore(database); const second = new FeedbackStore(database);
    const now = 1_790_000_000_000;
    for (let index = 0; index < 5; index++) await (index % 2 ? first : second).create(input(), "shared", now);
    await expect(second.create(input(), "shared", now)).rejects.toMatchObject({ status: 429 });
    await first.create(input(), "shared", now + 600_000);
    expect((await first.list(new URLSearchParams())).reports).toHaveLength(6);
  });
  it("admits at most five concurrent posts without partial writes", async () => {
    const store = new FeedbackStore(database);
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => store.create(input(), "simultaneous")));
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(5);
    expect(attempts.filter((attempt) => attempt.status === "rejected").every((attempt) => attempt.reason.status === 429)).toBe(true);
    expect((await store.list(new URLSearchParams())).reports).toHaveLength(5);
  });
  it("caps global intake as well as per-client requests", async () => {
    const store = new FeedbackStore(database); const now = Date.now();
    for (let index = 0; index < 100; index++) await store.create(input(), `client-${index}`, now);
    await expect(store.create(input(), "new-client", now)).rejects.toMatchObject({ status: 429 });
    const count = await database.execute({ sql: "SELECT count(*) AS total FROM feedback_reports" });
    expect(Number(count.rows[0].total)).toBe(100);
  });
  it("uses stable cursor pagination and bound literal search for hostile input", async () => {
    const store = new FeedbackStore(database);
    for (let index = 0; index < 25; index++) await store.create(input({ title: `순서 확인 제보 ${index}` }), `client-${index}`);
    const first = await store.list(new URLSearchParams());
    expect(first.reports).toHaveLength(20);
    const second = await store.list(new URLSearchParams({ cursor: String(first.nextCursor) }));
    expect(second.reports).toHaveLength(5); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.reports, ...second.reports].map((report) => report.id)).size).toBe(25);
    const hostile = input({ title: "<script>alert(1)</script>", description: "SELECT 'x'; DROP TABLE feedback_reports; --" });
    await store.create(hostile, "hostile");
    expect((await store.list(new URLSearchParams({ search: "DROP TABLE" }))).reports[0].description).toBe(hostile.description);
    expect((await store.list(new URLSearchParams({ search: "' OR 1=1 --" }))).reports).toEqual([]);
    await expect(store.list(new URLSearchParams({ cursor: "NaN" }))).rejects.toMatchObject({ status: 400 });
  });
});

describe("operator sessions and validation", () => {
  it("rejects wrong passwords, signs HttpOnly sessions, and clears the cookie on logout", async () => {
    expect((await login(request("POST", { password: "wrong" }))).status).toBe(401);
    expect(await passwordMatches(password)).toBe(true);
    const response = await login(request("POST", { password }));
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(password);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Strict");
    expect(await (await sessionGET(request("GET", undefined, cookie))).json()).toEqual({ authenticated: true });
    expect((await logout(request("DELETE", undefined, cookie))).headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("rejects forged and expired cookies and invalidates sessions on password rotation", async () => {
    const cookie = await adminCookie();
    expect(await isAdmin(request("GET", undefined, cookie))).toBe(true);
    expect(await isAdmin(request("GET", undefined, `${cookie.slice(0, -1)}${cookie.endsWith("0") ? "1" : "0"}`))).toBe(false);
    expect(await isAdmin(request("GET", undefined, `${ADMIN_COOKIE}=${await createSession(Date.now() - 13 * 3_600_000)}`))).toBe(false);
    vi.stubEnv("FEEDBACK_ADMIN_PASSWORD", "rotated-test-admin-secret-at-least-24-chars");
    expect(await isAdmin(request("GET", undefined, cookie))).toBe(false);
  });
  it("rate limits password guessing in the shared database", async () => {
    for (let index = 0; index < 8; index++) expect((await login(request("POST", { password: "wrong" }))).status).toBe(401);
    const blocked = await login(request("POST", { password }));
    expect(blocked.status).toBe(429); expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });
  it("rejects unknown categories, controls, non-JSON, malformed JSON, and oversized streams", async () => {
    expect(() => validateInput(input({ title: "bad\u0000title" }))).toThrow();
    expect(() => validateInput({ ...input(), category: "__proto__" })).toThrow();
    expect(() => validateInput(input({ description: "短" }))).toThrow();
    expect((await POST(new Request("http://localhost:3000/api/feedback", { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "text/plain" }, body: "no" }))).status).toBe(415);
    await expect(readJson(new Request("http://localhost/", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).rejects.toMatchObject({ status: 400 });
    await expect(readJson(request("POST", { text: "x".repeat(MAX_BODY_BYTES) }))).rejects.toMatchObject({ status: 413 });
  });
});
