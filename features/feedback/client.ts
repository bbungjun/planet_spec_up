export class FeedbackRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function feedbackRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, credentials: "same-origin", cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new FeedbackRequestError(typeof payload.error === "string" ? payload.error : "요청을 완료하지 못했습니다.", response.status);
    return payload as T;
  } catch (error) {
    if (error instanceof FeedbackRequestError) throw error;
    throw new FeedbackRequestError("연결을 확인한 뒤 다시 시도해 주세요. 입력 내용은 유지됩니다.", 0);
  } finally { window.clearTimeout(timeout); }
}

export function jsonRequest(method: string, payload: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
