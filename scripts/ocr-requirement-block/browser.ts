import {PaddleOCR} from '@paddleocr/paddleocr-js';
import type {Mat} from '@techstark/opencv-js';
import {recognizeBatch,type BatchRecognitionResult} from '../../features/calculator/ocr/recognizeBatch.client';
import {parseTooltipOption} from '../../features/calculator/ocr/parseMapleTooltip';
import {mapReviewedStats,resolveReviewLine,reviewBlocked,reviewQuestions} from '../../features/calculator/ocr/reviewRecognition';
import {locateSourceRegion,type PixelRect} from '../../features/calculator/ocr/sourceFrame';
import type {OcrReview} from '../../features/calculator/ocr/types';
import {setExperimentalRedTextContrast} from '../../features/calculator/ocr/enlargeTooltip.client';
import {numericRegion} from '../ocr-numeric-regions/regions';
import {locateRequirementBlock,requirementFields,requirementValue,type RequirementField} from './block';

type Fixture={id:string;set:string;sha256:string;url:string};
type Model={path:string;sha256:string};
type Prediction={text:string;score:number};
type Engine={cv:{matFromImageData(image:ImageData):Mat};recModel:{predict(cv:Engine['cv'],mats:Mat[]):Promise<Prediction[]>};dispose():Promise<void>};
type Region={id:string;source:string;field:RequirementField;failure?:string;sourceCrop?:PixelRect;valueCrop?:PixelRect;cropSha256?:string;preview?:string};
const state={phase:'ready',completed:0};
const controller=new AbortController();
const save=async(id:string,body:unknown)=>{const r=await fetch('/api/result/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Receipt rejected '+id);};
const progress=async(phase:string)=>{state.phase=phase;document.getElementById('status')!.textContent=JSON.stringify(state);await save('progress',state);};
const sha=async(bytes:ArrayBuffer)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const active=()=>{if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');};
const makeCanvas=(width:number,height:number)=>{const c=document.createElement('canvas');c.width=width;c.height=height;return c;};

/** Product requirement values per label, read the same way mapReviewedStats does (unresolved rows excluded). */
function productRequirements(review:OcrReview){
  const values:Partial<Record<RequirementField,number>>={};
  for(const line of review.lines){
    if(line.status==='check'||line.status==='ignored')continue;
    const option=parseTooltipOption(line.text);
    if(option?.requirement&&(requirementFields as readonly string[]).includes(option.label))values[option.label as RequirementField]=option.value;
  }
  return values;
}

document.getElementById('cancel')!.onclick=()=>controller.abort();
document.getElementById('run')!.onclick=async()=>{
  (document.getElementById('run') as HTMLButtonElement).disabled=true;
  const started=performance.now();
  // Variant is fixed by URL before any inference and recorded in every receipt.
  const variant=new URLSearchParams(location.search).get('variant')??'default';
  setExperimentalRedTextContrast(variant==='red-text');
  try{
    const manifest:{fixtures:Fixture[];models:Record<string,Model>}=await fetch('/api/inputs').then(r=>r.json());
    const files:File[]=[];const outputs:Array<{index:number;result:BatchRecognitionResult}>=[];
    let reporting:Promise<void>=Promise.resolve();
    for(const f of manifest.fixtures){const b=await fetch(f.url).then(r=>r.blob());if(await sha(await b.arrayBuffer())!==f.sha256)throw Error('Source hash changed');files.push(new File([b],f.id+'.png',{type:'image/png'}));}
    await progress('full-photo-recognition');
    await recognizeBatch(files,{signal:controller.signal,concurrency:1,onStart(){},onPrepared(){},onProgress(){},
      onResult(index,result){outputs.push({index,result});state.completed++;reporting=reporting.then(()=>progress('full-photo-recognition'));}});
    await reporting;active();if(outputs.length!==files.length)throw Error('Full-photo result count mismatch');
    const recognitionMs=performance.now()-started;
    const blockStarted=performance.now();
    const regions:Region[]=[];const canvases:HTMLCanvasElement[]=[];
    const reviews=outputs.sort((a,b)=>a.index-b.index).map(({index,result})=>{
      const f=manifest.fixtures[index];
      if(!result.ok||!result.review)return {source:f.id,set:f.set,ok:false,error:result.ok?'no-review':result.error,duplicateOf:result.ok?result.duplicateOf:undefined};
      const block=locateRequirementBlock(result.review);
      return {source:f.id,set:f.set,ok:true,duplicateOf:result.duplicateOf,category:result.review.category,
        product:{requirements:productRequirements(result.review),corsair:mapReviewedStats(result.review,'corsair'),
          blocked:reviewBlocked(result.review,'corsair'),questions:reviewQuestions(result.review,'corsair').length},
        block:block.status==='located'?{status:block.status,anchors:block.anchors,rows:block.rows}:block,review:result.review};
    });
    for(const {index,result} of outputs){
      const source=manifest.fixtures[index].id;
      const add=(field:RequirementField,failure?:string)=>{const row:Region={id:source+'-'+field,source,field,failure};regions.push(row);return row;};
      if(!result.ok||!result.review?.diagnostics?.sourceFrame){for(const field of requirementFields)add(field,!result.ok?'recognition-failed':'source-frame-missing');continue;}
      const block=locateRequirementBlock(result.review);
      if(block.status!=='located'){for(const field of requirementFields)add(field,'block-'+block.reason);continue;}
      const bitmap=await createImageBitmap(files[index]);
      try{for(const target of block.rows){
        const row=add(target.field);
        const located=locateSourceRegion(result.review.diagnostics.sourceFrame,target.bounds,2);
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
    const cropMs=performance.now()-blockStarted;
    await save('pipeline',{variant,createdAt:new Date().toISOString(),reviews,regions,recognitionMs,cropMs});
    const located=regions.filter(r=>!r.failure);
    if(located.length!==canvases.length)throw Error('Crop alignment changed');
    const timings:Record<string,number>={};const predicted:Record<string,Prediction[]>={};
    for(const model of ['A1','BN1']){
      active();await progress('numeric-'+model);const t0=performance.now();let engine:Engine|undefined;const mats:Mat[]=[];
      try{
        if(canvases.length){engine=await PaddleOCR.create({worker:false,textDetectionModelName:'PP-OCRv5_mobile_det',textDetectionModelAsset:{url:'/ocr/paddle/models/det.tar'},
          textRecognitionModelName:'korean_PP-OCRv5_mobile_rec',textRecognitionModelAsset:{url:'/numeric-model/'+model},textRecognitionBatchSize:6,
          ortOptions:{backend:'wasm',wasmPaths:'/ocr/paddle/ort/',numThreads:1,simd:true}}) as unknown as Engine;
          for(const c of canvases)mats.push(engine.cv.matFromImageData(c.getContext('2d')!.getImageData(0,0,c.width,c.height)));
        }
        const t1=performance.now();
        const predictions=engine?await engine.recModel.predict(engine.cv,mats):[];active();if(predictions.length!==located.length)throw Error('Prediction count mismatch');
        predicted[model]=predictions;timings[model+'-load']=t1-t0;timings[model+'-predict']=performance.now()-t1;
        await save(model,{model,modelSha256:manifest.models[model].sha256,batch:6,rows:predictions.map((r,i)=>({id:located[i].id,rawText:r.text,score:r.score,inputSha256:located[i].cropSha256}))});
      }finally{mats.forEach(m=>m.delete());await engine?.dispose();}
    }
    // Apply the fixed merge rule to the review itself so remaining questions can be counted.
    // Only this harness edits its in-memory copy; product code, storage and other lines are unchanged.
    const bn1=new Map(located.map((r,i)=>[r.id,requirementValue(predicted.BN1[i].text)]));
    const merged=outputs.map(({index,result})=>{
      const source=manifest.fixtures[index].id;
      if(!result.ok||!result.review)return {source,ok:false};
      let review=result.review;const block=locateRequirementBlock(review);const applied:string[]=[],conflicts:string[]=[];
      if(block.status==='located'){
        const product=productRequirements(review);
        for(const row of block.rows){
          const v=bn1.get(source+'-'+row.field)??null,p=product[row.field];
          if(v===null)continue;
          if(p!==undefined&&p!==v){conflicts.push(row.field);continue;}
          const lines=review.lines.filter(l=>row.lineIds.includes(l.id)&&l.bounds);
          const main=lines.filter(l=>l.bounds!.width>=0.15).sort((a,b)=>a.bounds!.x-b.bounds!.x)[0];
          if(!main)continue;
          for(const l of lines)review=resolveReviewLine(review,l.id,l===main?`REQ ${row.field} : ${v}`:null);
          applied.push(row.field);
        }
      }
      return {source,ok:true,applied,conflicts,corsair:mapReviewedStats(review,'corsair'),questions:reviewQuestions(review,'corsair').map(l=>l.text),blocked:reviewBlocked(review,'corsair')};
    });
    await save('merged',{rule:'BN1 merge applied to review lines',merged});
    state.phase='complete';document.getElementById('status')!.textContent=JSON.stringify(state);
    await save('complete',{...state,variant,durationMs:performance.now()-started,recognitionMs,cropMs,timings,regions:regions.length,located:located.length});
  }catch(e){state.phase='failed';document.getElementById('status')!.textContent=String(e);await save('failed',{...state,error:String(e),durationMs:performance.now()-started});}
};
