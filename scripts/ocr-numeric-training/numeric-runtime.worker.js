import {PaddleOCR} from '@paddleocr/paddleocr-js';

let engine;
let images=[];
const progress=(requestId,phase)=>self.postMessage({requestId,kind:'progress',phase});
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
self.onmessage=async({data:{requestId,type,payload}})=>{
  try{
    let value;
    if(type==='initialize'){
      if(engine)throw Error('Already initialized');
      const start=performance.now();progress(requestId,'initializing');
      engine=await PaddleOCR.create({worker:false,textDetectionModelName:'PP-OCRv5_mobile_det',
        textDetectionModelAsset:{url:new URL('/ocr/paddle/models/det.tar',self.location.href).href},
        textRecognitionModelName:'korean_PP-OCRv5_mobile_rec',
        textRecognitionModelAsset:{url:new URL('/model/'+payload.model,self.location.href).href},
        textRecognitionBatchSize:payload.batch,
        ortOptions:{backend:'wasm',wasmPaths:new URL('/ocr/paddle/ort/',self.location.href).href,numThreads:1,simd:true}});
      if(typeof engine.recModel?.predict!=='function')throw Error('Recognition-only SDK API changed');
      const initializeMs=performance.now()-start;progress(requestId,'preparing');
      const decodeStart=performance.now();
      for(const input of payload.inputs){
        const response=await fetch(input.url);if(!response.ok)throw Error('Input fetch failed');
        const bytes=await response.arrayBuffer();if(await sha(bytes)!==input.sha256)throw Error('Input hash mismatch');
        const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
        try{
          const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');
          ctx.drawImage(bitmap,0,0);images.push({input,pixels:ctx.getImageData(0,0,canvas.width,canvas.height)});
        }finally{bitmap.close();}
      }
      value={initializeMs,decodeMs:performance.now()-decodeStart,worker:true,
        globalScope:self.constructor.name,provider:engine.recModel.provider,
        resources:performance.getEntriesByType('resource').filter(r=>r.name.includes('/model/')).map(r=>({
          name:r.name.split('/').at(-1),duration:r.duration,transferSize:r.transferSize,encodedBodySize:r.encodedBodySize}))};
    }else if(type==='predict'){
      if(!engine||!images.length)throw Error('Worker is not ready');
      progress(requestId,'recognizing');const start=performance.now();
      const mats=images.map(({pixels})=>engine.cv.matFromImageData(pixels));
      try{
        const results=await engine.recModel.predict(engine.cv,mats);
        if(results.length!==images.length)throw Error('Incomplete output');
        value={durationMs:performance.now()-start,rows:results.map((r,i)=>({id:images[i].input.id,
          rawText:r.text,score:r.score,inputSha256:images[i].input.sha256}))};
      }finally{mats.forEach(m=>m.delete());}
    }else if(type==='dispose'){
      await engine?.dispose();engine=undefined;images=[];value={disposed:true};
    }else throw Error('Unknown worker method');
    self.postMessage({requestId,kind:'result',value});
  }catch(error){self.postMessage({requestId,kind:'error',error:String(error)});}
};
