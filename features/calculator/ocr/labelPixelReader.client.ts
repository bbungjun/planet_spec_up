"use client";

import { labelMaskSimilarity, normalizeLabelMask, separateLabelPixels, trimLabelMask,
  type LabelMask, type PixelLabelEvidence, type PixelLabelScore } from "./labelPixels";
import { locateSourceRegion, type SourceFrame } from "./sourceFrame";
import type { OcrReviewLine } from "./types";

export type LabelPixelCandidate={text:string;label:string|null};
const active=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException("Cancelled","AbortError");};
const canvases=()=>document.createElement("canvas");
function resize(mask:LabelMask,width:number,height:number):Float32Array {
  const c=canvases();c.width=mask.width;c.height=mask.height;
  const ctx=c.getContext("2d")!;const p=ctx.createImageData(c.width,c.height);
  for(let i=0;i<mask.data.length;i++){p.data[i*4]=p.data[i*4+1]=p.data[i*4+2]=Math.round(mask.data[i]*255);p.data[i*4+3]=255;}
  ctx.putImageData(p,0,0);
  const out=canvases();out.width=width;out.height=height;const oc=out.getContext("2d")!;
  oc.drawImage(c,0,0,width,height);const pixels=oc.getImageData(0,0,width,height),values=new Float32Array(width*height);
  for(let i=0;i<values.length;i++)values[i]=pixels.data[i*4]/255;
  return values;
}

/** One bounded cache per matcher; only public vocabulary templates survive a call. */
export function createLabelPixelReader(){
  const cache=new Map<string,LabelMask|null>();
  let cacheBytes=0;
  function render(text:string,font:string,size:number,spacing:number,persist:boolean){
    const key=[text,font,size,spacing].join("/");if(persist&&cache.has(key))return cache.get(key)!;
    const c=canvases();c.width=600;c.height=80;const ctx=c.getContext("2d")!;
    ctx.fillStyle="white";ctx.font=`${size}px "${font}"`;ctx.textBaseline="top";
    let x=4;for(const char of text){ctx.fillText(char,x,4);x+=ctx.measureText(char).width+spacing;}
    const p=ctx.getImageData(0,0,Math.min(600,Math.ceil(x)+4),80),a=new Float32Array(p.width*p.height);
    for(let i=0;i<a.length;i++)a[i]=p.data[i*4+3]/255;
    const mask=trimLabelMask(a,p.width,p.height);
    if(persist){
      cache.set(key,mask);cacheBytes+=mask?.data.byteLength??0;
      while(cache.size>4096||cacheBytes>16*1024*1024){const oldest=cache.keys().next().value!;cacheBytes-=cache.get(oldest)?.data.byteLength??0;cache.delete(oldest);}
    }
    return mask;
  }
  return {
    dispose(){cache.clear();cacheBytes=0;},
    async read(frame:SourceFrame,line:OcrReviewLine,candidates:LabelPixelCandidate[],signal:AbortSignal):Promise<PixelLabelEvidence>{
      const base={method:"font-pixels-v1" as const,sourceId:frame.sourceId,operationId:frame.operationId,lineId:line.id};
      const fail=(reason:string):PixelLabelEvidence=>({...base,status:"unavailable",reason,candidates:[]});
      active(signal);
      if(!line.bounds||typeof createImageBitmap!=="function")return fail("missing-source-row");
      const region=locateSourceRegion(frame,line.bounds,1);
      if(!region||region.clipped||region.crop.width>2048||region.crop.height>256||region.crop.width*region.crop.height>131072)return fail("invalid-source-row");
      const bitmap=await createImageBitmap(frame.original);
      let actual:LabelMask|null,sourceBounds;
      try{
        active(signal);
        if(bitmap.width!==frame.sourceSize.width||bitmap.height!==frame.sourceSize.height)return fail("changed-source-size");
        const {x,y,width,height}=region.crop,c=canvases();c.width=width;c.height=height;const ctx=c.getContext("2d");if(!ctx)return fail("canvas-unavailable");
        ctx.drawImage(bitmap,x,y,width,height,0,0,width,height);
        const split=separateLabelPixels(ctx.getImageData(0,0,width,height));if(split.status!=="located")return fail(split.reason);
        const b=split.label;actual=normalizeLabelMask(ctx.getImageData(b.x,b.y,b.width,b.height));
        sourceBounds={x:(x+b.x)/bitmap.width,y:(y+b.y)/bitmap.height,width:b.width/bitmap.width,height:b.height/bitmap.height};
      }finally{bitmap.close();}
      if(!actual)return fail("empty-label-pixels");
      const height=32,width=Math.round(actual.width/actual.height*height);
      if(width<8||width>512)return fail("unsupported-label-shape");
      const input=resize(actual,width,height),scores:PixelLabelScore[]=[];
      const names=[...new Map(candidates.filter(c=>c.text.length>0&&c.text.length<=32).map(c=>[c.text,c])).values()].sort((a,b)=>Number(b.label!==null)-Number(a.label!==null));
      if(names.length>256)return fail("candidate-budget-exceeded");
      const styles:Array<{font:string;size:number;spacing:number;score:number}>=[],masks=new Map<string,Float32Array>();
      for(const candidate of names){
        let best:PixelLabelScore={...candidate,score:0,font:"",size:0,spacing:0};
        const variants=candidate.label!==null?["Dotum","Gulim","Arial"].flatMap(font=>Array.from({length:16},(_,i)=>i+9).flatMap(size=>[0,1].map(spacing=>({font,size,spacing})))):styles.slice(0,3);
        for(const {font:family,size,spacing} of variants){
          active(signal);
          const mask=render(candidate.text,family,size,spacing,candidate.label!==null);
          if(!mask||Math.abs((mask.width/mask.height)/(actual.width/actual.height)-1)>.3)continue;
          const pixels=resize(mask,width,height),score=labelMaskSimilarity(input,pixels);
          if(candidate.label!==null)styles.push({font:family,size,spacing,score});
          if(score>best.score){best={...candidate,score,font:family,size,spacing};masks.set(candidate.text,pixels);}
        }
        styles.sort((a,b)=>b.score-a.score);
        scores.push(best);
        // Let cancellation and user interaction run between names.
        await new Promise<void>(resolve=>setTimeout(resolve,0));active(signal);
      }
      scores.sort((a,b)=>b.score-a.score);
      const winner=scores[0],winningMask=winner&&masks.get(winner.text);
      if(winningMask)for(const score of scores){
        const other=masks.get(score.text);if(!other||score===winner)continue;
        let advantage=0,difference=0;
        for(let i=0;i<input.length;i++){
          advantage+=Math.abs(input[i]-other[i])-Math.abs(input[i]-winningMask[i]);
          difference+=Math.abs(other[i]-winningMask[i]);
        }
        score.contrast=difference?advantage/difference:0;
      }
      return {...base,status:"read",sourceBounds,candidates:scores};
    },
  };
}
