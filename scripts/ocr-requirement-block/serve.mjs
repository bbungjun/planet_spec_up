import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {readJsonBody} from '../ocr-memory/body.mjs';

const dir=path.dirname(fileURLToPath(import.meta.url)),app=path.resolve(dir,'../..');
const arg=(key,fallback)=>process.argv.find(v=>v.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const output=path.resolve(app,arg('output','output/ocr-requirement-block-20261021'));
const port=Number(arg('port','3162')),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(!output.startsWith(path.join(app,'output')+path.sep))throw Error('Private output must stay under output/');
if(fs.existsSync(output)&&fs.readdirSync(output).length)throw Error('Use a new experiment directory');
const devDir=path.join(app,'output/ocr-accuracy-implementation');
const dev=fs.readdirSync(devDir).filter(n=>/^\d{14}\.png$/.test(n)).sort().map((n,i)=>({id:`dev-${String(i).padStart(2,'0')}`,set:'dev19',path:path.join(devDir,n),name:n}));
const lock=JSON.parse(fs.readFileSync(path.join(app,'output/ocr-numeric-training/new-photos-20261011/pretest-lock.json'),'utf8'));
const fresh=lock.rows.map(r=>({id:r.id,set:'new14',path:path.resolve(app,r.frozenSource),expected:r.sha256}));
const fixtures=[...dev,...fresh].map(f=>{const h=sha(f.path);if(f.expected&&h!==f.expected)throw Error('Source changed '+f.id);return {...f,sha256:h};});
if(fixtures.length!==33)throw Error('Expected 19+14 fixtures');
const models={A1:{path:'public/ocr/paddle/models/rec-ko.tar',sha256:'568ed8b43a260adc9f484d92105e425ea8cddf8ce16940c177bc12864cfb0eb0'},
  BN1:{path:'output/ocr-numeric-training/run-20261010/convert-BN1/rec.tar',sha256:'ab9b8f02b33a6ecefa4f61469455d4724307079774ead7f2f5ca8862c3824452'}};
for(const m of Object.values(models))if(sha(path.join(app,m.path))!==m.sha256)throw Error('Model changed '+m.path);
const sources=[...execFileSync('git',['ls-files','features/calculator/ocr'],{cwd:app,encoding:'utf8'}).trim().split('\n').filter(Boolean),
  ...['block.ts','browser.ts','index.html','serve.mjs','score.mjs'].map(n=>'scripts/ocr-requirement-block/'+n),'scripts/ocr-numeric-regions/regions.ts'];
fs.mkdirSync(output,{recursive:true});
const protocol={createdAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),
  branch:execFileSync('git',['branch','--show-current'],{cwd:app,encoding:'utf8'}).trim(),
  fixtures:fixtures.map(({id,set,name,sha256})=>({id,set,name,sha256})),models,detectorSha256:sha(path.join(app,'public/ocr/paddle/models/det.tar')),
  sourceHashes:Object.fromEntries(sources.map(n=>[n,sha(path.join(app,n))])),
  recipe:'Unchanged product recognizeBatch (concurrency 1) → locateRequirementBlock (8 evenly spaced left-aligned rows, order LEV/STR/DEX/INT/LUK/POP/ITEM LEV/ITEM EXP, label veto, >=2 anchors) → locateSourceRegion padding2 → unchanged numericRegion → original RGB nearest3x → A1 then BN1 batch6 greedy CTC. Values accepted only as plain 1~3 digit integers.',
  mergeRule:'Per requirement field: dedicated value v (BN1 primary, A1 ablation), product value p. p absent & v valid → v. Both present & equal → p. Both present & different → conflict, field left unresolved. v invalid/absent → p. Product output is never overwritten.',
  scope:'Development-set comparison on 19 previous Dotum photos + 14 previously tested new photos; the locator rule was designed after inspecting these reviews, so this is not an independent final test. Numeric predictions are not written to product review or storage.'};
fs.writeFileSync(path.join(output,'protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx'});
let status={phase:'ready'};
const server=await createServer({configFile:false,root:dir,publicDir:path.join(app,'public'),cacheDir:path.join(output,'vite'),
  plugins:[{name:'requirement-block-experiment',configureServer(s){s.middlewares.use(async(req,res,next)=>{
    const url=req.url?.split('?')[0];
    if(url?.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');}
    if(url==='/api/inputs'){res.end(JSON.stringify({fixtures:fixtures.map(({id,set,sha256})=>({id,set,sha256,url:'/source/'+id})),models}));return;}
    if(url==='/api/status'){res.end(JSON.stringify(status));return;}
    if(url?.startsWith('/source/')){const f=fixtures.find(f=>f.id===url.slice(8));if(!f||sha(f.path)!==f.sha256){res.statusCode=409;res.end();return;}res.setHeader('Content-Type','image/png');fs.createReadStream(f.path).pipe(res);return;}
    if(url?.startsWith('/numeric-model/')){const m=models[url.slice(15)];if(!m||sha(path.join(app,m.path))!==m.sha256){res.statusCode=409;res.end();return;}res.setHeader('Content-Type','application/x-tar');res.setHeader('Cache-Control','no-store');fs.createReadStream(path.join(app,m.path)).pipe(res);return;}
    if(url?.startsWith('/api/result/')&&req.method==='POST'){
      try{const id=url.slice('/api/result/'.length);if(!['progress','pipeline','A1','BN1','complete','failed'].includes(id))throw Error('Unknown phase');
        const body=await readJsonBody(req,60_000_000);
        if(id!=='progress')fs.writeFileSync(path.join(output,`${id}.json`),JSON.stringify(body,null,2),{flag:'wx'});
        status=body;res.end('{}');
      }catch(e){res.statusCode=400;res.end(JSON.stringify({error:String(e)}));}return;
    }
    if(url==='/ocr/paddle/ort/ort-wasm-simd-threaded.jsep.mjs'){res.setHeader('Content-Type','text/javascript');fs.createReadStream(path.join(app,'public',url)).pipe(res);return;}
    next();
  });}}],resolve:{alias:{'@':app}},optimizeDeps:{exclude:['@paddleocr/paddleocr-js'],include:['js-yaml','clipper-lib','@techstark/opencv-js','onnxruntime-web']},
  server:{host:arg('host','127.0.0.1'),port,strictPort:true,hmr:false,fs:{allow:[app]},headers:{
    'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
    'Content-Security-Policy':"default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' blob: data:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'"}}});
await server.listen();server.printUrls();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
