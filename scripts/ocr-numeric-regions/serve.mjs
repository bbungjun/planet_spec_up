import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {createServer} from 'vite';
import {readJsonBody} from '../ocr-memory/body.mjs';

const dir=path.dirname(fileURLToPath(import.meta.url)), app=path.resolve(dir,'../..');
const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const output=path.resolve(arg('output',path.join(app,'output/playwright/ocr-numeric-regions-20261010')));
const receipt=path.resolve(arg('receipt',path.join(app,'output/playwright/ocr-requirement-20261010/validation.json')));
const fixtures=path.resolve(arg('fixtures',path.join(app,'output/ocr-accuracy-implementation')));
const port=Number(arg('port','3143'));
if(!output.startsWith(path.join(app,'output')+path.sep))throw Error('Use ignored output inside this app');
fs.mkdirSync(output,{recursive:true});
const sdkVersion=JSON.parse(fs.readFileSync(path.join(app,'node_modules/@paddleocr/paddleocr-js/package.json'),'utf8')).version;
if(sdkVersion!=='0.4.2')throw Error('Recheck the internal recognition-only API for this SDK version');
await build({entryPoints:[path.join(dir,'regions.ts')],bundle:true,platform:'node',format:'esm',outfile:path.join(output,'regions.mjs')});
const {selectNumericTargets}=await import(pathToFileURL(path.join(output,'regions.mjs')).href);
const saved=JSON.parse(fs.readFileSync(receipt,'utf8'));
const rows=saved.rows??saved.results;
const samples=rows.filter(r=>!r.kind||r.kind==='development').map((r,index)=>({index:r.index??index,name:r.name,sourceFrame:r.review?.diagnostics?.sourceFrame,targets:selectNumericTargets(r.review)}));
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const manifest={createdAt:new Date().toISOString(),sdkVersion,head:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),
  inputReceiptSha256:hash(fs.readFileSync(receipt)),modelHashes:Object.fromEntries(['det.tar','rec-ko.tar'].map(n=>[n,hash(fs.readFileSync(path.join(app,'public/ocr/paddle/models',n)))])),
  harnessHashes:Object.fromEntries(['serve.mjs','browser.ts','regions.ts','index.html'].map(n=>[n,hash(fs.readFileSync(path.join(dir,n)))])),
  recipe:{fieldScope:'Captain LEV/STR requirements plus existing STR/DEX numeric-conflict sentinels',scale:3,padding:2,batch:6,wasmThreads:1,recognizer:'installed recognition model; greedy CTC; no dictionary mask or character substitution',
    profiles:['current-contrast','min-inverted','original-color'],regions:['whole-row','number-fixed-canvas','number-tight'],primary:'whole-row vs number-fixed-canvas has identical image dimensions, sorted groups, tensor padding and batch size'},
  samples:samples.map(s=>({...s,inputSha256:hash(fs.readFileSync(path.join(fixtures,s.name)))}))};
const manifestName=`manifest-${manifest.createdAt.replace(/[:.]/g,'-')}.json`;
fs.writeFileSync(path.join(output,manifestName),JSON.stringify(manifest,null,2),{flag:'wx'});
const server=await createServer({configFile:false,root:dir,publicDir:path.join(app,'public'),cacheDir:path.join(output,'vite'),
  plugins:[{name:'local-numeric-ocr',configureServer(s){s.middlewares.use(async(req,res,next)=>{
    const url=req.url?.split('?')[0];
    if(url==='/api/manifest'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({manifestName,samples,recipe:manifest.recipe}));return;}
    if(url==='/ocr/paddle/ort/ort-wasm-simd-threaded.jsep.mjs'){
      res.setHeader('Content-Type','text/javascript');fs.createReadStream(path.join(app,'public',url)).pipe(res);return;}
    if(url?.startsWith('/input/')){const sample=samples.find(s=>s.name===decodeURIComponent(url.slice(7)));if(!sample){res.statusCode=404;res.end();return;}
      res.setHeader('Content-Type','image/png');fs.createReadStream(path.join(fixtures,sample.name)).pipe(res);return;}
    if(url?.startsWith('/api/result/')&&req.method==='POST'){
      const id=url.slice(12);if(!/^[a-z0-9-]+$/.test(id)){res.statusCode=400;res.end();return;}
      try{const body=await readJsonBody(req,50_000_000),encoded=JSON.stringify(body);
        if(id!=='progress')fs.writeFileSync(path.join(output,`result-${id}-${Date.now()}.json`),encoded,{flag:'wx'});
        fs.writeFileSync(path.join(output,`result-${id}.json`),encoded);res.end('saved');}catch(error){res.statusCode=400;res.end(String(error));}return;}
    next();
  });}}],optimizeDeps:{exclude:['@paddleocr/paddleocr-js'],include:['js-yaml','clipper-lib','@techstark/opencv-js','onnxruntime-web']},
  server:{host:'127.0.0.1',port,strictPort:true,hmr:false,fs:{allow:[app]},headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
    'Content-Security-Policy':"default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' blob: data:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'"}}});
await server.listen();server.printUrls();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
