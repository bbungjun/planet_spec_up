import { FeedbackError } from "./errors";
import { getFeedbackClientAddress } from "@/features/feedback/server/database";

export const ADMIN_COOKIE = "planet_feedback_admin";
export const SESSION_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

export function adminPassword(): string {
  const password = process.env.FEEDBACK_ADMIN_PASSWORD;
  if (!password || password.length < 24 || password.length > 256) throw new FeedbackError(503, "운영자 접근 설정을 확인해 주세요.");
  return password;
}

async function signingKey() {
  return crypto.subtle.importKey("raw", encoder.encode(adminPassword()), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function hex(value: ArrayBuffer) {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function passwordMatches(candidate: string) {
  const key = await signingKey();
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`password:${adminPassword()}`));
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(`password:${candidate}`));
}

export async function createSession(now = Date.now()) {
  const payload = `${Math.floor(now / 1000) + SESSION_SECONDS}.${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(`session:${payload}`));
  return `${payload}.${hex(signature)}`;
}

export async function isAdmin(request: Request, now = Date.now()) {
  const token = request.headers.get("cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length + 1);
  if (!token) return false;
  const match = /^(\d{10})\.([0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  const current = Math.floor(now / 1000);
  if (expires <= current || expires > current + SESSION_SECONDS) return false;
  const bytes = new Uint8Array(match[3].match(/../g)!.map((part) => parseInt(part, 16)));
  return crypto.subtle.verify("HMAC", await signingKey(), bytes, encoder.encode(`session:${match[1]}.${match[2]}`));
}

export async function requireAdmin(request: Request) {
  if (!await isAdmin(request)) throw new FeedbackError(401, "운영자 로그인이 필요합니다.");
}

export function requireSameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new FeedbackError(403, "이 사이트에서 다시 시도해 주세요.");
  }
}

export function sessionCookie(request: Request, token: string, maxAge = SESSION_SECONDS) {
  const secure = new URL(request.url).protocol === "https:" || process.env.VERCEL === "1";
  return `${ADMIN_COOKIE}=${token}; Path=/api/feedback; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export async function clientRateKey(request: Request) {
  // Trust forwarding headers only when an identified platform owns the proxy.
  const ip = getFeedbackClientAddress(request);
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(`rate:${ip}`));
  return hex(signature);
}
