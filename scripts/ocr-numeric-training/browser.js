import {PaddleOCR} from '@paddleocr/paddleocr-js';

const inputs=await fetch('/api/inputs').then(r=>r.json());
const picker=document.getElementById('model');
inputs.models.forEach(id=>{const option=document.createElement('option');option.textContent=id;picker.append(option);});
const state={running:false,phase:'ready',rows:[]};
window.trainingReplay=state;
const status=()=>{document.getElementById('status').textContent=JSON.stringify({...state,rows:state.rows.length},null,2);};
status();
document.getElementById('run').onclick=async()=>{
  if(state.running)return;
  Object.assign(state,{running:true,phase:'initializing',rows:[],error:null,model:picker.value,batch:Number(document.getElementById('batch').value)});status();
  let engine;const mats=[];const started=performance.now();
  try{
    engine=await PaddleOCR.create({worker:false,textDetectionModelName:'PP-OCRv5_mobile_det',textDetectionModelAsset:{url:'/ocr/paddle/models/det.tar'},
      textRecognitionModelName:'korean_PP-OCRv5_mobile_rec',textRecognitionModelAsset:{url:'/model/'+state.model},textRecognitionBatchSize:state.batch,
      ortOptions:{backend:'wasm',wasmPaths:'/ocr/paddle/ort/',numThreads:1,simd:true}});
    state.initializationMs=performance.now()-started;
    if(typeof engine.recModel?.predict!=='function')throw Error('SDK recognition-only interface changed');
    for(const row of inputs.rows){
      const bitmap=await createImageBitmap(await fetch(row.url).then(r=>r.blob()));
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
      mats.push(engine.cv.matFromImageData(ctx.getImageData(0,0,canvas.width,canvas.height)));
    }
    state.phase='recognizing';status();const t=performance.now();
    const results=await engine.recModel.predict(engine.cv,mats);
    if(results.length!==inputs.rows.length)throw Error('Output count mismatch');
    state.recognitionMs=performance.now()-t;
    state.rows=results.map((r,i)=>({id:inputs.rows[i].id,rawText:r.text,score:r.score,inputSha256:inputs.rows[i].sha256}));
    state.phase='complete';
  }catch(e){state.error=String(e);state.phase='failed';}
  finally{
    mats.forEach(m=>m.delete());await engine?.dispose();state.running=false;state.totalMs=performance.now()-started;
    state.modelSha256=inputs.modelHashes[state.model];state.userAgent=navigator.userAgent;
    const response=await fetch('/api/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});
    if(!response.ok)state.error='Receipt save failed';status();
  }
};
