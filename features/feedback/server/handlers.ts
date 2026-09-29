import { FeedbackError } from "./errors";
import { adminPassword, clientRateKey, createSession, isAdmin, passwordMatches, requireAdmin, requireSameOrigin, sessionCookie } from "./security";
import { getFeedbackStore } from "./store";
import { readJson, validId, validateInput, validateUpdate } from "./validation";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Robots-Tag": "noindex, nofollow" };
function json(value: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return Response.json(value, { status, headers: { ...PRIVATE_HEADERS, ...extraHeaders } });
}
async function handle(action: () => Promise<Response>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof FeedbackError) return json({ error: error.message }, error.status, error.retryAfter ? { "Retry-After": String(error.retryAfter) } : undefined);
    // Never echo driver errors: they can contain credentials or submitted text.
    return json({ error: "요청을 완료하지 못했습니다. 입력을 유지한 채 다시 시도해 주세요." }, 503);
  }
}
export function listReports(request: Request) {
  return handle(async () => {
    await requireAdmin(request);
    return json(await (await getFeedbackStore()).list(new URL(request.url).searchParams));
  });
}
export function submitReport(request: Request) {
  return handle(async () => {
    requireSameOrigin(request);
    const payload = await readJson(request);
    if (payload && typeof payload === "object" && "website" in payload && payload.website) throw new FeedbackError(400, "입력 내용을 확인해 주세요.");
    const input = validateInput(payload);
    adminPassword();
    return json(await (await getFeedbackStore()).create(input, await clientRateKey(request)), 201);
  });
}
export function updateReport(request: Request, id: string) {
  return handle(async () => {
    requireSameOrigin(request);
    await requireAdmin(request);
    const input = validateUpdate(await readJson(request));
    return json({ report: await (await getFeedbackStore()).update(validId(id), input) });
  });
}
export function deleteReport(request: Request, id: string) {
  return handle(async () => {
    requireSameOrigin(request);
    await requireAdmin(request);
    const payload = await readJson(request);
    const updatedAt = payload && typeof payload === "object" && "updatedAt" in payload ? payload.updatedAt : null;
    if (typeof updatedAt !== "string" || updatedAt.length > 40) throw new FeedbackError(400, "제보를 다시 불러와 주세요.");
    await (await getFeedbackStore()).remove(validId(id), updatedAt);
    return json({ deleted: true });
  });
}
export function checkSession(request: Request) { return handle(async () => json({ authenticated: await isAdmin(request) })); }
export function login(request: Request) {
  return handle(async () => {
    requireSameOrigin(request);
    const payload = await readJson(request);
    const password = payload && typeof payload === "object" && "password" in payload ? payload.password : null;
    if (typeof password !== "string" || password.length > 256) throw new FeedbackError(400, "운영자 비밀번호를 입력해 주세요.");
    adminPassword();
    await (await getFeedbackStore()).consumeLoginQuota(await clientRateKey(request));
    if (!await passwordMatches(password)) throw new FeedbackError(401, "운영자 비밀번호가 올바르지 않습니다.");
    return json({ authenticated: true }, 200, { "Set-Cookie": sessionCookie(request, await createSession()) });
  });
}
export function logout(request: Request) {
  return handle(async () => {
    requireSameOrigin(request);
    return json({ authenticated: false }, 200, { "Set-Cookie": sessionCookie(request, "", 0) });
  });
}
