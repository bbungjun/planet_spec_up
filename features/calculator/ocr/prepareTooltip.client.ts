"use client";

import { prepareTooltipImage } from "./prepareTooltipImage";
import type { OcrBounds } from "./types";

/** Keep desktop/chat text out of equipment parsing. Tight tooltip captures
 * retain their original pixels; broad screenshots must have one clear frame. */
export async function prepareTooltip(file: File, options: { region?: OcrBounds; signal?: AbortSignal; onWarnings?: (warnings: string[]) => void } = {}): Promise<File> {
  const { signal, region } = options;
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  if (typeof Worker !== "function" || typeof OffscreenCanvas !== "function") return prepareTooltipImage(file, region, options.onWarnings);
  return new Promise<File>((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL("./prepareTooltip.worker.ts", import.meta.url), { type: "module" }); }
    catch { reject({ code: "OCR_UNAVAILABLE", retryable: true }); return; }
    const cleanup = () => { signal?.removeEventListener("abort", abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = event => {
      cleanup();
      if (event.data.error) reject(event.data.error); else { options.onWarnings?.(event.data.warnings ?? []); resolve(event.data.file); }
    };
    worker.onerror = () => { cleanup(); reject({ code: "OCR_UNAVAILABLE", retryable: true }); };
    worker.postMessage({ file, region });
  });
}
