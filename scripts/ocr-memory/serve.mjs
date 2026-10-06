import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { prepareSdkVariant, replaceOnce } from './sdk-variant.mjs';
import { readJsonBody } from './body.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url)), appRoot = path.resolve(dir, '../..');
const arg = (name, fallback) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const fixtureDir = path.resolve(arg('fixtures', path.join(appRoot, 'output/ocr-concurrency-20260928/fixtures')));
const outputRoot = path.resolve(arg('output', path.join(appRoot, 'output/playwright/ocr-memory-20261007')));
if (!outputRoot.startsWith(path.join(appRoot, 'output') + path.sep)) throw Error('Use an ignored output directory inside this app');
const port = Number(arg('port', '3007')), variant = arg('variant', 'installed');
if (!['installed', 'control', 'stream'].includes(variant)) throw Error('Unknown variant');
fs.mkdirSync(outputRoot, { recursive: true });
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const fixtures = fs.readdirSync(fixtureDir).filter(name => /\.(png|jpe?g|webp)$/i.test(name)).sort().map((name, index) => {
  const bytes = fs.readFileSync(path.join(fixtureDir, name)); return { index, name, bytes: bytes.length, sha256: sha256(bytes) };
});
if (!fixtures.length) throw Error('No private fixtures found');
const sdk = variant === 'installed' ? null : prepareSdkVariant(appRoot, outputRoot, variant === 'stream');
const relevant = ['recognizeBatch.client.ts', 'recognizePaddle.client.ts', 'prepareTooltipImage.ts', 'enlargeTooltip.client.ts', 'reviewRecognition.ts'];
const provenance = { recordedAt: new Date().toISOString(), variant, sdk,
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8' }).trim(),
  packageVersions: Object.fromEntries(['@paddleocr/paddleocr-js', 'onnxruntime-web', '@techstark/opencv-js', 'vite'].map(name => [name, JSON.parse(fs.readFileSync(path.join(appRoot, 'node_modules', name, 'package.json'), 'utf8')).version])),
  harnessHashes: Object.fromEntries(['serve.mjs', 'browser.ts', 'run.ps1', 'sdk-variant.mjs', 'body.mjs', 'summarize.mjs'].map(name => [name, sha256(fs.readFileSync(path.join(dir, name)))])),
  sourceHashes: Object.fromEntries(relevant.map(name => [name, sha256(fs.readFileSync(path.join(appRoot, 'features/calculator/ocr', name)))])),
  modelHashes: Object.fromEntries(['det.tar', 'rec-ko.tar'].map(name => [name, sha256(fs.readFileSync(path.join(appRoot, 'public/ocr/paddle/models', name)))])), fixtures };
const provenanceFile = `provenance-${variant}-${provenance.recordedAt.replace(/[:.]/g, '-')}.json`;
fs.writeFileSync(path.join(outputRoot, provenanceFile), JSON.stringify(provenance, null, 2), { flag: 'wx' });
const states = new Map(), controls = new Map();
const api = async (req, res, next) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname.startsWith('/fixtures/')) {
    const name = decodeURIComponent(url.pathname.slice(10)), fixture = fixtures.find(f => f.name === name);
    if (!fixture) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', /png$/i.test(name) ? 'image/png' : /webp$/i.test(name) ? 'image/webp' : 'image/jpeg');
    fs.createReadStream(path.join(fixtureDir, fixture.name)).pipe(res); return;
  }
  if (!url.pathname.startsWith('/api/')) return next();
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  const id = url.searchParams.get('id') || 'none';
  if (!/^[a-z0-9-]+$/.test(id)) { res.statusCode = 400; res.end('{}'); return; }
  const send = value => res.end(JSON.stringify(value));
  try {
    if (url.pathname === '/api/fixtures') return send({ fixtures, variant, provenanceFile });
    if (url.pathname === '/api/control') return send(controls.get(id) ?? { start: false, cancel: false });
    if (url.pathname === '/api/start') { controls.set(id, { start: true, cancel: false }); return send({}); }
    if (url.pathname === '/api/cancel') { controls.set(id, { start: true, cancel: true }); return send({}); }
    if (url.pathname === '/api/status') return send(states.get(id) ?? { phase: 'opening' });
    if (url.pathname === '/api/progress' && req.method === 'POST') {
      const state = await readJsonBody(req); states.set(id, state);
      if (['complete', 'failed'].includes(state.phase)) fs.writeFileSync(path.join(outputRoot, `trial-${id}.json`), JSON.stringify(state, null, 2));
      return send({});
    }
    res.statusCode = 404; send({});
  } catch (error) { res.statusCode = 500; send({ error: String(error) }); }
};
const server = await createServer({ configFile: false, root: dir, publicDir: path.join(appRoot, 'public'),
  cacheDir: path.join(outputRoot, `vite-${variant}`),
  resolve: sdk ? { alias: { '@paddleocr/paddleocr-js': sdk.entry } } : undefined,
  plugins: [{ name: 'local-ocr-memory-experiment', enforce: 'pre',
    configureServer(vite) { vite.middlewares.use((req, res, next) => { void api(req, res, next); }); },
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/features/calculator/ocr/recognizePaddle.client.ts')) return null;
      // Experiment-only instrumentation/configuration. The app source is unchanged.
      let code = replaceOnce(source, 'textRecognitionBatchSize: 6,', 'textRecognitionBatchSize: globalThis.__ocrMemoryBatch,');
      code = replaceOnce(code, 'await PaddleOCR.create({', 'await globalThis.__ocrMemoryCreate(PaddleOCR, {');
      return { code, map: null };
    }
  }],
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, fs: { allow: [appRoot] },
    headers: { 'Content-Security-Policy': "default-src 'self' blob: data:; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' blob: data:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'" } },
  optimizeDeps: { exclude: ['@paddleocr/paddleocr-js'], include: ['js-yaml', 'clipper-lib', '@techstark/opencv-js', 'onnxruntime-web'] },
});
await server.listen(); server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
