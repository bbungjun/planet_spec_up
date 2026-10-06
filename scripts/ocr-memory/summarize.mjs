import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const dir = path.resolve(process.argv[2] ?? 'output/playwright/ocr-memory-20261007');
const baselineId = process.argv[3] ?? 'a-3x6-19-r1';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const base = read(path.join(dir, `trial-${baselineId}.json`));
if (base.phase !== 'complete' || base.cancelled || base.errors || base.completed !== base.count * base.rounds) throw Error('A completed, error-free baseline is required');
const expected = new Map(base.fingerprints.filter(v => v.round === 0).map(v => [v.index, v.sha256]));
const expectedOutputs = new Map(base.outputs.filter(v => v.round === 0).map(v => [v.index, v]));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fingerprint = output => crypto.createHash('sha256').update(JSON.stringify({ ...output, round: undefined })).digest('hex');
if (base.outputs.some(o => fingerprint(o) !== base.fingerprints.find(f => f.index === o.index && f.round === o.round)?.sha256)) throw Error('Baseline receipt integrity failed');
function outputDifferences(outputs) {
  const counts = { text: 0, fields: 0, header: 0, blocked: 0, questions: 0, lines: 0, warnings: 0, questionCount: 0 };
  const fieldKeys = {};
  for (const output of outputs) {
    const expected = expectedOutputs.get(output.index);
    if (!output.ok || !expected?.ok) continue;
    for (const key of Object.keys(counts)) {
      const get = value => key === 'text' ? value.text : key === 'questionCount' ? value.review?.questions?.length : value.review?.[key];
      if (!equal(get(output), get(expected))) counts[key]++;
    }
    for (const key of new Set([...Object.keys(output.review?.fields ?? {}), ...Object.keys(expected.review?.fields ?? {})])) {
      if (!equal(output.review?.fields[key], expected.review?.fields[key])) fieldKeys[key] = (fieldKeys[key] ?? 0) + 1;
    }
  }
  return { counts, fieldKeys };
}
const median = values => { const sorted = values.slice().sort((a, b) => a - b); return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null; };
const rows = [];
for (const name of fs.readdirSync(dir).filter(n => n.startsWith('trial-') && n.endsWith('.json')).sort()) {
  const trial = read(path.join(dir, name)), resourcesPath = path.join(dir, name.replace('trial-', 'resources-'));
  if (trial.phase !== 'complete' || !fs.existsSync(resourcesPath)) continue;
  const resources = read(resourcesPath), samples = resources.samples;
  if (!samples.length) throw Error(`No resource samples for ${name}`);
  const max = key => samples.length ? Math.max(...samples.map(v => v[key])) : null;
  const ready = samples.filter(v => v.phase === 'ready'), settled = samples.filter(v => v.phase === 'settling');
  const baselinePrivate = median(ready.map(v => v.privateBytes));
  const fixturesMatch = trial.fixtureHashes.every((hash, index) => hash === base.fixtureHashes[index]);
  const mismatches = trial.fingerprints.filter(v => v.sha256 !== expected.get(v.index)).map(v => ({ round: v.round, index: v.index }));
  const receiptErrors = trial.outputs.filter(o => fingerprint(o) !== trial.fingerprints.find(f => f.index === o.index && f.round === o.round)?.sha256).map(o => ({ round: o.round, index: o.index }));
  rows.push({ id: trial.id, variant: trial.variant, initializationMode: trial.initializationMode ?? 'parallel', concurrency: trial.concurrency, recBatch: trial.recBatch,
    count: trial.count, rounds: trial.rounds, seconds: trial.elapsedMs / 1000, roundSeconds: trial.roundTimes.map(v => v / 1000),
    completed: trial.completed, errors: trial.errors, cancelled: trial.cancelled, abortReason: resources.abortReason,
    peakWorkingMiB: max('workingBytes') / 2 ** 20, peakPrivateMiB: max('privateBytes') / 2 ** 20,
    readyPrivateMiB: baselinePrivate / 2 ** 20,
    settledPrivateMiB: settled.length ? settled.at(-1).privateBytes / 2 ** 20 : null,
    peakPrivateDeltaMiB: (max('privateBytes') - baselinePrivate) / 2 ** 20,
    resourceSamples: samples.length, predictionCalls: trial.events.filter(v => v.kind === 'predict-end').length,
    initializeMs: trial.events.filter(v => v.kind === 'initialize-end').map(v => v.durationMs),
    heartbeatP95Ms: trial.heartbeatDelayP95Ms, heartbeatMaxMs: trial.heartbeatDelayMaxMs,
    liveEnginesAtEnd: trial.liveEngines, fixtureMatch: fixturesMatch, outputMismatches: mismatches,
    receiptErrors,
    outputDifferences: receiptErrors.length ? null : outputDifferences(trial.outputs),
    resultComparison: receiptErrors.length ? 'receipt-integrity-failed' : trial.cancelled ? 'cancelled-not-compared' : fixturesMatch && trial.completed === trial.count * trial.rounds && mismatches.length === 0 ? 'same-as-baseline' : 'incomplete-or-different',
  });
}
const result = { baselineId, evidence: 'local single-device; warm HTTP cache, new engine sessions; final output equality is not ground-truth accuracy', rows };
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(result, null, 2));
console.table(rows.map(r => ({ id: r.id, seconds: +r.seconds.toFixed(2), workingMiB: +r.peakWorkingMiB.toFixed(0), privateMiB: +r.peakPrivateMiB.toFixed(0), settledMiB: r.settledPrivateMiB === null ? null : +r.settledPrivateMiB.toFixed(0), calls: r.predictionCalls, mismatches: r.outputMismatches.length, status: r.resultComparison })));
