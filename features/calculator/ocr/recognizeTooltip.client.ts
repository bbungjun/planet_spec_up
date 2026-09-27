"use client";

import { contrastTooltip, enlargeTooltip, tooltipImageSize } from "./enlargeTooltip.client";
import { mergeRecognitionText } from "./mergeRecognitionText";
import { prepareTooltip } from "./prepareTooltip.client";
import { buildOcrReview, pageReadings, reviewText, type EnginePage } from "./reviewRecognition";
import type { OcrBounds, OcrReview } from "./types";
import { parseMapleTooltip } from "./parseMapleTooltip";

export type TooltipRecognitionProgress = {
  status: "loading" | "recognizing";
  progress: number;
};

export type TooltipRecognizer = {
  recognize(
    file: File,
    options: {
      signal: AbortSignal;
      onProgress: (progress: TooltipRecognitionProgress) => void;
      onPrepared?: (image: File) => void;
      onReview?: (review: OcrReview) => void;
      region?: OcrBounds;
      enhance?: boolean;
    },
  ): Promise<string>;
  terminate(): Promise<void>;
};

export const MAX_TOOLTIP_IMAGE_BYTES = 12 * 1024 * 1024;

const LOCAL_OCR_ASSET_PATH = "/ocr";

const SUPPORTED_TOOLTIP_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

type RecognitionErrorCode =
  | "CANCELLED"
  | "FILE_TOO_LARGE"
  | "IMAGE_DIMENSIONS_TOO_LARGE"
  | "TOOLTIP_NOT_FOUND"
  | "MULTIPLE_TOOLTIPS"
  | "INVALID_CROP"
  | "UNSUPPORTED_FILE"
  | "OCR_UNAVAILABLE"
  | "OCR_FAILED";

export type TooltipRecognitionError = {
  code: RecognitionErrorCode;
  retryable: boolean;
};

type BrowserOcrWorker = {
  setParameters(parameters: Record<string, string>): Promise<unknown>;
  recognize(file: File, options?: object, output?: { text: boolean; blocks: boolean }): Promise<{ data: EnginePage }>;
  terminate(): Promise<unknown>;
};

type WorkerLogMessage = {
  status?: string;
  progress?: number;
};

const isAbortError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return false;
  }

  return error.name === "AbortError";
};

const createAbortError = (): DOMException => {
  return new DOMException("Cancelled", "AbortError");
};

const createRecognitionError = (
  code: Exclude<RecognitionErrorCode, "OCR_FAILED" | "CANCELLED">,
): TooltipRecognitionError => ({
  code,
  retryable: false,
});

const isTooltipRecognitionError = (
  error: unknown,
): error is TooltipRecognitionError => {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as Partial<TooltipRecognitionError>;
  return (
    (candidate.code === "CANCELLED" ||
      candidate.code === "FILE_TOO_LARGE" ||
      candidate.code === "IMAGE_DIMENSIONS_TOO_LARGE" ||
      candidate.code === "TOOLTIP_NOT_FOUND" ||
      candidate.code === "MULTIPLE_TOOLTIPS" ||
      candidate.code === "INVALID_CROP" ||
      candidate.code === "UNSUPPORTED_FILE" ||
      candidate.code === "OCR_UNAVAILABLE" ||
      candidate.code === "OCR_FAILED") &&
    typeof candidate.retryable === "boolean"
  );
};

export const isSupportedTooltipImage = (file: File): boolean => {
  return SUPPORTED_TOOLTIP_IMAGE_TYPES.has(file.type.toLowerCase());
};

export const toRecognitionError = (
  error: unknown,
): TooltipRecognitionError => {
  if (isTooltipRecognitionError(error)) {
    return { code: error.code, retryable: error.retryable };
  }

  if (isAbortError(error)) {
    return { code: "CANCELLED", retryable: false };
  }

  return { code: "OCR_FAILED", retryable: true };
};

export function recognitionErrorMessage(error: unknown): string {
  switch (toRecognitionError(error).code) {
    case "TOOLTIP_NOT_FOUND": return "장비 설명창을 찾지 못했어요. 영역을 직접 지정해보세요. 사진에 설명창이 없으면 다시 캡처해주세요.";
    case "MULTIPLE_TOOLTIPS": return "설명창 후보가 여러 개예요. 읽을 장비의 영역을 직접 지정해주세요.";
    case "INVALID_CROP": return "선택한 영역이 너무 작거나 이미지 밖입니다. 설명창 전체를 포함해주세요.";
    case "IMAGE_DIMENSIONS_TOO_LARGE": return "이미지 해상도가 너무 큽니다. 2,400만 픽셀 이하 또는 게임 창만 캡처해 넣어주세요.";
    case "UNSUPPORTED_FILE": return "지원되지 않는 이미지 형식입니다. PNG, JPEG, WebP를 선택하세요.";
    case "FILE_TOO_LARGE": return "이미지가 너무 큽니다. 12MB 이하의 이미지를 선택하세요.";
    case "CANCELLED": return "OCR을 취소했습니다.";
    case "OCR_UNAVAILABLE": return "인식 기능을 준비하지 못했습니다. 사이트 연결을 확인하고 다시 시도해주세요.";
    default: return "문자 인식 중 오류가 발생했습니다. 다시 시도하거나 설명창 영역을 지정해주세요.";
  }
}

const clampProgress = (progress: number | undefined): number => {
  if (typeof progress !== "number" || !Number.isFinite(progress)) {
    return 0;
  }

  return Math.min(1, Math.max(0, progress));
};

const progressStatus = (status: string | undefined): TooltipRecognitionProgress["status"] => {
  return status?.toLowerCase().includes("recogniz") ? "recognizing" : "loading";
};

const raceWithAbort = async <T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> => {
  if (signal.aborted) {
    throw createAbortError();
  }

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);

    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
};

export const createTesseractTooltipRecognizer = (): TooltipRecognizer => {
  let worker: BrowserOcrWorker | null = null;
  let workerPromise: Promise<BrowserOcrWorker> | null = null;
  let workerGeneration = 0;
  let modulePromise: Promise<typeof import("tesseract.js")> | null = null;
  let activeProgress: ((progress: TooltipRecognitionProgress) => void) | null =
    null;
  let queuedRecognition: Promise<unknown> = Promise.resolve();

  const reportWorkerProgress = (
    generation: number,
    message: WorkerLogMessage,
  ) => {
    if (generation !== workerGeneration) {
      return;
    }

    activeProgress?.({
      status: progressStatus(message.status),
      progress: clampProgress(message.progress),
    });
  };

  const safelyTerminate = async (candidate: BrowserOcrWorker) => {
    try {
      await candidate.terminate();
    } catch {
      // A worker that is already terminating is still considered terminated.
    }
  };

  const terminateCurrentWorker = async (): Promise<void> => {
    workerGeneration += 1;
    const currentWorker = worker;
    worker = null;
    workerPromise = null;
    activeProgress = null;

    if (currentWorker) {
      await safelyTerminate(currentWorker);
    }
  };

  const ensureWorker = async (): Promise<BrowserOcrWorker> => {
    if (worker) {
      return worker;
    }

    if (workerPromise) {
      return workerPromise;
    }

    const generation = ++workerGeneration;
    const pending = (async () => {
      modulePromise ??= import("tesseract.js");
      const moduleToLoad = modulePromise;
      let createWorker: typeof import("tesseract.js").createWorker;
      try {
        ({ createWorker } = await moduleToLoad);
      } catch (error) {
        if (modulePromise === moduleToLoad) {
          modulePromise = null;
        }
        throw error;
      }
      const createdWorker = (await createWorker(
        ["kor", "eng"],
        1,
        {
          workerPath: `${LOCAL_OCR_ASSET_PATH}/worker.min.js`,
          corePath: `${LOCAL_OCR_ASSET_PATH}/tesseract-core-lstm.wasm.js`,
          langPath: LOCAL_OCR_ASSET_PATH,
          gzip: false,
          logger: (message) => reportWorkerProgress(generation, message),
          errorHandler: () => undefined,
        },
      )) as BrowserOcrWorker;

      if (generation === workerGeneration) {
        worker = createdWorker;
      } else {
        await safelyTerminate(createdWorker);
      }

      return createdWorker;
    })();

    workerPromise = pending;
    pending.catch(() => {
      if (workerPromise === pending) {
        workerPromise = null;
      }
    });

    return pending;
  };

  const recognizeOnce = async (
    file: File,
    options: {
      signal: AbortSignal;
      onProgress: (progress: TooltipRecognitionProgress) => void;
      onPrepared?: (image: File) => void;
      onReview?: (review: OcrReview) => void;
      region?: OcrBounds;
      enhance?: boolean;
    },
  ): Promise<string> => {
    const { signal, onProgress } = options;

    if (!isSupportedTooltipImage(file)) {
      throw createRecognitionError("UNSUPPORTED_FILE");
    }

    if (file.size > MAX_TOOLTIP_IMAGE_BYTES) {
      throw createRecognitionError("FILE_TOO_LARGE");
    }

    if (signal.aborted) {
      throw createAbortError();
    }

    activeProgress = onProgress;

    try {
      onProgress({ status: "loading", progress: 0 });
      let prepared: File;
      let preparationWarnings: string[] = [];
      try {
        prepared = await raceWithAbort(prepareTooltip(file, { signal, region: options.region, onWarnings: warnings => { preparationWarnings = warnings; } }), signal);
      } catch (error) {
        const ambiguous = error as { code?: string; regions?: OcrBounds[] };
        if (ambiguous.code !== "MULTIPLE_TOOLTIPS" || !ambiguous.regions?.length || options.region || signal.aborted) throw error;
        // Compare only a bounded set of visual candidates. Set-effect/help
        // panels lack gear category/requirements; two real items stay ambiguous.
        const candidateWorker = await raceWithAbort(ensureWorker(), signal);
        const matches: Array<{ file: File; warnings: string[] }> = [];
        for (const region of ambiguous.regions) {
          let warnings: string[] = [];
          const candidate = await raceWithAbort(prepareTooltip(file, { signal, region, onWarnings: result => { warnings = result; } }), signal);
          const candidateView = await enlargeTooltip(candidate, 3) ?? candidate;
          if (signal.aborted) throw createAbortError();
          await raceWithAbort(candidateWorker.setParameters({ tessedit_pageseg_mode: "6", user_defined_dpi: "300" }), signal);
          const probe = await raceWithAbort(candidateWorker.recognize(candidateView), signal);
          const parsed = parseMapleTooltip(probe.data.text);
          const requirements = /RE[QGR@®]\s*(?:LEV|STR|DEX|INT|LUK)/i.test(probe.data.text);
          if (parsed.category && (requirements || parsed.options.length >= 2)) matches.push({ file: candidate, warnings });
        }
        if (matches.length !== 1) throw createRecognitionError(matches.length ? "MULTIPLE_TOOLTIPS" : "TOOLTIP_NOT_FOUND");
        prepared = matches[0].file;
        preparationWarnings = matches[0].warnings;
      }
      if (signal.aborted) throw createAbortError();
      options.onPrepared?.(prepared);
      const currentWorker = await raceWithAbort(ensureWorker(), signal);
      if (signal.aborted) {
        throw createAbortError();
      }

      const enlarged = await enlargeTooltip(prepared, 3) ?? prepared;
      if (signal.aborted) throw createAbortError();
      const dimensions = await tooltipImageSize(enlarged);
      const firstImage = options.enhance ? await contrastTooltip(enlarged) : enlarged;
      if (signal.aborted) throw createAbortError();
      await raceWithAbort(currentWorker.setParameters({ tessedit_pageseg_mode: "6", user_defined_dpi: "300" }), signal);

      const result = await raceWithAbort(
        Promise.resolve().then(() => currentWorker.recognize(firstImage, {}, { text: true, blocks: true })),
        signal,
      );

      if (signal.aborted) {
        throw createAbortError();
      }

      await raceWithAbort(currentWorker.setParameters({ tessedit_pageseg_mode: "11" }), signal);
      const refined = await raceWithAbort(currentWorker.recognize(enlarged, {}, { text: true, blocks: true }), signal);
      if (signal.aborted) throw createAbortError();
      if (!dimensions) {
        const text = mergeRecognitionText(result.data.text, refined.data.text);
        options.onReview?.(buildOcrReview(text.split(/\r?\n/).map(text => ({ text, pass: 0 })), ["이 환경에서 원본 위치를 확인할 수 없어 옵션을 직접 확인해야 합니다."]));
        return text;
      }
      const review = buildOcrReview([
        ...pageReadings(result.data, dimensions.width, dimensions.height, 0),
        ...pageReadings(refined.data, dimensions.width, dimensions.height, 1),
      ], [...preparationWarnings, ...(result.data.blocks && refined.data.blocks ? [] : ["문자 위치를 충분히 읽지 못했어요. 원본을 확인하거나 영역을 다시 지정해주세요."])]);
      options.onReview?.(review);
      return reviewText(review);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        await terminateCurrentWorker();
        throw createAbortError();
      }

      await terminateCurrentWorker();
      throw toRecognitionError(error);
    } finally {
      if (activeProgress === onProgress) {
        activeProgress = null;
      }
    }
  };

  const recognize: TooltipRecognizer["recognize"] = (file, options) => {
    const queued = queuedRecognition.then(() => recognizeOnce(file, options));
    queuedRecognition = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  };

  return {
    recognize,
    terminate: terminateCurrentWorker,
  };
};

/** Public factory: model details stay behind the same review/cancellation
 * contract. The Tesseract adapter remains available for regression comparison. */
export const createBrowserTooltipRecognizer = (): TooltipRecognizer => {
  let adapter: TooltipRecognizer | undefined;
  let pending: Promise<TooltipRecognizer> | undefined;
  let generation = 0;
  return {
    async recognize(file, options) {
      if (options.signal.aborted) throw createAbortError();
      const version = generation;
      pending ??= import("./recognizePaddle.client").then(({ createPaddleTooltipRecognizer }) => {
        if (generation !== version) throw createAbortError();
        adapter = createPaddleTooltipRecognizer();
        return adapter;
      }).catch(error => {
        if (generation === version) pending = undefined;
        if (generation !== version || isAbortError(error)) throw error;
        throw { code: "OCR_UNAVAILABLE", retryable: true } satisfies TooltipRecognitionError;
      });
      const current = await raceWithAbort(pending, options.signal);
      if (generation !== version || options.signal.aborted) throw createAbortError();
      return current.recognize(file, options);
    },
    async terminate() {
      generation += 1;
      const current = adapter;
      adapter = undefined;
      pending = undefined;
      await current?.terminate();
    },
  };
};
