import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES, type FeedbackInput, type FeedbackStatus } from "../types";
import { FeedbackError } from "./errors";

export const MAX_BODY_BYTES = 24_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validId(id: string) {
  if (!UUID.test(id)) throw new FeedbackError(400, "접수 번호가 올바르지 않습니다.");
  return id;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FeedbackError(400, "입력 내용을 확인해 주세요.");
  return value as Record<string, unknown>;
}

function field(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "string") throw new FeedbackError(400, `${label}을 확인해 주세요.`);
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (text.length < min || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw new FeedbackError(400, `${label}은 ${min}~${max}자로 입력해 주세요.`);
  }
  return text;
}

export function validateInput(value: unknown): FeedbackInput {
  const input = object(value);
  if (typeof input.category !== "string" || !Object.hasOwn(FEEDBACK_CATEGORIES, input.category)) throw new FeedbackError(400, "오류 유형을 선택해 주세요.");
  const title = field(input.title, "제목", 5, 100);
  if (/[\n\t]/.test(title)) throw new FeedbackError(400, "제목은 한 줄로 입력해 주세요.");
  if (typeof input.id !== "string") throw new FeedbackError(400, "접수 번호가 올바르지 않습니다.");
  return {
    id: validId(input.id), category: input.category as FeedbackInput["category"], title,
    description: field(input.description, "오류 내용", 10, 4000),
    environment: field(input.environment ?? "", "사용 환경", 0, 200),
  };
}

export function validateUpdate(value: unknown): { status: FeedbackStatus; adminNote: string; updatedAt: string } {
  const input = object(value);
  if (typeof input.status !== "string" || !Object.hasOwn(FEEDBACK_STATUSES, input.status)) throw new FeedbackError(400, "처리 상태를 선택해 주세요.");
  if (typeof input.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(input.updatedAt)) throw new FeedbackError(400, "제보를 다시 불러와 주세요.");
  return { status: input.status as FeedbackStatus, adminNote: field(input.adminNote, "운영자 메모", 0, 4000), updatedAt: input.updatedAt };
}

export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new FeedbackError(415, "입력 형식을 확인해 주세요.");
  const reader = request.body?.getReader();
  if (!reader) throw new FeedbackError(400, "입력 내용을 확인해 주세요.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new FeedbackError(413, "입력 내용이 너무 깁니다.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new FeedbackError(400, "입력 내용을 확인해 주세요."); }
}
