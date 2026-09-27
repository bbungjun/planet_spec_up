import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { batchConcurrency, recognizeBatch, type BatchRecognitionResult } from "@/features/calculator/ocr/recognizeBatch.client";
import type { TooltipRecognizer } from "@/features/calculator/ocr/recognizeTooltip.client";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());
const file = (name: string, content = name) => new File([content], name, { type: "image/png" });
function callbacks(signal = new AbortController().signal) {
  return { signal, concurrency: 3, onStart: vi.fn(), onProgress: vi.fn(), onPrepared: vi.fn(), onResult: vi.fn<(index: number, result: BatchRecognitionResult) => void>() };
}

it.each([
  [19, { hardwareConcurrency: 16, deviceMemory: 8 }, 3],
  [19, { hardwareConcurrency: 4, deviceMemory: 8 }, 2],
  [19, { hardwareConcurrency: 2, deviceMemory: 8 }, 1],
  [19, { hardwareConcurrency: 16, deviceMemory: 2 }, 1],
  [19, { hardwareConcurrency: 16, deviceMemory: 4 }, 2],
  [1, { hardwareConcurrency: 16, deviceMemory: 8 }, 1],
] as const)("limits %i files based on browser capacity %o", (count, capacity, expected) => {
  expect(batchConcurrency(count, capacity)).toBe(expected);
});

it("reduces parallel memory use for large screenshots", () => {
  expect(batchConcurrency(19, { hardwareConcurrency: 16, deviceMemory: 8 }, 10 * 1024 * 1024)).toBe(2);
});

it("processes 19 images with three reusable workers and immediately refills a free worker", async () => {
  const pending = new Map<string, () => void>();
  const recognized: string[] = [];
  const workers: TooltipRecognizer[] = [];
  let active = 0, peak = 0;
  const createRecognizer = vi.fn(() => {
    let occupied = false;
    const worker = {
      recognize: vi.fn<TooltipRecognizer["recognize"]>().mockImplementation(image => {
        expect(occupied).toBe(false);
        occupied = true;
        recognized.push(image.name);
        peak = Math.max(peak, ++active);
        return new Promise(resolve => pending.set(image.name, () => {
          occupied = false;
          active--;
          pending.delete(image.name);
          resolve(`DEX +${recognized.length}`);
        }));
      }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    workers.push(worker);
    return worker;
  });
  const options = { ...callbacks(), createRecognizer };
  const completion = recognizeBatch(Array.from({ length: 19 }, (_, i) => file(`${i}.png`)), options);
  await vi.waitFor(() => expect(recognized).toHaveLength(3));
  expect(createRecognizer).toHaveBeenCalledTimes(3);
  pending.get("2.png")!();
  await vi.waitFor(() => expect(recognized).toHaveLength(4));
  expect(options.onResult.mock.calls[0][0]).toBe(2);
  // The first image stays slow while other workers keep draining the queue.
  for (let finished = 1; finished < 19; finished++) {
    const candidates = [...pending.keys()];
    const next = candidates.find(name => name !== "0.png") ?? candidates[0];
    pending.get(next)!();
    await vi.waitFor(() => expect(options.onResult).toHaveBeenCalledTimes(finished + 1));
  }
  await completion;
  expect(peak).toBe(3);
  expect(recognized).toHaveLength(19);
  expect(options.onResult.mock.calls.at(-1)?.[0]).toBe(0);
  workers.forEach(worker => expect(worker.terminate).toHaveBeenCalledTimes(1));
});

it("shares recognition for identical pending files and keeps the earliest selection as original", async () => {
  const finishes = new Map<string, (text: string) => void>();
  const recognize = vi.fn<TooltipRecognizer["recognize"]>().mockImplementation(image => new Promise(resolve => finishes.set(image.name, resolve)));
  const options = { ...callbacks(), createRecognizer: () => ({ recognize, terminate: vi.fn().mockResolvedValue(undefined) }) };
  const files = [file("first.png", "same"), file("copy.png", "same"), file("other.png")];
  const completion = recognizeBatch(files, options);
  await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(2));
  finishes.get("other.png")!("DEX +8");
  finishes.get("first.png")!("DEX +7");
  await completion;
  expect(options.onResult.mock.calls.map(([index]) => index)).toEqual([2, 0, 1]);
  expect(options.onResult.mock.calls[2][1]).toMatchObject({ ok: true, text: "DEX +7", duplicateOf: 0 });
  const copy = options.onResult.mock.calls[2][1];
  if (copy.ok) expect(copy.preview).toBe(files[1]);
});

it("aborts all running workers, drops late callbacks, and never starts queued images", async () => {
  const controller = new AbortController();
  const workers: TooltipRecognizer[] = [];
  const finishes: Array<() => void> = [];
  const options = { ...callbacks(controller.signal), createRecognizer: () => {
    const worker = {
      recognize: vi.fn<TooltipRecognizer["recognize"]>().mockImplementation((_image, callbacks) => new Promise(resolve => {
        finishes.push(() => { callbacks.onProgress({ status: "recognizing", progress: 1 }); resolve("DEX +2"); });
      })),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    workers.push(worker);
    return worker;
  } };
  const completion = recognizeBatch(Array.from({ length: 19 }, (_, i) => file(`${i}.png`)), options);
  await vi.waitFor(() => expect(workers).toHaveLength(3));
  controller.abort();
  await completion;
  finishes.forEach(finish => finish());
  await Promise.resolve();
  expect(options.onStart).toHaveBeenCalledTimes(3);
  expect(options.onProgress).not.toHaveBeenCalled();
  expect(options.onResult).not.toHaveBeenCalled();
  workers.forEach(worker => expect(worker.terminate).toHaveBeenCalledTimes(1));
});

it("continues after one image fails and releases the pool after completion", async () => {
  const terminate = vi.fn().mockResolvedValue(undefined);
  const recognize = vi.fn<TooltipRecognizer["recognize"]>().mockRejectedValueOnce(new Error("decode")).mockResolvedValue("DEX +8");
  const options = { ...callbacks(), concurrency: 1, createRecognizer: () => ({ recognize, terminate }) };
  await recognizeBatch([file("bad.png"), file("good.png")], options);
  expect(options.onResult.mock.calls.map(([, result]) => result.ok)).toEqual([false, true]);
  expect(terminate).toHaveBeenCalledTimes(1);
});
