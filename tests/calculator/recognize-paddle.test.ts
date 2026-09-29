import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { create, initialize, predict, dispose, prepareTooltip, requirementView, requirementVerificationView, verificationImages } = vi.hoisted(() => ({
  create: vi.fn(), initialize: vi.fn(), predict: vi.fn(), dispose: vi.fn(), prepareTooltip: vi.fn(), requirementView: vi.fn(), requirementVerificationView: vi.fn(),
  verificationImages: new WeakMap<File, { crop: { x: number; y: number; width: number; height: number }; scale: number; width: number; height: number }>(),
}));
vi.mock("@paddleocr/paddleocr-js", () => ({ PaddleOCR: { create } }));
vi.mock("@/features/calculator/ocr/prepareTooltip.client", () => ({ prepareTooltip }));
vi.mock("@/features/calculator/ocr/requirementView.client", () => ({ requirementView, requirementVerificationView,
  VERIFICATION_VIEWS: [{ scale: 2, mode: "color" }, { scale: 3, mode: "color" }, { scale: 2, mode: "luma" }, { scale: 3, mode: "luma" }],
  REQUIREMENT_VIEWS: [{ scale: 3, mode: "gray" }, { scale: 4, mode: "gray" }, { scale: 3, mode: "soft" }, { scale: 4, mode: "soft" }],
  RECOVERY_VIEWS: [{ scale: 3, mode: "gray" }, { scale: 4, mode: "gray" }, { scale: 3, mode: "luma" }, { scale: 4, mode: "luma" },
    { scale: 3, mode: "color" }, { scale: 4, mode: "color" }, { scale: 3, mode: "soft" }, { scale: 4, mode: "soft" }],
}));
vi.mock("@/features/calculator/ocr/enlargeTooltip.client", () => ({
  enlargeTooltip: async () => null,
  contrastTooltip: async (file: File) => file,
  tooltipImageSize: async (file: File) => file.name === "second-tooltip-view.png" ? { width: 200, height: 400 } : { width: 300, height: 600 },
}));
import { createPaddleTooltipRecognizer } from "@/features/calculator/ocr/recognizePaddle.client";
import { mapReviewedStats, reviewBlocked } from "@/features/calculator/ocr/reviewRecognition";
import type { OcrReview } from "@/features/calculator/ocr/types";

const file = () => new File(["private pixels"], "gear.png", { type: "image/png" });
const options = (signal = new AbortController().signal) => ({ signal, onProgress: vi.fn(), onReview: vi.fn(), onPrepared: vi.fn() });
const item = (text: string, y: number, scale: number) => ({ text, score: .99, poly: [[10, y], [200, y], [200, y + 14], [10, y + 14]].map(point => point.map(v => v * scale)) });
const verificationItems = (image: File, text: string) => {
  const view = verificationImages.get(image)!;
  const margin = 16 + 2 * view.scale, right = view.width - margin, bottom = view.height - margin;
  return [{ text, score: .8, poly: [[margin, margin], [right, margin], [right, bottom], [margin, bottom]] }];
};

beforeEach(() => {
  vi.resetAllMocks();
  initialize.mockResolvedValue({}); dispose.mockResolvedValue(undefined);
  create.mockResolvedValue({ initialize, predict, dispose });
  prepareTooltip.mockImplementation(async value => value);
  requirementView.mockResolvedValue(new File(["row pixels"], "requirement.png", { type: "image/png" }));
  requirementVerificationView.mockImplementation(async (_file, crop, view) => {
    const contentWidth = Math.round(crop.width * 300) * view.scale, contentHeight = Math.round(crop.height * 600) * view.scale;
    const file = new File(["original-region pixels"], `verified-${view.mode}-${view.scale}.png`, { type: "image/png" });
    verificationImages.set(file, { crop, scale: view.scale, width: contentWidth + 32, height: contentHeight + 32 });
    return { file, width: contentWidth + 32, height: contentHeight + 32, contentWidth, contentHeight, padding: 16, crop };
  });
  predict.mockImplementation(async (image: File) => {
    const scale = image.name === "second-tooltip-view.png" ? 2 / 3 : 1;
    return [{ items: [item("장비분류: 망토", 200, scale), item(".DEX: +13", 250, scale), item("DEX +7%", 330, scale), item("DEX +7%", 370, scale)] }];
  });
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 300, height: 600, close: vi.fn() }));
  vi.spyOn(document, "createElement").mockReturnValue({ width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }),
    toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["scaled pixels"], { type: "image/png" })),
  } as unknown as HTMLCanvasElement);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("uses local model assets and matches two distinct scales without adding duplicate options", async () => {
  const recognizer = createPaddleTooltipRecognizer({ experimentalRequirementRecovery: true }), callbacks = options();
  const text = await recognizer.recognize(file(), callbacks);
  expect(text).toContain("DEX +7%");
  const review: OcrReview = callbacks.onReview.mock.calls[0][0];
  expect(mapReviewedStats(review, "corsair")).toEqual({ mainFlat: "13", mainPercent: "14" });
  expect(reviewBlocked(review, "corsair")).toBe(false);
  expect(create.mock.calls[0][0]).toMatchObject({ initialize: false, worker: true, ortOptions: { backend: "wasm", numThreads: 1 } });
  expect(create.mock.calls[0][0].textRecognitionModelAsset.url).toBe(`${location.origin}/ocr/paddle/models/rec-ko.tar`);
  expect(predict.mock.calls[0][0]).not.toBe(predict.mock.calls[1][0]);
  await recognizer.recognize(file(), options());
  expect(create).toHaveBeenCalledTimes(1);
  await recognizer.terminate(); await recognizer.terminate();
  expect(dispose).toHaveBeenCalledTimes(1);
});

it("rejects unsupported images before creating a model worker", async () => {
  await expect(createPaddleTooltipRecognizer({ experimentalRequirementRecovery: true }).recognize(new File(["image"], "a.gif", { type: "image/gif" }), options()))
    .rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
  expect(create).not.toHaveBeenCalled();
});

it("disposes during initialization and drops late results on cancellation", async () => {
  let finish!: () => void;
  initialize.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const recognizer = createPaddleTooltipRecognizer({ experimentalRequirementRecovery: true }), controller = new AbortController(), callbacks = options(controller.signal);
  const result = recognizer.recognize(file(), callbacks);
  const rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
  controller.abort(); await rejection; finish();
  await Promise.resolve();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(predict).not.toHaveBeenCalled();
  expect(callbacks.onReview).not.toHaveBeenCalled();
});

it("recovers with a fresh worker after an initialization failure", async () => {
  initialize.mockRejectedValueOnce(new Error("model unavailable"));
  const recognizer = createPaddleTooltipRecognizer({ experimentalRequirementRecovery: true });
  await expect(recognizer.recognize(file(), options())).rejects.toMatchObject({ code: "OCR_UNAVAILABLE" });
  expect(dispose).toHaveBeenCalledTimes(1);
  await expect(recognizer.recognize(file(), options())).resolves.toContain("DEX +7%");
  expect(create).toHaveBeenCalledTimes(2);
  await recognizer.terminate();
});

it("reuses the existing model and examines every requirement in all four original-region views", async () => {
  predict.mockImplementation(async (image: File) => {
    if (verificationImages.has(image)) return [{ items: verificationItems(image, verificationImages.get(image)!.crop.y < .12 ? "REQ LEV:80" : "REQ STR:80") }];
    const scale = image.name === "second-tooltip-view.png" ? 2 / 3 : 1;
    return [{ items: [item("시험 장비", 10, scale), item("(유니크 아이템)", 30, scale), item("REQ LEV:BQ", 60, scale), item("REQ STR:80", 90, scale), item("DEX +3", 250, scale)] }];
  });
  const recognizer = createPaddleTooltipRecognizer({ experimentalRequirementRecovery: true }), callbacks = options();
  await recognizer.recognize(file(), callbacks);
  expect(predict).toHaveBeenCalledTimes(10);
  expect(requirementVerificationView).toHaveBeenCalledTimes(8);
  expect(requirementView).not.toHaveBeenCalled();
  expect(requirementVerificationView.mock.calls.map(call => [call[2].mode, call[2].scale])).toEqual([
    ["color", 2], ["color", 3], ["luma", 2], ["luma", 3], ["color", 2], ["color", 3], ["luma", 2], ["luma", 3],
  ]);
  expect(mapReviewedStats(callbacks.onReview.mock.calls[0][0], "corsair")).toEqual({ requiredLevel: "80", requiredSub: "80", mainFlat: "3" });
  expect(create).toHaveBeenCalledTimes(1);
  await recognizer.terminate();
});

it("keeps primary evidence if a local requirement reread fails", async () => {
  predict.mockImplementation(async (image: File) => {
    if (verificationImages.has(image)) throw new Error("retry failed");
    const scale = image.name === "second-tooltip-view.png" ? 2 / 3 : 1;
    return [{ items: [item("REQ STR:Q", 60, scale), item("DEX +3", 250, scale)] }];
  });
  const recognizer = createPaddleTooltipRecognizer({ experimentalRequirementRecovery: true }), callbacks = options();
  await recognizer.recognize(file(), callbacks);
  const review = callbacks.onReview.mock.calls[0][0];
  expect(mapReviewedStats(review, "corsair")).toEqual({ mainFlat: "3" });
  expect(reviewBlocked(review, "corsair")).toBe(true);
  await recognizer.terminate();
});

it("rejects cancellation during a reread and never publishes its late result", async () => {
  let finish!: (value: unknown) => void;
  predict.mockImplementation(async (image: File) => {
    if (verificationImages.has(image)) return new Promise(resolve => { finish = resolve; });
    const scale = image.name === "second-tooltip-view.png" ? 2 / 3 : 1;
    return [{ items: [item("REQ STR:Q", 60, scale)] }];
  });
  const recognizer = createPaddleTooltipRecognizer({ experimentalRequirementRecovery: true }), controller = new AbortController(), callbacks = options(controller.signal);
  const pending = recognizer.recognize(file(), callbacks);
  const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(predict).toHaveBeenCalledTimes(3));
  controller.abort(); await rejection;
  finish([{ items: [item("REQ STR:0", 60, 1)] }]);
  await Promise.resolve();
  expect(callbacks.onReview).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(1);
});

it("rereads a detached requirement digit inside an expanded crop without asking for a correction", async () => {
  const fragment = (text: string, x: number, y: number, width: number, scale: number) => ({ text, score: .95,
    poly: [[x, y], [x + width, y], [x + width, y + 14], [x, y + 14]].map(point => point.map(value => value * scale)) });
  predict.mockImplementation(async (image: File) => {
    if (verificationImages.has(image)) return [{ items: verificationItems(image, verificationImages.get(image)!.crop.y < .12 ? "REQ LEV:15" : "REQ STR:0") }];
    const scale = image.name === "second-tooltip-view.png" ? 2 / 3 : 1;
    return [{ items: [item("시험 장비", 10, scale), item("(일반 아이템)", 30, scale),
      fragment("REQ LEV:15", 112, 60, 80, scale), fragment("REQ STR:", 112, 90, 54, scale), fragment("[", 180, 91, 10, scale),
      item("장비분류:어깨장식", 200, scale), item("공격력:+5", 250, scale)] }];
  });
  const recognizer = createPaddleTooltipRecognizer({ experimentalRequirementRecovery: true }), callbacks = options();
  await recognizer.recognize(file(), callbacks);
  const bounds = requirementVerificationView.mock.calls[4][1];
  expect((bounds.x + bounds.width) * 300).toBeGreaterThanOrEqual(190);
  const review = callbacks.onReview.mock.calls[0][0];
  expect(mapReviewedStats(review, "corsair")).toEqual({ requiredLevel: "15", requiredSub: "0", attackFlat: "5" });
  expect(reviewBlocked(review, "corsair")).toBe(false);
  await recognizer.terminate();
});

it("automatically tries luminance-preserving views when a combat value is missing", async () => {
  requirementView.mockImplementation(async (_file, _bounds, view) => new File(["row"], `${view.mode}.png`, { type: "image/png" }));
  predict.mockImplementation(async (image: File) => {
    if (image.name === "gray.png") return [{ items: [item("공격력:Q", 10, 1)] }];
    if (image.name === "luma.png") return [{ items: [item("공격력:+9", 10, 1)] }];
    const scale = image.name === "second-tooltip-view.png" ? 2 / 3 : 1;
    return [{ items: [item("장비분류:장갑", 200, scale), item("공격력:", 250, scale)] }];
  });
  const recognizer = createPaddleTooltipRecognizer({ experimentalRequirementRecovery: true }), callbacks = options();
  await recognizer.recognize(file(), callbacks);
  expect(requirementView.mock.calls.map(call => call[2].mode)).toEqual(["gray", "gray", "luma", "luma"]);
  expect(mapReviewedStats(callbacks.onReview.mock.calls[0][0], "corsair")).toEqual({ attackFlat: "9" });
  expect(reviewBlocked(callbacks.onReview.mock.calls[0][0], "corsair")).toBe(false);
  expect(create).toHaveBeenCalledTimes(1);
  await recognizer.terminate();
});

it("recovers a colored title in two source views without importing header numbers as equipment stats", async () => {
  requirementView.mockImplementation(async (_file, _bounds, view) => new File(["header"], `${view.mode}.png`, { type: "image/png" }));
  predict.mockImplementation(async (image: File) => {
    if (verificationImages.has(image)) return [{ items: verificationItems(image, verificationImages.get(image)!.crop.y < .17 ? "REQ LEV:15" : "REQ STR:0") }];
    if (image.name === "color.png") return [{ items: [item("달 토끼 견장 (+1)", 10, 1), item("잠재능력 설정 불가", 30, 1), item("DEX:+999", 50, 1)] }];
    const scale = image.name === "second-tooltip-view.png" ? 2 / 3 : 1;
    return [{ items: [item("REQ LEV:15", 90, scale), item("REQ STR:0", 120, scale), item("장비분류:어깨장식", 200, scale), item("공격력:+5", 250, scale)] }];
  });
  const recognizer = createPaddleTooltipRecognizer({ experimentalRequirementRecovery: true }), callbacks = options();
  const text = await recognizer.recognize(file(), callbacks);
  const review = callbacks.onReview.mock.calls[0][0];
  expect(text).toContain("달 토끼 견장 (+1)\n잠재능력 설정 불가");
  expect(mapReviewedStats(review, "corsair")).toEqual({ requiredLevel: "15", requiredSub: "0", attackFlat: "5" });
  expect(review.header.readings).toHaveLength(2);
  await recognizer.terminate();
});

it("keeps completed stats when header recovery fails", async () => {
  predict.mockImplementation(async (image: File) => {
    if (verificationImages.has(image)) return [{ items: verificationItems(image, "REQ LEV:15") }];
    if (image.name === "requirement.png") throw new Error("optional header failed");
    const scale = image.name === "second-tooltip-view.png" ? 2 / 3 : 1;
    return [{ items: [item("REQ LEV:15", 90, scale), item("공격력:+5", 250, scale)] }];
  });
  const recognizer = createPaddleTooltipRecognizer({ experimentalRequirementRecovery: true }), callbacks = options();
  await recognizer.recognize(file(), callbacks);
  expect(mapReviewedStats(callbacks.onReview.mock.calls[0][0], "corsair")).toEqual({ requiredLevel: "15", attackFlat: "5" });
  expect(callbacks.onReview.mock.calls[0][0].header).toBeUndefined();
  await recognizer.terminate();
});

it.each(["empty", "non-numeric", "conflicting", "ambiguous"])("examines the fourth requirement view when it is %s", async last => {
  predict.mockImplementation(async (image: File) => {
    if (verificationImages.has(image)) {
      const text = image.name === "verified-luma-3.png"
        ? last === "non-numeric" ? "REQ STR:Q" : last === "conflicting" ? "REQ STR:60" : last === "ambiguous" ? "REQ STR:17 60" : ""
        : "REQ STR:17";
      return [{ items: text ? verificationItems(image, text) : [] }];
    }
    const scale = image.name === "second-tooltip-view.png" ? 2 / 3 : 1;
    return [{ items: [item("시험 장비", 10, scale), item("(일반 아이템)", 30, scale), item("REQ STR:60", 90, scale), item("공격력:+5", 250, scale)] }];
  });
  const recognizer = createPaddleTooltipRecognizer({ experimentalRequirementRecovery: true }), callbacks = options();
  const text = await recognizer.recognize(file(), callbacks);
  const review = callbacks.onReview.mock.calls[0][0];
  expect(requirementVerificationView).toHaveBeenCalledTimes(4);
  expect(predict).toHaveBeenCalledTimes(6);
  const verified = last === "empty" || last === "non-numeric";
  expect(reviewBlocked(review, "corsair")).toBe(!verified);
  expect(mapReviewedStats(review, "corsair")).toEqual({ ...(verified ? { requiredSub: "17" } : {}), attackFlat: "5" });
  expect(text).toContain(verified ? "REQ STR : 17" : "REQ STR:60");
  expect(review.lines.find((line: { recovery?: unknown }) => line.recovery).recovery.observations).toHaveLength(4);
  await recognizer.terminate();
});

it("keeps separate operation provenance for repeated requests using the same image and worker", async () => {
  predict.mockImplementation(async (image: File) => {
    if (verificationImages.has(image)) return [{ items: verificationItems(image, "REQ STR:17") }];
    const scale = image.name === "second-tooltip-view.png" ? 2 / 3 : 1;
    return [{ items: [item("시험 장비", 10, scale), item("(일반 아이템)", 30, scale), item("REQ STR:60", 90, scale)] }];
  });
  const recognizer = createPaddleTooltipRecognizer({ experimentalRequirementRecovery: true }), source = file(), first = options(), second = options();
  await Promise.all([recognizer.recognize(source, first), recognizer.recognize(source, second)]);
  const firstTarget = first.onReview.mock.calls[0][0].lines.find((line: { recovery?: unknown }) => line.recovery).recovery.target;
  const secondTarget = second.onReview.mock.calls[0][0].lines.find((line: { recovery?: unknown }) => line.recovery).recovery.target;
  expect(firstTarget.sourceId).toBe(secondTarget.sourceId);
  expect(firstTarget.operationId).not.toBe(secondTarget.operationId);
  expect(create).toHaveBeenCalledTimes(1);
  await recognizer.terminate();
});

it("retains a numeric verification fragment with missing geometry instead of treating it as an empty vote", async () => {
  predict.mockImplementation(async (image: File) => {
    if (verificationImages.has(image)) return [{ items: image.name === "verified-luma-3.png"
      ? [{ text: "REQ STR:60", score: .99, poly: [] }]
      : verificationItems(image, "REQ STR:17") }];
    const scale = image.name === "second-tooltip-view.png" ? 2 / 3 : 1;
    return [{ items: [item("시험 장비", 10, scale), item("(일반 아이템)", 30, scale), item("REQ STR:60", 90, scale)] }];
  });
  const recognizer = createPaddleTooltipRecognizer({ experimentalRequirementRecovery: true }), callbacks = options();
  await recognizer.recognize(file(), callbacks);
  const review = callbacks.onReview.mock.calls[0][0];
  expect(reviewBlocked(review, "corsair")).toBe(true);
  expect(mapReviewedStats(review, "corsair")).toEqual({});
  expect(review.lines.find((line: { recovery?: unknown }) => line.recovery).recovery.observations[3].readings[0])
    .toMatchObject({ text: "REQ STR:60", provenance: { role: "verification" } });
  await recognizer.terminate();
});

it("defaults to D-150 requirement retries and does not activate the unpassed candidate verifier", async () => {
  predict.mockImplementation(async (image: File) => {
    if (image.name === "requirement.png") return [{ items: [item("REQ LEV:80", 60, 1)] }];
    const scale = image.name === "second-tooltip-view.png" ? 2 / 3 : 1;
    return [{ items: [item("시험 장비", 10, scale), item("(일반 아이템)", 30, scale),
      item("REQ LEV:BQ", 60, scale), item("REQ STR:80", 90, scale), item("DEX +3", 250, scale)] }];
  });
  const recognizer = createPaddleTooltipRecognizer(), callbacks = options();
  await recognizer.recognize(file(), callbacks);
  expect(predict).toHaveBeenCalledTimes(4);
  expect(requirementView).toHaveBeenCalledTimes(2);
  expect(requirementVerificationView).not.toHaveBeenCalled();
  const review = callbacks.onReview.mock.calls[0][0];
  expect(mapReviewedStats(review, "corsair")).toEqual({ requiredLevel: "80", requiredSub: "80", mainFlat: "3" });
  expect(review.lines.every((line: { recovery?: unknown }) => !line.recovery)).toBe(true);
  await recognizer.terminate();
});

it("preserves D-150 discovery conflicts by default instead of superseding them with experimental evidence", async () => {
  predict.mockImplementation(async (image: File) => {
    if (image.name === "requirement.png") return [{ items: [item("REQ STR:80", 90, 1)] }];
    const second = image.name === "second-tooltip-view.png", scale = second ? 2 / 3 : 1;
    return [{ items: [item("시험 장비", 10, scale), item("(일반 아이템)", 30, scale), item(second ? "REQ STR:80" : "REQ STR:60", 90, scale)] }];
  });
  const recognizer = createPaddleTooltipRecognizer({ experimentalRequirementRecovery: false }), callbacks = options();
  await recognizer.recognize(file(), callbacks);
  const review = callbacks.onReview.mock.calls[0][0];
  expect(reviewBlocked(review, "corsair")).toBe(true); expect(mapReviewedStats(review, "corsair")).toEqual({});
  expect(requirementView).toHaveBeenCalledTimes(8);
  expect(requirementVerificationView).not.toHaveBeenCalled();
  expect(review.lines[2].readings.some((reading: { text: string }) => reading.text === "REQ STR:60")).toBe(true);
  await recognizer.terminate();
});
