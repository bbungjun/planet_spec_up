"use client";

/**
 * 여러 이미지의 OCR 작업을 고정 워커 풀로 실행하고 원래 선택 인덱스와 함께 결과를 전달한다.
 * 동일 바이트 파일은 한 번만 판독한다. 장비 슬롯 배정과 적용은 UI/일괄 적용 모듈의 책임이다.
 */

import { imageFingerprint } from "./batch";
import { createBrowserTooltipRecognizer, isSupportedTooltipImage, MAX_TOOLTIP_IMAGE_BYTES, type TooltipRecognizer } from "./recognizeTooltip.client";
import type { OcrReview } from "./types";

export const MAX_OCR_CONCURRENCY = 3;
type Capacity = { hardwareConcurrency?: number; deviceMemory?: number };

/**
 * 사진 수·CPU·메모리·가장 큰 파일 크기를 고려해 1~3개의 병렬 인식기 수를 정한다.
 */
export function batchConcurrency(count: number, capacity: Capacity = typeof navigator === "undefined" ? {} : navigator, largestImageBytes = 0): number {
  const cores = capacity.hardwareConcurrency ?? 4;
  const memory = capacity.deviceMemory ?? 8;
  const cpuLimit = cores <= 2 ? 1 : cores <= 4 ? 2 : MAX_OCR_CONCURRENCY;
  const memoryLimit = memory <= 2 ? 1 : memory <= 4 ? 2 : MAX_OCR_CONCURRENCY;
  const imageLimit = largestImageBytes > 6 * 1024 * 1024 ? 2 : MAX_OCR_CONCURRENCY;
  return Math.max(1, Math.min(count, cpuLimit, memoryLimit, imageLimit));
}

export type BatchRecognitionResult =
  | { ok: true; text: string; preview: File; review?: OcrReview; duplicateOf?: number }
  | { ok: false; error: unknown };

type Options = {
  signal: AbortSignal;
  concurrency: number;
  createRecognizer?: () => TooltipRecognizer;
  onStart: (index: number) => void;
  onProgress: (index: number, progress: number) => void;
  onPrepared: (index: number, preview: File) => void;
  onResult: (index: number, result: BatchRecognitionResult) => void;
  /** Completed images may request a retry at the next existing worker boundary. */
  takePriorityTask?: () => ((recognizer: TooltipRecognizer) => Promise<void>) | undefined;
};

/**
 * 선택 순서로 입력을 검사·해시한 뒤 각 워커의 개별 인식기로 판독한다.
 * 동일 이미지의 결과를 재사용하고, 취소 후 결과 전파를 막으며 모든 소유 인식기의 종료를 관리한다.
 */
export async function recognizeBatch(files: File[], options: Options): Promise<void> {
  const { signal } = options;
  if (signal.aborted) return;
  const workers = new Set<TooltipRecognizer>();
  const terminations = new Map<TooltipRecognizer, Promise<unknown>>();
  const terminate = (worker: TooltipRecognizer) => {
    if (!terminations.has(worker)) terminations.set(worker, Promise.resolve().then(() => worker.terminate()).catch(() => undefined));
    return terminations.get(worker)!;
  };
  let releaseAbort: () => void = () => {};
  const aborted = new Promise<void>(resolve => { releaseAbort = resolve; });
  const cancel = () => { workers.forEach(worker => { void terminate(worker); }); releaseAbort(); };
  signal.addEventListener("abort", cancel, { once: true });
  const emit = (index: number, result: BatchRecognitionResult) => { if (!signal.aborted) options.onResult(index, result); };

  try {
    const jobs: Array<{ index: number; copies: number[] }> = [];
    const hashes = new Map<string, typeof jobs[number]>();
    // Hash in selection order before dispatch. Identical pending images then
    // share one OCR job, and only one source buffer is hashed at a time.
    for (let index = 0; index < files.length; index++) {
      if (signal.aborted) return;
      const file = files[index];
      if (!isSupportedTooltipImage(file) || file.size > MAX_TOOLTIP_IMAGE_BYTES) {
        emit(index, { ok: false, error: { code: isSupportedTooltipImage(file) ? "FILE_TOO_LARGE" : "UNSUPPORTED_FILE", retryable: false } });
        continue;
      }
      try {
        const hash = await imageFingerprint(file);
        if (signal.aborted) return;
        const earlier = hash ? hashes.get(hash) : undefined;
        if (earlier) { earlier.copies.push(index); continue; }
        const job = { index, copies: [] as number[] };
        jobs.push(job);
        if (hash) hashes.set(hash, job);
      } catch (error) {
        emit(index, { ok: false, error });
      }
    }

    let next = 0;
    const runWorker = async () => {
      let recognizer: TooltipRecognizer | undefined;
      while (!signal.aborted) {
        const priority = options.takePriorityTask?.();
        if (priority) {
          recognizer ??= (options.createRecognizer ?? createBrowserTooltipRecognizer)();
          workers.add(recognizer);
          await priority(recognizer);
          continue;
        }
        if (next >= jobs.length) break;
        const { index, copies } = jobs[next++];
        options.onStart(index);
        let preview = files[index];
        let review: OcrReview | undefined;
        let result: BatchRecognitionResult;
        try {
          recognizer ??= (options.createRecognizer ?? createBrowserTooltipRecognizer)();
          workers.add(recognizer);
          const text = await recognizer.recognize(files[index], {
            signal,
            onProgress: ({ progress }) => { if (!signal.aborted) options.onProgress(index, progress); },
            onPrepared: image => {
              preview = image;
              if (!signal.aborted) options.onPrepared(index, image);
            },
            onReview: result => { review = result; },
          });
          result = { ok: true, text, preview, review };
        } catch (error) {
          result = { ok: false, error };
        }
        emit(index, result);
        for (const copy of copies) emit(copy, result.ok ? {
          ...result, duplicateOf: index, preview: result.preview === files[index] ? files[copy] : result.preview,
        } : result);
      }
    };

    const count = Math.min(jobs.length, MAX_OCR_CONCURRENCY, Math.max(1, Math.floor(options.concurrency) || 1));
    await Promise.race([Promise.all(Array.from({ length: count }, runWorker)), aborted]);
  } finally {
    signal.removeEventListener("abort", cancel);
    await Promise.allSettled([...workers].map(terminate));
  }
}
