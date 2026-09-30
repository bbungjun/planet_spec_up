"use client";

/**
 * 설명창 분리 작업의 브라우저 실행 위치와 취소 수명을 관리한다.
 * Worker·OffscreenCanvas 지원 환경에서는 분리를 작업자로 넘기고, 미지원 환경에서는 직접 실행한다.
 */

import { prepareTooltipImage, type TooltipCandidateRegions } from "./prepareTooltipImage";
import type { OcrBounds } from "./types";

/**
 * 파일·영역·잘림 경고를 전처리 구현에 전달하고 처리된 File을 반환한다.
 * 작업자 경로는 완료·실패·취소 시 작업자를 종료한다. 작업자 생성 실패는 조용히 직접 실행하지 않고 오류로 알린다.
 */
export async function prepareTooltip(file: File, options: { region?: OcrBounds; signal?: AbortSignal; onWarnings?: (warnings: string[]) => void; onCandidates?: (candidates: TooltipCandidateRegions) => void } = {}): Promise<File> {
  const { signal, region } = options;
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  if (typeof Worker !== "function" || typeof OffscreenCanvas !== "function") return prepareTooltipImage(file, region, options.onWarnings, options.onCandidates);
  return new Promise<File>((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL("./prepareTooltip.worker.ts", import.meta.url), { type: "module" }); }
    catch { reject({ code: "OCR_UNAVAILABLE", retryable: true }); return; }
    const cleanup = () => { signal?.removeEventListener("abort", abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = event => {
      cleanup();
      if (event.data.candidates) options.onCandidates?.(event.data.candidates);
      if (event.data.error) reject(event.data.error); else { options.onWarnings?.(event.data.warnings ?? []); resolve(event.data.file); }
    };
    worker.onerror = () => { cleanup(); reject({ code: "OCR_UNAVAILABLE", retryable: true }); };
    worker.postMessage({ file, region });
  });
}
