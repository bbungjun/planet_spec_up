import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {readJsonBody} from '../ocr-memory/body.mjs';

const dir=path.dirname(fileURLToPath(import.meta.url)),app=path.resolve(dir,'../..');
const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const run=path.resolve(arg('run','output/ocr-numeric-training/run-20261010'));
const port=Number(arg('port','3145'));
if(!run.startsWith(path.join(app,'output')+path.sep))throw Error('Use ignored local output');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const inputs=JSON.parse(fs.readFileSync(path.join(run,'data/inputs.json'),'utf8'));
const models=JSON.parse(fs.readFileSync(path.join(run,'browser-models.json'),'utf8'));
const modelPaths=Object.fromEntries(Object.entries(models).map(([id,p])=>[id,path.resolve(app,p)]));
for(const p of Object.values(modelPaths))if(!p.startsWith(app+path.sep))throw Error('Model outside workspace');
const server=await createServer({configFile:false,root:dir,publicDir:path.join(app,'public'),cacheDir:path.join(run,'vite'),
  plugins:[{name:'numeric-training-replay',configureServer(s){s.middlewares.use(async(req,res,next)=>{
    const url=req.url?.split('?')[0];
    if(url==='/api/inputs'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({
      rows:inputs.rows.map(r=>({id:r.id,url:'/input/'+encodeURIComponent(r.id),sha256:r.cropSha256})),
      models:Object.keys(models),modelHashes:Object.fromEntries(Object.entries(modelPaths).map(([id,p])=>[id,hash(p)]))}));return;}
    if(url?.startsWith('/input/')){const r=inputs.rows.find(r=>r.id===decodeURIComponent(url.slice(7)));
      if(!r){res.statusCode=404;res.end();return;}const p=path.join(run,'data',r.image);
      if(hash(p)!==r.cropSha256){res.statusCode=409;res.end('Input hash mismatch');return;}
      res.setHeader('Content-Type','image/png');fs.createReadStream(p).pipe(res);return;}
    if(url?.startsWith('/model/')){const p=modelPaths[url.slice(7)];if(!p){res.statusCode=404;res.end();return;}
      res.setHeader('Content-Type','application/x-tar');fs.createReadStream(p).pipe(res);return;}
    if(url==='/ocr/paddle/ort/ort-wasm-simd-threaded.jsep.mjs'){
      res.setHeader('Content-Type','text/javascript');fs.createReadStream(path.join(app,'public',url)).pipe(res);return;}
    if(url==='/api/result'&&req.method==='POST'){
      try{const body=await readJsonBody(req,2_000_000);
        if(!Object.keys(models).includes(body.model)||![1,6].includes(body.batch))throw Error('Unknown run');
        const dest=path.join(run,`browser-${body.model}-b${body.batch}-${Date.now()}.json`);
        fs.writeFileSync(dest,JSON.stringify(body,null,2),{flag:'wx'});res.end('saved');
      }catch(e){res.statusCode=400;res.end(String(e));}return;}
    next();
  });}}],optimizeDeps:{exclude:['@paddleocr/paddleocr-js'],include:['js-yaml','clipper-lib','@techstark/opencv-js','onnxruntime-web']},
  server:{host:'127.0.0.1',port,strictPort:true,hmr:false,fs:{allow:[app]},headers:{
    'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
    'Content-Security-Policy':"default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' blob: data:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'"}}});
await server.listen();server.printUrls();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
