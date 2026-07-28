"use client";

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
    },
  ): Promise<string>;
  terminate(): Promise<void>;
};

export const MAX_TOOLTIP_IMAGE_BYTES = 12 * 1024 * 1024;

const SUPPORTED_TOOLTIP_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

type RecognitionErrorCode =
  | "CANCELLED"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE"
  | "OCR_FAILED";

export type TooltipRecognitionError = {
  code: RecognitionErrorCode;
  retryable: boolean;
};

type BrowserOcrWorker = {
  recognize(file: File): Promise<{ data: { text: string } }>;
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
      candidate.code === "UNSUPPORTED_FILE" ||
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

export const createBrowserTooltipRecognizer = (): TooltipRecognizer => {
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
      const currentWorker = await raceWithAbort(ensureWorker(), signal);
      if (signal.aborted) {
        throw createAbortError();
      }

      const result = await raceWithAbort(
        Promise.resolve().then(() => currentWorker.recognize(file)),
        signal,
      );

      if (signal.aborted) {
        throw createAbortError();
      }

      return result.data.text;
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
