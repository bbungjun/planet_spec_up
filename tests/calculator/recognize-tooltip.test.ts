import { beforeEach, describe, expect, it, vi } from "vitest";

const createWorker = vi.hoisted(() => vi.fn());

vi.mock("tesseract.js", () => ({ createWorker }));

import {
  MAX_TOOLTIP_IMAGE_BYTES,
  createBrowserTooltipRecognizer,
  isSupportedTooltipImage,
  toRecognitionError,
} from "@/features/calculator/ocr/recognizeTooltip.client";

describe("browser tooltip OCR adapter helpers", () => {
  beforeEach(() => {
    createWorker.mockReset();
  });

  it("accepts PNG images and rejects unsupported GIF images", () => {
    expect(
      isSupportedTooltipImage(
        new File(["x"], "item.png", { type: "image/png" }),
      ),
    ).toBe(true);
    expect(
      isSupportedTooltipImage(
        new File(["x"], "item.gif", { type: "image/gif" }),
      ),
    ).toBe(false);
  });

  it("normalizes abort errors into a non-retryable cancellation", () => {
    expect(toRecognitionError(new DOMException("Cancelled", "AbortError"))).toEqual({
      code: "CANCELLED",
      retryable: false,
    });
  });

  it("rejects an oversized image before starting recognition", async () => {
    const recognizer = createBrowserTooltipRecognizer();
    const oversized = new File(
      [new Uint8Array(MAX_TOOLTIP_IMAGE_BYTES + 1)],
      "too-large.png",
      { type: "image/png" },
    );

    await expect(
      recognizer.recognize(oversized, {
        signal: new AbortController().signal,
        onProgress: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE", retryable: false });
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("contains startup and recognition failures and retries with fresh workers", async () => {
    const failedWorker = {
      recognize: vi.fn().mockRejectedValue(new Error("recognition failed")),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const healthyWorker = {
      recognize: vi.fn().mockResolvedValue({ data: { text: "DEX +10" } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const startupError = new Error("worker startup failed");
    const workerOptions = [] as Array<Record<string, unknown>>;
    createWorker
      .mockImplementationOnce(async (_langs, _oem, options) => {
        workerOptions.push(options);
        throw startupError;
      })
      .mockImplementationOnce(async (_langs, _oem, options) => {
        workerOptions.push(options);
        return failedWorker;
      })
      .mockImplementationOnce(async (_langs, _oem, options) => {
        workerOptions.push(options);
        return healthyWorker;
      });

    const recognizer = createBrowserTooltipRecognizer();
    const file = new File(["x"], "item.png", { type: "image/png" });
    const options = () => ({
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });

    await expect(recognizer.recognize(file, options())).rejects.toEqual({
      code: "OCR_FAILED",
      retryable: true,
    });
    await expect(recognizer.recognize(file, options())).rejects.toEqual({
      code: "OCR_FAILED",
      retryable: true,
    });
    expect(failedWorker.terminate).toHaveBeenCalledTimes(1);
    await expect(recognizer.recognize(file, options())).resolves.toBe("DEX +10");

    expect(createWorker).toHaveBeenCalledTimes(3);
    expect(workerOptions).toHaveLength(3);
    expect(workerOptions.every((value) => typeof value.errorHandler === "function")).toBe(
      true,
    );
  });

  it("drops progress from a cancelled startup before the next recognition", async () => {
    let resolveFirstStartup: ((worker: unknown) => void) | undefined;
    let resolveSecondRecognition: ((result: { data: { text: string } }) => void) | undefined;
    let firstLogger: ((message: { status: string; progress: number }) => void) | undefined;
    let secondLogger: ((message: { status: string; progress: number }) => void) | undefined;
    const firstWorker = {
      recognize: vi.fn().mockResolvedValue({ data: { text: "STR +1" } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const secondWorker = {
      recognize: vi.fn(
        () =>
          new Promise<{ data: { text: string } }>((resolve) => {
            resolveSecondRecognition = resolve;
          }),
      ),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    createWorker
      .mockImplementationOnce(async (_langs, _oem, { logger }) => {
        firstLogger = logger;
        return new Promise((resolve) => {
          resolveFirstStartup = resolve;
        });
      })
      .mockImplementationOnce(async (_langs, _oem, { logger }) => {
        secondLogger = logger;
        return secondWorker;
      });

    const recognizer = createBrowserTooltipRecognizer();
    const firstController = new AbortController();
    const firstProgress = vi.fn();
    const secondProgress = vi.fn();
    const firstRecognition = recognizer.recognize(
      new File(["first"], "first.png", { type: "image/png" }),
      { signal: firstController.signal, onProgress: firstProgress },
    );

    await vi.waitFor(() => {
      expect(createWorker).toHaveBeenCalledTimes(1);
      expect(firstLogger).toEqual(expect.any(Function));
    });
    firstController.abort();
    await expect(firstRecognition).rejects.toMatchObject({ name: "AbortError" });

    const secondRecognition = recognizer.recognize(
      new File(["second"], "second.png", { type: "image/png" }),
      { signal: new AbortController().signal, onProgress: secondProgress },
    );
    await vi.waitFor(() => {
      expect(createWorker).toHaveBeenCalledTimes(2);
      expect(secondLogger).toEqual(expect.any(Function));
      expect(secondWorker.recognize).toHaveBeenCalledTimes(1);
    });

    firstLogger?.({ status: "loading language traineddata", progress: 0.1 });
    expect(secondProgress).not.toHaveBeenCalled();
    secondLogger?.({ status: "recognizing text", progress: 0.8 });
    resolveSecondRecognition?.({ data: { text: "DEX +10" } });
    await expect(secondRecognition).resolves.toBe("DEX +10");
    expect(secondProgress).toHaveBeenCalledWith({
      status: "recognizing",
      progress: 0.8,
    });

    resolveFirstStartup?.(firstWorker);
    await vi.waitFor(() => expect(firstWorker.terminate).toHaveBeenCalledTimes(1));
  });

  it("loads one worker lazily, reports progress, and reuses it", async () => {
    const worker = {
      recognize: vi.fn().mockResolvedValue({ data: { text: "STR +10" } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    createWorker.mockImplementation(async (_langs, _oem, { logger }) => {
      logger({ status: "loading language traineddata", progress: 0.25 });
      logger({ status: "recognizing text", progress: 0.75 });
      return worker;
    });

    const recognizer = createBrowserTooltipRecognizer();
    const onProgress = vi.fn();
    const firstFile = new File(["first"], "item.png", { type: "image/png" });
    const secondFile = new File(["second"], "item.png", { type: "image/png" });

    await expect(
      recognizer.recognize(firstFile, {
        signal: new AbortController().signal,
        onProgress,
      }),
    ).resolves.toBe("STR +10");
    await recognizer.recognize(secondFile, {
      signal: new AbortController().signal,
      onProgress,
    });

    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(createWorker).toHaveBeenCalledWith(
      ["kor", "eng"],
      1,
      expect.objectContaining({
        logger: expect.any(Function),
        workerPath: "/ocr/worker.min.js",
        corePath: "/ocr/tesseract-core-lstm.wasm.js",
        langPath: "/ocr",
        gzip: false,
      }),
    );
    expect(worker.recognize).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      status: "loading",
      progress: 0.25,
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      status: "recognizing",
      progress: 0.75,
    });
  });

  it("terminates on cancellation so the next recognition starts a fresh worker", async () => {
    const firstWorker = {
      recognize: vi.fn(
        () =>
          new Promise<{ data: { text: string } }>(() => undefined),
      ),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const secondWorker = {
      recognize: vi.fn().mockResolvedValue({ data: { text: "DEX +10" } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    createWorker
      .mockResolvedValueOnce(firstWorker)
      .mockResolvedValueOnce(secondWorker);

    const recognizer = createBrowserTooltipRecognizer();
    const controller = new AbortController();
    const pending = recognizer.recognize(
      new File(["first"], "item.png", { type: "image/png" }),
      { signal: controller.signal, onProgress: vi.fn() },
    );

    await vi.waitFor(() => expect(firstWorker.recognize).toHaveBeenCalled());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);

    await expect(
      recognizer.recognize(
        new File(["second"], "item.png", { type: "image/png" }),
        { signal: new AbortController().signal, onProgress: vi.fn() },
      ),
    ).resolves.toBe("DEX +10");
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it("makes terminate idempotent", async () => {
    const worker = {
      recognize: vi.fn().mockResolvedValue({ data: { text: "LUK +1" } }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    createWorker.mockResolvedValue(worker);

    const recognizer = createBrowserTooltipRecognizer();
    await recognizer.recognize(
      new File(["x"], "item.png", { type: "image/png" }),
      { signal: new AbortController().signal, onProgress: vi.fn() },
    );
    await recognizer.terminate();
    await recognizer.terminate();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
