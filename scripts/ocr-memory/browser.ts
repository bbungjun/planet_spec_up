import { recognizeBatch, type BatchRecognitionResult } from '../../features/calculator/ocr/recognizeBatch.client';
import { mapReviewedStats, reviewQuestions, reviewBlocked } from '../../features/calculator/ocr/reviewRecognition';

type Engine = { initialize(): Promise<unknown>; predict(input: File): Promise<unknown>; dispose(): Promise<void> };
type Factory = { create(options: Record<string, unknown>): Promise<Engine> };
type Memory = { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
type Fixture = { name: string; sha256: string; bytes: number };
const params = new URLSearchParams(location.search), id = params.get('id') ?? 'manual';
const concurrency = Number(params.get('n') ?? 3), recBatch = Number(params.get('batch') ?? 6);
const count = Number(params.get('count') ?? 19), rounds = Number(params.get('rounds') ?? 1);
const initializationMode = params.get('init') ?? 'parallel';
if (!['parallel', 'serial'].includes(initializationMode)) throw Error('Invalid initialization mode');
const cancelAfterMs = Number(params.get('cancelMs') ?? 0);
if (![1, 2, 3].includes(concurrency) || ![1, 2, 3, 6].includes(recBatch) || !Number.isInteger(count) || count < 1 || count > 100 || ![1, 2, 3].includes(rounds)) throw Error('Invalid experiment configuration');
const progressNode = document.getElementById('progress')!, resultNode = document.getElementById('result')!;
const controller = new AbortController();
document.getElementById('cancel')!.onclick = () => controller.abort();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const memory = () => {
  const value = (performance as Performance & { memory?: Memory }).memory;
  return value ? { usedJSHeapSize: value.usedJSHeapSize, totalJSHeapSize: value.totalJSHeapSize, jsHeapSizeLimit: value.jsHeapSizeLimit } : null;
};
const events: Array<Record<string, unknown>> = [];
let started = 0, nextEngine = 0, liveEngines = 0, activePredictions = 0, peakPredictions = 0;
let initializationTail: Promise<unknown> = Promise.resolve();
const event = (kind: string, detail: Record<string, unknown> = {}) => events.push({ kind, elapsedMs: performance.now() - started, ...detail, mainThreadJsHeap: memory() });
Object.assign(globalThis, {
  __ocrMemoryBatch: recBatch,
  __ocrMemoryCreate: async (factory: Factory, options: Record<string, unknown>): Promise<Engine> => {
    const engineId = nextEngine++;
    event('create-start', { engineId });
    const engine = await factory.create(options);
    let disposed = false;
    liveEngines++;
    return {
      async initialize() {
        const initialize = async () => {
          if (disposed) throw new DOMException('Cancelled before initialization', 'AbortError');
          const start = performance.now(); event('initialize-start', { engineId });
          try { return await engine.initialize(); }
          finally { event('initialize-end', { engineId, durationMs: performance.now() - start }); }
        };
        if (initializationMode === 'parallel') return initialize();
        const pending = initializationTail.then(initialize);
        initializationTail = pending.catch(() => undefined);
        return pending;
      },
      async predict(file) {
        const start = performance.now(); activePredictions++; peakPredictions = Math.max(peakPredictions, activePredictions);
        try { return await engine.predict(file); }
        finally { activePredictions--; event('predict-end', { engineId, durationMs: performance.now() - start, inputBytes: file.size }); }
      },
      async dispose() {
        if (disposed) return;
        disposed = true; const start = performance.now(); event('dispose-start', { engineId });
        try { await engine.dispose(); }
        finally { liveEngines--; event('dispose-end', { engineId, durationMs: performance.now() - start }); }
      },
    };
  },
});
const report = async (state: Record<string, unknown>) => {
  progressNode.textContent = JSON.stringify({ ...state, outputs: undefined, events: undefined, fingerprints: undefined }, null, 2);
  const response = await fetch('/api/progress?id=' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
  if (!response.ok) throw Error('Local measurement endpoint rejected report');
};
const hash = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const percentile = (values: number[], p: number) => { const sorted = values.slice().sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null; };
let tick: ReturnType<typeof setInterval> | undefined, control: ReturnType<typeof setInterval> | undefined;
try {
  await report({ phase: 'preloading', concurrency, recBatch });
  const manifest: { fixtures: Fixture[]; variant: string; provenanceFile: string } = await (await fetch('/api/fixtures')).json();
  if (manifest.fixtures.length < count) throw Error(`Requested ${count} images, but only ${manifest.fixtures.length} fixtures exist`);
  const selected = manifest.fixtures.slice(0, count), files: File[] = [], dimensions: Array<{ width: number; height: number }> = [];
  for (const fixture of selected) {
    const blob = await (await fetch('/fixtures/' + encodeURIComponent(fixture.name))).blob();
    const file = new File([blob], fixture.name, { type: blob.type }); files.push(file);
    const bitmap = await createImageBitmap(file); dimensions.push({ width: bitmap.width, height: bitmap.height }); bitmap.close();
  }
  // Separate HTTP-cache warmth from runtime/session warmth. New session each trial.
  for (const asset of ['/ocr/paddle/models/det.tar', '/ocr/paddle/models/rec-ko.tar', '/ocr/paddle/ort/ort-wasm-simd-threaded.jsep.wasm']) {
    const response = await fetch(asset, { cache: 'force-cache' }); if (!response.ok) throw Error('Asset prewarm failed'); await response.arrayBuffer();
  }
  const capacity = { cores: navigator.hardwareConcurrency, memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    isolated: crossOriginIsolated, userAgent: navigator.userAgent };
  const base = { id, variant: manifest.variant, provenanceFile: manifest.provenanceFile, initializationMode, concurrency, recBatch, count: files.length, rounds, capacity, dimensions, fixtureHashes: selected.map(f => f.sha256) };
  await report({ ...base, phase: 'ready', mainThreadJsHeap: memory() });
  while (!(await (await fetch('/api/control?id=' + id)).json()).start) await sleep(250);
  const startedAtUtc = new Date().toISOString();
  started = performance.now(); event('start');
  const delays: number[] = [], longTasks: number[] = [], outputs: Array<Record<string, unknown>> = [], durations: number[] = [], roundTimes: number[] = [];
  let last = performance.now(), completed = 0, phase = 'running';
  const heartbeat = setInterval(() => { const now = performance.now(); delays.push(Math.max(0, now - last - 50)); last = now; }, 50);
  const observer = PerformanceObserver.supportedEntryTypes.includes('longtask') ? new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration))) : null;
  observer?.observe({ entryTypes: ['longtask'] });
  const update = () => report({ ...base, phase, completed, liveEngines, activePredictions, elapsedMs: performance.now() - started, mainThreadJsHeap: memory() });
  // Serialized async ticks avoid post-completion stale reports.
  let pending = Promise.resolve();
  tick = setInterval(() => { pending = pending.then(update).catch(() => controller.abort()); }, 500);
  control = setInterval(() => { void fetch('/api/control?id=' + id).then(r => r.json()).then(value => { if (value.cancel) controller.abort(); }).catch(() => controller.abort()); }, 500);
  const timedCancel = cancelAfterMs > 0 ? setTimeout(() => controller.abort(), cancelAfterMs) : undefined;
  const record = (round: number, index: number, result: BatchRecognitionResult, start: number | undefined) => {
    completed++;
    const durationMs = start === undefined ? null : performance.now() - start;
    if (durationMs !== null) durations.push(durationMs);
    const output = result.ok ? { round, index, ok: true, text: result.text, duplicateOf: result.duplicateOf ?? null,
      review: result.review ? { category: result.review.category, warnings: result.review.warnings, blocked: reviewBlocked(result.review, 'corsair'),
        fields: mapReviewedStats(result.review, 'corsair'), questions: reviewQuestions(result.review, 'corsair'),
        header: result.review.header ? { name: result.review.header.name, marker: result.review.header.marker } : null,
        lines: result.review.lines.map(line => ({ text: line.text, status: line.status, reason: line.reason })) } : null }
      : { round, index, ok: false, error: String((result.error as { code?: string })?.code ?? result.error) };
    outputs.push(output); event('image-result', { round, index, ok: result.ok, durationMs });
  };
  try {
    await update();
    for (let round = 0; round < rounds && !controller.signal.aborted; round++) {
      const starts = new Map<number, number>(), roundStart = performance.now(); event('round-start', { round });
      await recognizeBatch(files, { signal: controller.signal, concurrency,
        onStart: index => { starts.set(index, performance.now()); }, onProgress() {}, onPrepared() {},
        onResult: (index, result) => record(round, index, result, starts.get(index)),
      });
      roundTimes.push(performance.now() - roundStart); event('round-end', { round });
    }
  } finally {
    clearInterval(heartbeat); clearInterval(control); clearInterval(tick); clearTimeout(timedCancel); observer?.disconnect(); await pending;
  }
  const elapsedMs = performance.now() - started;
  phase = 'settling'; await update(); await sleep(5000); event('settled');
  const fingerprints: Array<{ round: number; index: number; sha256: string }> = [];
  for (const output of outputs) fingerprints.push({ round: Number(output.round), index: Number(output.index), sha256: await hash({ ...output, round: undefined }) });
  const state = { ...base, startedAtUtc, phase: 'complete', elapsedMs, roundTimes, completed, liveEngines, peakPredictions,
    sdkResources: performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /sdk-(control|stream)|paddleocr|recognizePaddle/.test(name)),
    cancelled: controller.signal.aborted, cancelAfterMs, errors: outputs.filter(v => !v.ok).length,
    imageDurationMedianMs: percentile(durations, .5), imageDurationP95Ms: percentile(durations, .95),
    heartbeatDelayP95Ms: percentile(delays, .95), heartbeatDelayMaxMs: Math.max(0, ...delays), heartbeatSamples: delays.length,
    longTaskCount: longTasks.length, longTaskMs: longTasks.reduce((a, b) => a + b, 0), mainThreadJsHeap: memory(),
    fingerprints, events, outputs };
  resultNode.textContent = '완료 — 로컬 output 폴더에 결과를 저장했습니다.'; await report(state);
} catch (error) {
  clearInterval(tick); clearInterval(control); controller.abort();
  await report({ phase: 'failed', id, concurrency, recBatch, error: String(error), events });
}
