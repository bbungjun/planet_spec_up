// Observe the installed SDK's actual recognition tensors without changing arithmetic.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {readJsonBody} from '../ocr-memory/body.mjs';
import {replaceOnce} from '../ocr-memory/sdk-variant.mjs';

const dir=path.dirname(fileURLToPath(import.meta.url)),app=path.resolve(dir,'../..');
const arg=(key,otherwise)=>process.argv.find(v=>v.startsWith(`--${key}=`))?.slice(key.length+3)??otherwise;
const run=path.resolve(arg('run','output/ocr-numeric-training/train-coverage-20261011/browser'));
const output=path.resolve(arg('output','output/ocr-numeric-training/tensors-20261011'));
const targets=arg('targets','').split(',').filter(Boolean),port=Number(arg('port','3154')),model=arg('model','B0');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sha=p=>hash(fs.readFileSync(p));
if(!targets.length||!output.startsWith(path.join(app,'output')+path.sep))throw Error('Specify targets and private output');
if(fs.existsSync(output)&&fs.readdirSync(output).length)throw Error('Use an empty output');
const inputs=JSON.parse(fs.readFileSync(path.join(run,'data/inputs.json'),'utf8')).rows;
if(targets.some(id=>!inputs.some(r=>r.id===id)))throw Error('Unknown target');
const modelPath=path.resolve(app,JSON.parse(fs.readFileSync(path.join(run,'browser-models.json'),'utf8'))[model]);
const modelHash=sha(modelPath),sdk=path.join(app,'node_modules/@paddleocr/paddleocr-js/dist/index.mjs');
const source=fs.readFileSync(sdk,'utf8');
const anchor='        const output = await runInference(sessionState.session, inputTensor);';
const observed=replaceOnce(source,anchor,anchor+'\n        await globalThis.__numericTensorCapture?.(batch.map(x => x.inputIndex), inputTensor, output);');
fs.mkdirSync(output,{recursive:true});
fs.copyFileSync(sdk,path.join(output,'sdk-installed.mjs'));fs.writeFileSync(path.join(output,'sdk-observed.mjs'),observed,{flag:'wx'});
fs.copyFileSync(fileURLToPath(import.meta.url),path.join(output,'capture-tensors.mjs'));
fs.writeFileSync(path.join(output,'protocol.json'),JSON.stringify({createdAt:new Date().toISOString(),model,modelHash,targets,
  inputsHash:sha(path.join(run,'data/inputs.json')),sdkHash:hash(source),observedSdkHash:hash(observed),
  operation:'After inference, copy the existing input/output tensors to local files; no pixel, normalization, model, or decode changes.'},null,2),{flag:'wx'});
const browser=String.raw`
import {PaddleOCR} from '@paddleocr/paddleocr-js';
const info=await fetch('/tensor-inputs').then(r=>r.json());
const save=async(name,data)=>{const r=await fetch('/capture/'+name,{method:'POST',body:data});if(!r.ok)throw Error('Capture rejected: '+name);};
const status=document.querySelector('pre');
globalThis.__numericTensorCapture=async(indices,input,output)=>{
 if(!indices.some(i=>info.targets.includes(info.rows[i].id)))return;
 const name='batch-'+indices[0];
 await save(name+'-input.f32',new Blob([input.data]));await save(name+'-output.f32',new Blob([output.data]));
 await save(name+'.json',JSON.stringify({indices,ids:indices.map(i=>info.rows[i].id),inputDims:input.dims,outputDims:output.dims}));
};
document.querySelector('button').onclick=async()=>{
 document.querySelector('button').disabled=true;let engine;const mats=[];
 try{status.textContent='running';engine=await PaddleOCR.create({worker:false,textDetectionModelName:'PP-OCRv5_mobile_det',textDetectionModelAsset:{url:'/ocr/paddle/models/det.tar'},textRecognitionModelName:'korean_PP-OCRv5_mobile_rec',textRecognitionModelAsset:{url:'/tensor-model'},textRecognitionBatchSize:6,ortOptions:{backend:'wasm',wasmPaths:'/ocr/paddle/ort/',numThreads:1,simd:true}});
  for(const row of info.rows){const bitmap=await createImageBitmap(await fetch('/tensor-image/'+row.id).then(r=>r.blob()));const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const x=c.getContext('2d');x.drawImage(bitmap,0,0);bitmap.close();mats.push(engine.cv.matFromImageData(x.getImageData(0,0,c.width,c.height)));}
  const result=await engine.recModel.predict(engine.cv,mats);if(result.length!==info.rows.length)throw Error('Prediction count mismatch');
  await save('receipt.json',JSON.stringify({phase:'complete',model:info.model,modelSha256:info.modelHash,rows:result.map((r,i)=>({id:info.rows[i].id,rawText:r.text,score:r.score,inputSha256:info.rows[i].cropSha256}))}));status.textContent='complete';
 }catch(e){await save('failed.json',JSON.stringify({error:String(e)}));status.textContent=String(e);}
 finally{mats.forEach(m=>m.delete());await engine?.dispose();}
};`;
fs.writeFileSync(path.join(output,'browser.js'),browser,{flag:'wx'});
const server=await createServer({configFile:false,root:output,publicDir:path.join(app,'public'),cacheDir:path.join(output,'vite'),
  plugins:[{name:'observe-numeric-tensors',enforce:'pre',transform(code,id){if(id.split('?')[0].replaceAll('\\','/')===sdk.replaceAll('\\','/'))return {code:observed,map:null};},
    configureServer(s){s.middlewares.use(async(req,res,next)=>{
      const url=req.url?.split('?')[0];
      if(url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>숫자 텐서 대조</title><button>고정 텐서 수집</button><pre>ready</pre><script type="module" src="/browser.js"></script>');return;}
      if(url==='/tensor-inputs'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({rows:inputs,targets,model,modelHash}));return;}
      if(url==='/tensor-model'){if(sha(modelPath)!==modelHash){res.statusCode=409;res.end();return;}res.setHeader('Content-Type','application/x-tar');fs.createReadStream(modelPath).pipe(res);return;}
      if(url?.startsWith('/tensor-image/')){const row=inputs.find(r=>r.id===url.slice(14));if(!row){res.statusCode=404;res.end();return;}const p=path.join(run,'data',row.image);if(sha(p)!==row.cropSha256){res.statusCode=409;res.end();return;}res.setHeader('Content-Type','image/png');fs.createReadStream(p).pipe(res);return;}
      if(url?.startsWith('/capture/')&&req.method==='POST'){
        try{const name=url.slice(9);if(!/^(batch-[0-9]+(?:-input|-output)?\.(?:f32|json)|receipt\.json|failed\.json)$/.test(name))throw Error('Invalid capture name');
          const dest=path.join(output,name);if(fs.existsSync(dest))throw Error('Do not overwrite captures');
          if(name.endsWith('.json'))fs.writeFileSync(dest,JSON.stringify(await readJsonBody(req,2_000_000),null,2),{flag:'wx'});
          else{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>32_000_000)throw Error('Tensor too large');chunks.push(chunk);}fs.writeFileSync(dest,Buffer.concat(chunks),{flag:'wx'});}
          res.end('saved');
        }catch(e){res.statusCode=400;res.end(String(e));}return;
      }
      if(url==='/ocr/paddle/ort/ort-wasm-simd-threaded.jsep.mjs'){res.setHeader('Content-Type','text/javascript');fs.createReadStream(path.join(app,'public',url)).pipe(res);return;}
      next();
    });}}],optimizeDeps:{exclude:['@paddleocr/paddleocr-js'],include:['js-yaml','clipper-lib','@techstark/opencv-js','onnxruntime-web']},
  server:{host:'127.0.0.1',port,strictPort:true,hmr:false,fs:{allow:[app]},headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
    'Content-Security-Policy':"default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' blob: data:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'"}}});
await server.listen();server.printUrls();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
