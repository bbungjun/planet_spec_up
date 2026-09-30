"use client";

/**
 * 현재 장비/구매 후보 화면의 기본 PaddleOCR 판독 파이프라인.
 * 설명창 분리·후보 구조 검사/원색 fallback → 두 크기의 확대·반전 판독 → 줄별 재시도 → 제목 복구 시도 → 공통 검토 결과 순으로 실행한다.
 */

import { prepareTooltip } from "./prepareTooltip.client";
import { contrastTooltip, enlargeTooltip, tooltipImageSize } from "./enlargeTooltip.client";
import { applyRequirementRecovery, buildOcrReview, reviewText } from "./reviewRecognition";
import { readTooltipRequirement } from "./parseMapleTooltip";
import { isSupportedTooltipImage, MAX_TOOLTIP_IMAGE_BYTES, toRecognitionError, type TooltipRecognizer } from "./recognizeTooltip.client";
import type { OcrBounds, OcrReading, RequirementObservation } from "./types";
import { RECOVERY_VIEWS, VERIFICATION_VIEWS, requirementVerificationView, requirementView } from "./requirementView.client";
import { mergeRecognitionRetry, retryRecognitionBounds, retryRecognitionLabel } from "./retryRecognition";
import { identifiedRequirementLabel, locateRequirementVerification } from "./retryRequirements";
import { tooltipHeader } from "./tooltipHeader";
import { assessTooltipCandidate, distinctCompleteCandidates, sameCandidateRegion, type TooltipCandidateAssessment } from "./tooltipCandidate";
import type { TooltipCandidateRegions } from "./prepareTooltipImage";

type Item = { text: string; score: number; poly: number[][] };
type Engine = { initialize(): Promise<unknown>; predict(input: File): Promise<Array<{ items: Item[] }>>; dispose(): Promise<void> };
type Options = Parameters<TooltipRecognizer["recognize"]>[1];
const abortError = () => new DOMException("Cancelled", "AbortError");
const sourceIds = new WeakMap<File, string>();
let nextSource = 0, nextOperation = 0;
/**
 * File 객체에 안정적인 출처 ID를, 인식 호출마다 새로운 작업 ID를 부여한다.
 * 실험 검증 증거가 다른 사진·다른 호출과 섞이지 않게 하는 식별자이며 파일 바이트 해시는 아니다.
 */
function sourceIdentity(file: File) {
  let sourceId = sourceIds.get(file);
  if (!sourceId) { sourceId = `image-${++nextSource}`; sourceIds.set(file, sourceId); }
  return { sourceId, operationId: `recognition-${++nextOperation}` };
}

/**
 * Paddle의 텍스트·신뢰도·다각형을 공통 줄 판독 형식으로 바꾼다.
 * 유효한 다각형만 해당 판독 이미지의 폭·높이로 정규화하고 판독 회차를 유지한다.
 */
export function paddleReadings(items: Item[], width: number, height: number, pass: number): OcrReading[] {
  return items.filter(item => item.text.trim() && item.poly.length >= 4 && item.poly.every(point => point.length >= 2 && point.every(Number.isFinite)))
    .map(item => {
      const xs = item.poly.map(point => point[0]), ys = item.poly.map(point => point[1]);
      return { text: item.text, confidence: Number.isFinite(item.score) ? item.score * 100 : undefined, pass,
        bounds: { x: Math.min(...xs) / width, y: Math.min(...ys) / height, width: (Math.max(...xs) - Math.min(...xs)) / width, height: (Math.max(...ys) - Math.min(...ys)) / height } };
    });
}

/**
 * 첫 확대 이미지의 가로·세로를 각각 2/3로 줄여 두 번째 판독 이미지를 만든다.
 * 작은 설명창에서 보통 3배/2배가 되지만, 모든 이미지가 항상 이 두 배율인 것은 아니다.
 */
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

/**
 * 취소 신호가 오면 비동기 작업을 기다리는 호출을 즉시 거절한다.
 * 실제 엔진 자원 종료는 별도의 취소 리스너/terminate가 담당한다.
 */
async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError();
  return new Promise<T>((resolve, reject) => {
    const cancel = () => { signal.removeEventListener("abort", cancel); reject(abortError()); };
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(value => { signal.removeEventListener("abort", cancel); resolve(value); }, error => { signal.removeEventListener("abort", cancel); reject(error); });
  });
}

/**
 * 지연 초기화한 한국어 PP-OCRv5/WASM 인식기를 생성하고 같은 인식기의 호출을 직렬화한다.
 * 기본 경로는 기존 줄별 재시도를 사용한다. experimentalRequirementRecovery=true인 개발/시험 호출만 별도의 원본 요구 조건 검증을 사용하며, 실이미지 활성화 기준은 통과하지 못한 상태다.
 */
export function createPaddleTooltipRecognizer(configuration: { experimentalRequirementRecovery?: boolean } = {}): TooltipRecognizer {
  const experimentalRequirementRecovery = configuration.experimentalRequirementRecovery === true;
  let engine: Engine | undefined;
  let initializing: Promise<Engine> | undefined;
  let generation = 0;
  let queue: Promise<unknown> = Promise.resolve();
  // 세대를 바꾸면 초기화 중인 엔진과 대기 중 작업도 현재 작업의 결과로 채택되지 않는다.
  const terminate = async () => {
    generation += 1;
    const current = engine;
    engine = undefined;
    initializing = undefined;
    await current?.dispose().catch(() => undefined);
  };
  // 첫 호출에서만 모델을 준비하고 같은 초기화 Promise를 재사용한다. 이미지 인식은 브라우저 WASM에서 실행한다.
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
  const run = async (file: File, options: Options, version: number, identity: ReturnType<typeof sourceIdentity>): Promise<string> => {
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
      let prepared: File | undefined;
      let warnings: string[] = [];
      let candidates: TooltipCandidateRegions | undefined;
      let cachedFirst: { items: Item[]; width: number; height: number } | undefined;
      try { prepared = await withAbort(prepareTooltip(file, { signal, region: options.region, onWarnings: value => { warnings = value; }, onCandidates: value => { candidates = value; } }), signal); }
      catch (error) {
        const ambiguous = error as { code?: string; regions?: OcrBounds[] };
        if (ambiguous.code !== "MULTIPLE_TOOLTIPS" || !ambiguous.regions?.length || options.region) throw error;
        candidates ??= { regions: ambiguous.regions, selected: null };
      }
      // 픽셀 탐지에서 하나로 보인 자동 후보도 구조를 검사한다. 직접 지정/작은 캡처는 기존 검토 경로를 유지한다.
      if (!options.region && candidates?.regions.length) {
        const current = await withAbort(ensure(version), signal);
        const matches: Array<{ file: File; warnings: string[]; region: OcrBounds; assessment: TooltipCandidateAssessment; first: { items: Item[]; width: number; height: number } }> = [];
        const regions = [...(candidates.selected ? [candidates.selected] : []), ...candidates.regions].slice(0, 4);
        for (const [index, region] of regions.entries()) {
          active();
          if (matches.some(match => sameCandidateRegion(match.region, region))) continue;
          let candidateWarnings: string[] = [];
          const candidate = candidates.selected === region && prepared ? prepared
            : await withAbort(prepareTooltip(file, { signal, region, onWarnings: value => { candidateWarnings = value; } }), signal);
          if (candidates.selected === region) candidateWarnings = warnings;
          const enlarged = await enlargeTooltip(candidate, 3) ?? candidate;
          const view = await contrastTooltip(enlarged), dimensions = await tooltipImageSize(view);
          active();
          if (!dimensions) continue;
          progress("recognizing", .05 + index * .03);
          const [result] = await withAbort(current.predict(view), signal);
          active();
          let assessment = assessTooltipCandidate(paddleReadings(result.items, dimensions.width, dimensions.height, 0), dimensions);
          if (assessment.status === "retry-color") {
            // 마스크에서 잃은 구조만 원래 색상으로 확인한다. 잘못된 숫자를 이 판독으로 덮어쓰지 않는다.
            const colorSize = await tooltipImageSize(enlarged);
            active();
            if (!colorSize) continue;
            const [colorResult] = await withAbort(current.predict(enlarged), signal);
            active();
            assessment = assessTooltipCandidate(paddleReadings(colorResult.items, colorSize.width, colorSize.height, 1), colorSize, "color");
          }
          if (assessment.status === "complete") matches.push({ file: candidate, warnings: candidateWarnings, region, assessment,
            first: { items: result.items, ...dimensions } });
        }
        const distinct = distinctCompleteCandidates(matches);
        if (distinct.length !== 1) throw { code: distinct.length ? "MULTIPLE_TOOLTIPS" : "TOOLTIP_NOT_FOUND", retryable: false };
        prepared = distinct[0].file; warnings = distinct[0].warnings;
        if (!options.enhance) cachedFirst = distinct[0].first;
      }
      if (!prepared) throw { code: "TOOLTIP_NOT_FOUND", retryable: false };
      active(); options.onPrepared?.(prepared);
      const current = await withAbort(ensure(version), signal);
      // 기본 경로도 대비 보정을 수행한다. enhance는 작은 이미지의 확대 상한만 3배에서 4배로 바꾼다.
      const first = await enlargeTooltip(prepared, options.enhance ? 4 : 3) ?? prepared;
      active();
      const second = await smallerView(first);
      const readings: OcrReading[] = [];
      for (const [pass, image] of [first, second].entries()) {
        progress("recognizing", .15 + pass * .4);
        const view = await contrastTooltip(image), dimensions = await tooltipImageSize(view);
        active();
        if (!dimensions) throw new Error("Cannot read image dimensions");
        const [result] = pass === 0 && cachedFirst && cachedFirst.width === dimensions.width && cachedFirst.height === dimensions.height
          ? [{ items: cachedFirst.items }] : await withAbort(current.predict(view), signal);
        active(); readings.push(...paddleReadings(result.items, dimensions.width, dimensions.height, pass).map((reading, index) => ({ ...reading,
          provenance: { ...identity, role: "discovery" as const, viewId: `discovery-${pass}`, readingId: `${identity.operationId}-discovery-${pass}-${index}` } })));
      }
      let review = buildOcrReview(readings, warnings);
      // 기본 UI는 이 분기를 켜지 않는다. 기본 판독과 달리 원본 행 출처·완전성·변환 다양성을 추가 검증한다.
      if (experimentalRequirementRecovery) {
        const preparedSize = await tooltipImageSize(prepared);
        active();
        if (!preparedSize) throw new Error("Cannot read original image dimensions");
        const requirements = locateRequirementVerification(review, identity, preparedSize);
        for (const [index, target] of requirements.entries()) {
          const observations: RequirementObservation[] = [];
          if (target.complete) for (const [pass, view] of VERIFICATION_VIEWS.entries()) {
            progress("recognizing", .72 + .12 * (index + pass / 4) / requirements.length);
            const viewId = `${identity.operationId}-${target.rowId}-${view.mode}-${view.scale}`;
            const observation: RequirementObservation = { ...identity, field: target.field, rowId: target.rowId, viewId,
              mode: view.mode, scale: view.scale, crop: target.crop, readings: [] };
            observations.push(observation);
            try {
              const image = await requirementVerificationView(prepared, target.crop, view);
              active();
              if (!image) { observation.failure = "unavailable-verification-view"; continue; }
              observation.crop = image.crop;
              // 인공 여백까지 포함한 표시 범위를 원본 좌표로 환산한다. 여백 밖/다른 행의 증거는 검증에 쓰지 않는다.
              observation.renderBounds = {
                x: image.crop.x - image.padding / image.contentWidth * image.crop.width,
                y: image.crop.y - image.padding / image.contentHeight * image.crop.height,
                width: image.width / image.contentWidth * image.crop.width,
                height: image.height / image.contentHeight * image.crop.height,
              };
              const [result] = await withAbort(current.predict(image.file), signal);
              active();
              observation.readings = result.items.filter(item => item.text.trim()).map((item, readingIndex) => {
                // Invalid/missing polygons are not empty votes. Preserve their
                // text so uncertain numeric fragments cannot disappear.
                const reading = paddleReadings([item], image.width, image.height, pass + 30)[0]
                  ?? { text: item.text, pass: pass + 30, confidence: Number.isFinite(item.score) ? item.score * 100 : undefined };
                const bounds = reading.bounds;
                return { ...reading, ...(bounds ? { bounds: {
                  x: image.crop.x + (bounds.x * image.width - image.padding) / image.contentWidth * image.crop.width,
                  y: image.crop.y + (bounds.y * image.height - image.padding) / image.contentHeight * image.crop.height,
                  width: bounds.width * image.width / image.contentWidth * image.crop.width,
                  height: bounds.height * image.height / image.contentHeight * image.crop.height,
                } } : {}), provenance: { ...identity, role: "verification" as const, field: target.field, rowId: target.rowId, viewId,
                  readingId: `${viewId}-${readingIndex}` } };
              });
            } catch { active(); observation.failure = "verification-failed"; }
          }
          review = applyRequirementRecovery(review, target, observations);
        }
      }
      // Default preserves D-150, including unresolved requirement retries.
      // Only explicit experiment callers replace that path with verification;
      // the same requirement is never run through both recovery paths.
      // 최대 12개 미해결 줄만 원래 색상 이미지에서 다시 자른다. 해결된 줄은 남은 변환/배율 시도를 중단한다.
      const targets = review.lines.filter(line => (!experimentalRequirementRecovery || !identifiedRequirementLabel(line)) && retryRecognitionLabel(line)).slice(0, 12);
      retryTargets: for (const [index, target] of targets.entries()) {
        progress("recognizing", experimentalRequirementRecovery ? .85 + .12 * index / targets.length : .75 + .23 * index / targets.length);
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
    // 단일 엔진에 predict가 겹치지 않도록 호출을 순서대로 실행한다. 배치 병렬성은 별도 인식기들이 담당한다.
    recognize(file, options) {
      const version = generation;
      const identity = sourceIdentity(file);
      const pending = queue.then(() => run(file, options, version, identity));
      queue = pending.catch(() => undefined);
      return pending;
    },
    terminate,
  };
}
