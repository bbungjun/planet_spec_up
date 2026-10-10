import {PaddleOCR} from '@paddleocr/paddleocr-js';
import type {Mat} from '@techstark/opencv-js';
import {recognizeBatch,type BatchRecognitionResult} from '../../features/calculator/ocr/recognizeBatch.client';
import {mapReviewedStats,reviewBlocked,reviewQuestions} from '../../features/calculator/ocr/reviewRecognition';
import {locateSourceRegion,type PixelRect} from '../../features/calculator/ocr/sourceFrame';
import {numericRegion} from '../ocr-numeric-regions/regions';
import {automaticTargets,requirementLabels,type Label} from './auto-targets';

type Fixture={id:string;sha256:string;url:string};
type Model={path:string;sha256:string};
type Prediction={text:string;score:number};
type Engine={cv:{matFromImageData(image:ImageData):Mat};recModel:{predict(cv:Engine['cv'],mats:Mat[]):Promise<Prediction[]>};dispose():Promise<void>};
type Region={id:string;source:string;field:Label;sourceSha256:string;failure?:string;lineId?:string;sourceCrop?:PixelRect;valueCrop?:PixelRect;preview?:string;cropSha256?:string};
const state={phase:'ready',completed:0};
const controller=new AbortController();
const save=async(id:string,body:unknown)=>{const r=await fetch('/api/automatic-result/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Receipt rejected '+id);};
const progress=async(phase:string)=>{state.phase=phase;document.getElementById('status')!.textContent=JSON.stringify(state);await save('progress',state);};
const sha=async(bytes:ArrayBuffer)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const active=()=>{if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');};
const makeCanvas=(width:number,height:number)=>{const c=document.createElement('canvas');c.width=width;c.height=height;return c;};
document.getElementById('cancel')!.onclick=()=>controller.abort();
document.getElementById('run')!.onclick=async()=>{
  (document.getElementById('run') as HTMLButtonElement).disabled=true;
  const started=performance.now();
  try{
    const manifest:{fixtures:Fixture[];models:Record<string,Model>}=await fetch('/api/automatic-inputs').then(r=>r.json());
    const files:File[]=[];const outputs:Array<{index:number;result:BatchRecognitionResult}>=[];
    let reporting:Promise<void>=Promise.resolve();
    for(const f of manifest.fixtures){const b=await fetch(f.url).then(r=>r.blob());if(await sha(await b.arrayBuffer())!==f.sha256)throw Error('Source hash changed');files.push(new File([b],f.id+'.png',{type:'image/png'}));}
    await progress('full-photo-recognition');
    await recognizeBatch(files,{signal:controller.signal,concurrency:1,onStart(){},onPrepared(){},onProgress(){},
      onResult(index,result){outputs.push({index,result});state.completed++;reporting=reporting.then(()=>progress('full-photo-recognition'));}});
    await reporting;active();if(outputs.length!==files.length)throw Error('Full-photo result count mismatch');
    const regions:Region[]=[];const canvases:HTMLCanvasElement[]=[];
    const reviews=outputs.sort((a,b)=>a.index-b.index).map(({index,result})=>({index,source:manifest.fixtures[index].id,
      ...(result.ok?{ok:true,text:result.text,review:result.review,duplicateOf:result.duplicateOf,
        product:result.review?{blocked:reviewBlocked(result.review,'night_lord'),questions:reviewQuestions(result.review,'night_lord'),fields:mapReviewedStats(result.review,'night_lord')}:null}
        :{ok:false,error:result.error})}));
    for(const {index,result} of outputs){
      const source=manifest.fixtures[index];const base={source:source.id,sourceSha256:source.sha256};
      if(!result.ok||!result.review?.diagnostics?.sourceFrame){
        for(const field of requirementLabels)regions.push({...base,id:source.id+'-'+field,field,failure:!result.ok?'full-photo-recognition-failed':'source-frame-missing'});continue;
      }
      const bitmap=await createImageBitmap(files[index]);
      try{for(const target of automaticTargets(result.review)){
        const row:Region={...base,id:source.id+'-'+target.field,field:target.field,lineId:target.line?.id};
        regions.push(row);
        if(target.failure||!target.line?.bounds){row.failure=target.failure??'row-bounds-missing';continue;}
        const located=locateSourceRegion(result.review.diagnostics.sourceFrame,target.line.bounds,2);
        if(!located||located.clipped){row.failure='source-region-clipped';continue;}
        row.sourceCrop=located.crop;const c=makeCanvas(located.crop.width,located.crop.height);const ctx=c.getContext('2d')!;
        ctx.drawImage(bitmap,located.crop.x,located.crop.y,c.width,c.height,0,0,c.width,c.height);
        const split=numericRegion(ctx.getImageData(0,0,c.width,c.height));
        if(split.status!=='located'){row.failure=split.reason;continue;}
        row.valueCrop={x:located.crop.x+split.region.x,y:located.crop.y,width:split.region.width,height:split.region.height};
        const value=makeCanvas(split.region.width*3,split.region.height*3);const vc=value.getContext('2d')!;vc.imageSmoothingEnabled=false;
        vc.drawImage(c,split.region.x,split.region.y,split.region.width,split.region.height,0,0,value.width,value.height);
        const blob=await new Promise<Blob>((resolve,reject)=>value.toBlob(b=>b?resolve(b):reject(Error('PNG encode failed')),'image/png'));
        row.cropSha256=await sha(await blob.arrayBuffer());row.preview=value.toDataURL('image/png');canvases.push(value);
      }}finally{bitmap.close();}
    }
    await save('pipeline',{phase:'pipeline-complete',createdAt:new Date().toISOString(),reviews,regions,fullDenominator:files.length*5,durationMs:performance.now()-started});
    const located=regions.filter(r=>!r.failure);
    if(located.length!==canvases.length)throw Error('Crop alignment changed');
    for(const model of ['A1','BN1']){
      active();await progress('numeric-'+model);let engine:Engine|undefined;const mats:Mat[]=[];
      try{
        if(canvases.length){engine=await PaddleOCR.create({worker:false,textDetectionModelName:'PP-OCRv5_mobile_det',textDetectionModelAsset:{url:'/ocr/paddle/models/det.tar'},
          textRecognitionModelName:'korean_PP-OCRv5_mobile_rec',textRecognitionModelAsset:{url:'/numeric-model/'+model},textRecognitionBatchSize:6,
          ortOptions:{backend:'wasm',wasmPaths:'/ocr/paddle/ort/',numThreads:1,simd:true}}) as unknown as Engine;
          for(const c of canvases)mats.push(engine.cv.matFromImageData(c.getContext('2d')!.getImageData(0,0,c.width,c.height)));
        }
        const predictions=engine?await engine.recModel.predict(engine.cv,mats):[];active();if(predictions.length!==located.length)throw Error('Prediction count mismatch');
        await save(model,{phase:'numeric-complete',model,modelSha256:manifest.models[model].sha256,batch:6,rows:predictions.map((r,i)=>({id:located[i].id,rawText:r.text,score:r.score,inputSha256:located[i].cropSha256}))});
      }finally{mats.forEach(m=>m.delete());await engine?.dispose();}
    }
    state.phase='complete';document.getElementById('status')!.textContent=JSON.stringify(state);
    await save('complete',{...state,durationMs:performance.now()-started,fullDenominator:regions.length,located:located.length,failures:regions.length-located.length});
  }catch(e){state.phase='failed';document.getElementById('status')!.textContent=String(e);await save('failed',{...state,error:String(e),durationMs:performance.now()-started});}
};
