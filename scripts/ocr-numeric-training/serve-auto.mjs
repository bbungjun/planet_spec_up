import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {readJsonBody} from '../ocr-memory/body.mjs';

const dir=path.dirname(fileURLToPath(import.meta.url)),app=path.resolve(dir,'../..');
const arg=(key,fallback)=>process.argv.find(v=>v.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const study=path.resolve(arg('study','output/ocr-numeric-training/new-photos-20261011'));
const output=path.resolve(arg('output','output/ocr-numeric-training/new-automatic-20261011'));
const port=Number(arg('port','3152')),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(!output.startsWith(path.join(app,'output')+path.sep))throw Error('Private output must stay under output/');
if(fs.existsSync(output)&&fs.readdirSync(output).length)throw Error('Use a new experiment directory');
const lock=JSON.parse(fs.readFileSync(path.join(study,'pretest-lock.json'),'utf8'));
const fixtures=lock.rows.map(r=>({id:r.id,path:path.resolve(app,r.frozenSource),sha256:r.sha256}));
const models=Object.fromEntries(['A1','BN1'].map(id=>[id,lock.models[id]]));
for(const f of fixtures)if(sha(f.path)!==f.sha256)throw Error('Source changed');
for(const m of Object.values(models))if(sha(path.resolve(app,m.path))!==m.sha256)throw Error('Model changed');
const tracked=execFileSync('git',['ls-files','features/calculator/ocr'],{cwd:app,encoding:'utf8'}).trim().split('\n').filter(Boolean);
const harness=['auto-browser.ts','auto-targets.ts','auto.html','serve-auto.mjs'];
const sources=[...tracked,...harness.map(n=>'scripts/ocr-numeric-training/'+n),'scripts/ocr-numeric-regions/regions.ts'];
fs.mkdirSync(output,{recursive:true});
for(const name of sources){const dest=path.join(output,'sources',name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(app,name),dest);}
const protocol={createdAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),
  sourceStudySha256:sha(path.join(study,'pretest-lock.json')),fixtures:fixtures.map(({id,sha256})=>({id,sha256})),models,
  detectorSha256:sha(path.join(app,'public/ocr/paddle/models/det.tar')),
  sourceHashes:Object.fromEntries(sources.map(n=>[n,sha(path.join(app,n))])),
  recipe:'Unchanged product Paddle recognizer and review; one serial batch; all five unique requirement labels; locateSourceRegion padding2; unchanged numericRegion; original RGB nearest3x; A1 then BN1 batch6 greedy CTC. No manual crop repair or output selection.',
  scope:'Follow-up automatic-pipeline evaluation on the same previously tested photos, not a new independent dataset. Numeric predictions are not written to the product review or storage.'};
fs.writeFileSync(path.join(output,'protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx'});
let status={phase:'ready'};
const server=await createServer({configFile:false,root:dir,publicDir:path.join(app,'public'),cacheDir:path.join(output,'vite'),
  plugins:[{name:'automatic-numeric-evaluation',configureServer(s){s.middlewares.use(async(req,res,next)=>{
    const url=req.url?.split('?')[0];
    if(url?.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');}
    if(url==='/api/automatic-inputs'){res.end(JSON.stringify({fixtures:fixtures.map(({id,sha256})=>({id,sha256,url:'/source/'+id})),models}));return;}
    if(url==='/api/automatic-status'){res.end(JSON.stringify(status));return;}
    if(url?.startsWith('/source/')){const f=fixtures.find(f=>f.id===url.slice(8));if(!f||sha(f.path)!==f.sha256){res.statusCode=409;res.end();return;}res.setHeader('Content-Type','image/png');fs.createReadStream(f.path).pipe(res);return;}
    if(url?.startsWith('/numeric-model/')){const m=models[url.slice(15)];if(!m||sha(path.join(app,m.path))!==m.sha256){res.statusCode=409;res.end();return;}res.setHeader('Content-Type','application/x-tar');res.setHeader('Cache-Control','no-store');fs.createReadStream(path.join(app,m.path)).pipe(res);return;}
    if(url?.startsWith('/api/automatic-result/')&&req.method==='POST'){
      try{const id=url.slice('/api/automatic-result/'.length);if(!['progress','pipeline','A1','BN1','complete','failed'].includes(id))throw Error('Unknown phase');
        const body=await readJsonBody(req,30_000_000);
        if(id!=='progress')fs.writeFileSync(path.join(output,`${id}.json`),JSON.stringify(body,null,2),{flag:'wx'});
        status=body;res.end('{}');
      }catch(e){res.statusCode=400;res.end(JSON.stringify({error:String(e)}));}return;
    }
    if(url==='/ocr/paddle/ort/ort-wasm-simd-threaded.jsep.mjs'){res.setHeader('Content-Type','text/javascript');fs.createReadStream(path.join(app,'public',url)).pipe(res);return;}
    next();
  });}}],optimizeDeps:{exclude:['@paddleocr/paddleocr-js'],include:['js-yaml','clipper-lib','@techstark/opencv-js','onnxruntime-web']},
  server:{host:'127.0.0.1',port,strictPort:true,hmr:false,fs:{allow:[app]},headers:{
    'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
    'Content-Security-Policy':"default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' blob: data:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'"}}});
await server.listen();server.printUrls();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
