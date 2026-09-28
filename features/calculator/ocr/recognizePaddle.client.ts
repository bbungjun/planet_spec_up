"use client";

import { prepareTooltip } from "./prepareTooltip.client";
import { contrastTooltip, enlargeTooltip, tooltipImageSize } from "./enlargeTooltip.client";
import { buildOcrReview, reviewText } from "./reviewRecognition";
import { isKnownEquipmentCategory, parseMapleTooltip, readTooltipRequirement } from "./parseMapleTooltip";
import { isSupportedTooltipImage, MAX_TOOLTIP_IMAGE_BYTES, toRecognitionError, type TooltipRecognizer } from "./recognizeTooltip.client";
import type { OcrBounds, OcrReading } from "./types";
import { RECOVERY_VIEWS, requirementView } from "./requirementView.client";
import { mergeRecognitionRetry, retryRecognitionBounds, retryRecognitionLabel } from "./retryRecognition";
import { tooltipHeader } from "./tooltipHeader";

type Item = { text: string; score: number; poly: number[][] };
type Engine = { initialize(): Promise<unknown>; predict(input: File): Promise<Array<{ items: Item[] }>>; dispose(): Promise<void> };
type Options = Parameters<TooltipRecognizer["recognize"]>[1];
const abortError = () => new DOMException("Cancelled", "AbortError");

export function paddleReadings(items: Item[], width: number, height: number, pass: number): OcrReading[] {
  return items.filter(item => item.text.trim() && item.poly.length >= 4 && item.poly.every(point => point.length >= 2 && point.every(Number.isFinite)))
    .map(item => {
      const xs = item.poly.map(point => point[0]), ys = item.poly.map(point => point[1]);
      return { text: item.text, confidence: Number.isFinite(item.score) ? item.score * 100 : undefined, pass,
        bounds: { x: Math.min(...xs) / width, y: Math.min(...ys) / height, width: (Math.max(...xs) - Math.min(...xs)) / width, height: (Math.max(...ys) - Math.min(...ys)) / height } };
    });
}

async function smallerView(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * 2 / 3));
    canvas.height = Math.max(1, Math.round(bitmap.height * 2 / 3));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Image resize failed");
    return new File([blob], "second-tooltip-view.png", { type: "image/png" });
  } finally { bitmap.close(); }
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError();
  return new Promise<T>((resolve, reject) => {
    const cancel = () => { signal.removeEventListener("abort", cancel); reject(abortError()); };
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(value => { signal.removeEventListener("abort", cancel); resolve(value); }, error => { signal.removeEventListener("abort", cancel); reject(error); });
  });
}

export function createPaddleTooltipRecognizer(): TooltipRecognizer {
  let engine: Engine | undefined;
  let initializing: Promise<Engine> | undefined;
  let generation = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const terminate = async () => {
    generation += 1;
    const current = engine;
    engine = undefined;
    initializing = undefined;
    await current?.dispose().catch(() => undefined);
  };
  const ensure = (version: number) => {
    initializing ??= (async () => {
      const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
      if (generation !== version) throw abortError();
      const base = new URL("/ocr/paddle/", location.href);
      const created = await PaddleOCR.create({ initialize: false, worker: true,
        textDetectionModelName: "PP-OCRv5_mobile_det", textDetectionModelAsset: { url: new URL("models/det.tar", base).href },
        textRecognitionModelName: "korean_PP-OCRv5_mobile_rec", textRecognitionModelAsset: { url: new URL("models/rec-ko.tar", base).href },
        textRecognitionBatchSize: 6,
        ortOptions: { backend: "wasm", wasmPaths: new URL("ort/", base).href, numThreads: 1, simd: true },
      });
      if (generation !== version) { await created.dispose(); throw abortError(); }
      engine = created;
      await created.initialize();
      if (generation !== version) throw abortError();
      return created;
    })().catch(error => {
      if (generation !== version || (error instanceof DOMException && error.name === "AbortError")) throw error;
      throw { code: "OCR_UNAVAILABLE", retryable: true };
    });
    return initializing;
  };
  const run = async (file: File, options: Options, version: number): Promise<string> => {
    const { signal } = options;
    const active = () => { if (signal.aborted || generation !== version) throw abortError(); };
    active();
    if (!isSupportedTooltipImage(file)) throw { code: "UNSUPPORTED_FILE", retryable: false };
    if (file.size > MAX_TOOLTIP_IMAGE_BYTES) throw { code: "FILE_TOO_LARGE", retryable: false };
    const cancel = () => { if (generation === version) void terminate(); };
    signal.addEventListener("abort", cancel, { once: true });
    const progress = (status: "loading" | "recognizing", value: number) => { active(); options.onProgress({ status, progress: value }); };
    try {
      progress("loading", 0);
      let prepared: File;
      let warnings: string[] = [];
      try { prepared = await withAbort(prepareTooltip(file, { signal, region: options.region, onWarnings: value => { warnings = value; } }), signal); }
      catch (error) {
        const ambiguous = error as { code?: string; regions?: OcrBounds[] };
        if (ambiguous.code !== "MULTIPLE_TOOLTIPS" || !ambiguous.regions?.length || options.region) throw error;
        const current = await withAbort(ensure(version), signal);
        const matches: Array<{ file: File; warnings: string[] }> = [];
        for (const region of ambiguous.regions.slice(0, 4)) {
          active();
          let candidateWarnings: string[] = [];
          const candidate = await withAbort(prepareTooltip(file, { signal, region, onWarnings: value => { candidateWarnings = value; } }), signal);
          const view = await contrastTooltip(await enlargeTooltip(candidate, 3) ?? candidate);
          active();
          const [result] = await withAbort(current.predict(view), signal);
          const parsed = parseMapleTooltip(result.items.map(item => item.text).join("\n"));
          if (parsed.category && isKnownEquipmentCategory(parsed.category) && parsed.options.length >= 2) matches.push({ file: candidate, warnings: candidateWarnings });
        }
        if (matches.length !== 1) throw { code: matches.length ? "MULTIPLE_TOOLTIPS" : "TOOLTIP_NOT_FOUND", retryable: false };
        prepared = matches[0].file; warnings = matches[0].warnings;
      }
      active(); options.onPrepared?.(prepared);
      const current = await withAbort(ensure(version), signal);
      const first = await enlargeTooltip(prepared, options.enhance ? 4 : 3) ?? prepared;
      active();
      const second = await smallerView(first);
      const readings: OcrReading[] = [];
      for (const [pass, image] of [first, second].entries()) {
        progress("recognizing", .15 + pass * .4);
        const view = await contrastTooltip(image), dimensions = await tooltipImageSize(view);
        active();
        if (!dimensions) throw new Error("Cannot read image dimensions");
        const [result] = await withAbort(current.predict(view), signal);
        active(); readings.push(...paddleReadings(result.items, dimensions.width, dimensions.height, pass));
      }
      let review = buildOcrReview(readings, warnings);
      const targets = review.lines.filter(line => retryRecognitionLabel(line)).slice(0, 12);
      retryTargets: for (const [index, target] of targets.entries()) {
        progress("recognizing", .75 + .23 * index / targets.length);
        const bounds = retryRecognitionBounds(review, target);
        if (!bounds) continue;
        for (const [pass, view] of RECOVERY_VIEWS.entries()) {
          const line = review.lines.find(line => line.id === target.id)!;
          if (!retryRecognitionLabel(line)) break;
          try {
            const image = await requirementView(prepared, bounds, view);
            active();
            if (!image) continue;
            const [result] = await withAbort(current.predict(image), signal);
            active();
            const text = result.items.map(item => item.text).join(" ");
            review = mergeRecognitionRetry(review, target.id, text, pass + 2);
          } catch {
            // Keep the successful primary reading if an optional reread fails.
            // Cancellation still rejects the whole operation and drops late results.
            active();
            break retryTargets;
          }
        }
      }
      // The white-text mask can erase colored titles entirely. Recover only
      // the header, without feeding background text into the equipment stats.
      if (!tooltipHeader(reviewText(review))) {
        const topOfRequirements = Math.min(...review.lines.filter(line => line.bounds && line.readings.some(reading => readTooltipRequirement(reading.text)))
          .map(line => line.bounds!.y));
        if (Number.isFinite(topOfRequirements) && topOfRequirements > .04) {
          const bounds = { x: 0, y: 0, width: 1, height: Math.min(.45, topOfRequirements) };
          const headers: Array<{ header: NonNullable<ReturnType<typeof tooltipHeader>>; reading: OcrReading }> = [];
          for (const [pass, scale] of [3, 2].entries()) {
            try {
              const image = await requirementView(prepared, bounds, { mode: "color", scale });
              active();
              if (!image) break;
              const [result] = await withAbort(current.predict(image), signal);
              active();
              const text = result.items.map(item => item.text).join("\n"), header = tooltipHeader(text);
              if (header) headers.push({ header, reading: { text, pass: 20 + pass, bounds } });
            } catch { active(); break; }
          }
          if (headers.length === 2 && headers[0].header.name.replace(/\s/g, "") === headers[1].header.name.replace(/\s/g, "")
            && headers[0].header.marker.replace(/\s/g, "") === headers[1].header.marker.replace(/\s/g, "")) {
            review = { ...review, header: { ...headers[0].header, readings: headers.map(value => value.reading) } };
          }
        }
      }
      active(); options.onReview?.(review);
      progress("recognizing", 1);
      return reviewText(review);
    } catch (error) {
      const cancelled = signal.aborted || generation !== version;
      if (generation === version) await terminate();
      if (cancelled) throw abortError();
      throw toRecognitionError(error);
    } finally { signal.removeEventListener("abort", cancel); }
  };
  return {
    recognize(file, options) {
      const version = generation;
      const pending = queue.then(() => run(file, options, version));
      queue = pending.catch(() => undefined);
      return pending;
    },
    terminate,
  };
}
