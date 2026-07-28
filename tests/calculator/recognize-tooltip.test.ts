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
      expect.objectContaining({ logger: expect.any(Function) }),
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
