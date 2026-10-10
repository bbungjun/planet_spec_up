import {PaddleOCR} from '@paddleocr/paddleocr-js';
import type {Mat} from '@techstark/opencv-js';
import {locateSourceRegion,type SourceFrameMetadata} from '../../features/calculator/ocr/sourceFrame';
import {numericRegion,type NumericTarget,type Rect} from './regions';

type Profile='current-contrast'|'min-inverted'|'original-color';
type Variant='whole-row'|'number-fixed-canvas'|'number-tight';
type Prediction={text:string;score:number};
type OpenCv={matFromImageData(image:ImageData):Mat};
type RecognitionEngine={cv:OpenCv;recModel:{predict(cv:OpenCv,mats:Mat[]):Promise<Prediction[]>};dispose():Promise<void>};
type Sample={index:number;name:string;sourceFrame:SourceFrameMetadata;targets:NumericTarget[]};
type Prepared={id:string;sample:number;name:string;target:NumericTarget;sourceCrop:Rect;row:HTMLCanvasElement;value?:Rect;failure?:string;originalPreview:string;numberPreview?:string};
type ResultRow={id:string;profile:Profile;variant:Variant;width:number;height:number;rawText:string|null;score:number|null;failure?:string;preview:string};
const profiles:Profile[]=['current-contrast','min-inverted','original-color'];
const variants:Variant[]=['whole-row','number-fixed-canvas','number-tight'];
const prepared:Prepared[]=[];
const controller=new AbortController();
const active=()=>{if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');};
const state:{running:boolean;phase:string;completed:number;error?:string;manifestName?:string;rows:ResultRow[];durationMs?:number}={running:false,phase:'idle',completed:0,rows:[]};
Object.assign(window,{numericExperiment:state});
const status=(phase:string)=>{state.phase=phase;document.getElementById('status')!.textContent=JSON.stringify({phase,completed:state.completed,error:state.error},null,2);};
const save=async(id:string,body:unknown)=>{const res=await fetch('/api/result/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!res.ok)throw Error('Local receipt write failed');};
function canvas(width:number,height:number){const c=document.createElement('canvas');c.width=width;c.height=height;return c;}
function background(row:HTMLCanvasElement){const p=row.getContext('2d')!.getImageData(0,0,row.width,row.height).data,channels=[[],[],[]] as number[][];
  for(let y=0;y<row.height;y++)for(let x=0;x<row.width;x++)if(x<2||x>=row.width-2||y<2||y>=row.height-2)for(let c=0;c<3;c++)channels[c].push(p[(y*row.width+x)*4+c]);
  return channels.map(values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)]??0);
}
function valueCanvas(p:Prepared,fixed:boolean){
  const b=p.value,c=canvas(fixed||!b?p.row.width:b.width,p.row.height),x=c.getContext('2d')!,rgb=background(p.row);
  x.fillStyle=`rgb(${rgb.join(',')})`;x.fillRect(0,0,c.width,c.height);
  if(b)x.drawImage(p.row,b.x,b.y,b.width,b.height,0,0,b.width,b.height);
  return c;
}
function view(p:Prepared,variant:Variant,profile:Profile){
  const source=variant==='whole-row'?p.row:valueCanvas(p,variant==='number-fixed-canvas');
  const c=canvas(source.width*3,source.height*3),ctx=c.getContext('2d',{willReadFrequently:true})!;
  ctx.imageSmoothingEnabled=false;ctx.drawImage(source,0,0,c.width,c.height);
  if(profile!=='original-color'){
    const image=ctx.getImageData(0,0,c.width,c.height);
    for(let i=0;i<image.data.length;i+=4){const v=Math.min(image.data[i],image.data[i+1],image.data[i+2]);
      const out=profile==='min-inverted'?255-v:255-Math.round(Math.max(0,Math.min(1,(v-135)/65))*255);
      image.data[i]=image.data[i+1]=image.data[i+2]=out;
    }ctx.putImageData(image,0,0);
  }return c;
}
function renderPreview(){const root=document.getElementById('preview')!;root.replaceChildren();
  for(const p of prepared){const item=document.createElement('article'),title=document.createElement('h2');title.textContent=`사진 ${p.sample+1} · ${p.target.field} · ${p.failure??'분리됨'}`;item.append(title);
    const grid=document.createElement('div');grid.className='grid';
    for(const variant of variants){const block=document.createElement('div'),label=document.createElement('small'),image=document.createElement('img');label.textContent=variant;image.src=view(p,variant,'original-color').toDataURL();image.alt=`${p.id} ${variant}`;block.append(label,image);grid.append(block);}item.append(grid);root.append(item);}
}
async function prepare(){if(state.running)return;state.running=true;prepared.length=0;state.completed=0;try{
  const manifest:{manifestName:string;samples:Sample[]}=await fetch('/api/manifest').then(r=>r.json());state.manifestName=manifest.manifestName;
  for(const sample of manifest.samples){active();status(`원본 ${sample.index+1} 영역 분리`);
    const bitmap=await createImageBitmap(await fetch('/input/'+encodeURIComponent(sample.name)).then(r=>r.blob()));
    try{for(const target of sample.targets){const region=locateSourceRegion(sample.sourceFrame,target.bounds,2);
      if(!region||region.clipped)throw Error(`Source row unavailable: ${sample.index}/${target.id}`);
      const c=canvas(region.crop.width,region.crop.height),ctx=c.getContext('2d',{willReadFrequently:true})!;
      ctx.drawImage(bitmap,region.crop.x,region.crop.y,c.width,c.height,0,0,c.width,c.height);
      const split=numericRegion(ctx.getImageData(0,0,c.width,c.height));
      const p:Prepared={id:`${sample.index}-${target.id}`,sample:sample.index,name:sample.name,target,sourceCrop:region.crop,row:c,originalPreview:c.toDataURL(),
        ...(split.status==='located'?{value:split.region}:{failure:split.reason})};
      if(p.value)p.numberPreview=valueCanvas(p,false).toDataURL();prepared.push(p);
    }}finally{bitmap.close();}
  }
  renderPreview();await save('segmentation',{manifestName:state.manifestName,rows:prepared.map(({row,...r})=>({...r,width:row.width,height:row.height}))});
  status(`영역 확인 완료: ${prepared.length}개 중 ${prepared.filter(p=>!p.failure).length}개 분리`);(document.getElementById('run') as HTMLButtonElement).disabled=false;
}catch(error){state.error=String(error);status('영역 분리 실패');}finally{state.running=false;}}
async function run(){if(state.running||!prepared.length)return;state.running=true;state.completed=0;state.rows=[];let engine:RecognitionEngine|undefined;const started=performance.now();try{
  status('설치된 모델 준비');
  engine=await PaddleOCR.create({worker:false,textDetectionModelName:'PP-OCRv5_mobile_det',textDetectionModelAsset:{url:'/ocr/paddle/models/det.tar'},textRecognitionModelName:'korean_PP-OCRv5_mobile_rec',textRecognitionModelAsset:{url:'/ocr/paddle/models/rec-ko.tar'},textRecognitionBatchSize:6,ortOptions:{backend:'wasm',wasmPaths:'/ocr/paddle/ort/',numThreads:1,simd:true}}) as unknown as RecognitionEngine;
  if(!engine.cv||typeof engine.recModel?.predict!=='function')throw Error('Recognition-only interface changed');
  for(const profile of profiles)for(const variant of variants){active();status(`${profile} / ${variant}`);const inputs=prepared.map(p=>view(p,variant,profile));
    const mats=inputs.map(c=>engine!.cv.matFromImageData(c.getContext('2d')!.getImageData(0,0,c.width,c.height)));
    try{const results=await engine.recModel.predict(engine.cv,mats);active();
      if(results.length!==prepared.length)throw Error('Output alignment changed');
      results.forEach((result,index)=>{const p=prepared[index],failed=variant!=='whole-row'?p.failure:undefined;state.rows.push({id:p.id,profile,variant,width:inputs[index].width,height:inputs[index].height,
        rawText:failed?null:result.text,score:failed?null:result.score,...(failed?{failure:failed}:{}),preview:inputs[index].toDataURL()});});
      state.completed+=prepared.length;await save('progress',{...state});
    }finally{mats.forEach(m=>m.delete());}
  }status('판독 완료');
}catch(error){state.error=String(error);status('판독 실패');}finally{await engine?.dispose();state.running=false;state.durationMs=performance.now()-started;await save('baseline',{...state});}}
document.getElementById('prepare')!.onclick=()=>void prepare();
document.getElementById('run')!.onclick=()=>void run();
document.getElementById('cancel')!.onclick=()=>controller.abort();
