import {NumericRuntimeClient} from './runtime-client.js';

const params=new URLSearchParams(location.search),id=params.get('id'),model=params.get('model')??'BN1';
const batch=Number(params.get('batch')??6),rounds=Number(params.get('rounds')??6),mode=params.get('mode')??'normal';
if(typeof id!=='string'||!/^[a-z0-9-]+$/.test(id)||![1,6].includes(batch)||!Number.isInteger(rounds)||rounds<1||rounds>10||!['normal','dual','cancel-init','cancel-predict'].includes(mode))throw Error('Invalid trial');
const inputs=await fetch('/api/inputs').then(r=>r.json());
if(!inputs.models.includes(model))throw Error('Unknown model');
const state={id,model,batch,rounds,mode,phase:'ready',running:false,outputs:[],events:[],liveWorkers:0,
  modelSha256:inputs.modelHashes[model],inputHashes:inputs.rows.map(r=>r.sha256),userAgent:navigator.userAgent,
  hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory??null};
window.numericRuntimeTrial=state;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let started=0,clients=[],cancelArmed=false,reportTail=Promise.resolve();
const event=(name,detail={})=>state.events.push({name,elapsedMs:performance.now()-started,...detail});
const report=()=>{
  state.elapsedMs=started?performance.now()-started:0;
  state.mainJsHeap=performance.memory?performance.memory.usedJSHeapSize:null;
  document.getElementById('status').textContent=JSON.stringify({...state,outputs:state.outputs.length,events:state.events.length,inputHashes:state.inputHashes.length},null,2);
  const body=JSON.stringify(state);
  reportTail=reportTail.catch(()=>undefined).then(async()=>{
    const response=await fetch('/api/runtime/progress?id='+id,{method:'POST',headers:{'Content-Type':'application/json'},body});
    if(!response.ok)throw Error('Runtime receipt failed: '+response.status);
  });
  return reportTail;
};
function createClient(allowCancel=true){
  const client=new NumericRuntimeClient(phase=>{
    state.phase=phase;event(phase);void report().catch(error=>client.terminate(error));
    if(allowCancel&&!cancelArmed&&((mode==='cancel-init'&&phase==='initializing')||(mode==='cancel-predict'&&phase==='recognizing'))){
      cancelArmed=true;setTimeout(()=>{event('cancel-requested',{actualPhase:state.phase});client.terminate();state.liveWorkers--;},20);
    }
  });
  clients.push(client);state.liveWorkers++;event('worker-created');return client;
}
async function initialize(client,which=model){
  const start=performance.now();
  return {...await client.call('initialize',{model:which,batch,inputs:inputs.rows}),wallMs:performance.now()-start};
}
async function run(){
  state.running=true;started=performance.now();const heartbeat=[];let last=performance.now();
  const heart=setInterval(()=>{const now=performance.now();heartbeat.push(Math.max(0,now-last-50));last=now;},50);
  try{
    if(mode==='dual'){
      const resident=createClient(false);state.residentInitialization=await initialize(resident,'A1');
      const value=await resident.call('predict');state.residentRows=value.rows;event('baseline-resident');
    }
    let client=createClient();
    try{
      state.initialization=await initialize(client);
      for(let round=0;round<rounds;round++){
        const start=performance.now(),value=await client.call('predict');
        state.outputs.push({round,...value,wallMs:performance.now()-start});event('round-complete',{round,durationMs:value.durationMs});
        await report();
      }
      if(mode.startsWith('cancel-'))throw Error('Scheduled cancellation did not occur');
    }catch(error){
      if(!mode.startsWith('cancel-')||error.name!=='AbortError')throw error;
      state.cancelled=true;state.cancelSettledMs=performance.now()-started;state.outputsAtCancel=state.outputs.length;
      state.cancelLatencyMs=state.cancelSettledMs-state.events.find(e=>e.name==='cancel-requested').elapsedMs;
      await sleep(200);state.outputsAfterGrace=state.outputs.length;
      if(state.outputsAfterGrace!==state.outputsAtCancel)throw Error('Late cancelled result was accepted');
      client=createClient(false);state.restartInitialization=await initialize(client);
      const value=await client.call('predict');state.restart=value;event('restart-complete');
    }
    state.phase='disposing';await report();
    for(const client of clients){if(client.worker){await client.dispose();state.liveWorkers--;}}
    state.phase='settling';await report();await sleep(1500);
    state.phase='complete';
  }catch(error){state.phase='failed';state.error=String(error);}
  finally{
    clearInterval(heart);
    clients.forEach(client=>{if(client.worker){client.terminate();state.liveWorkers--;}});
    state.lateReplies=clients.reduce((n,c)=>n+c.lateReplies,0);state.heartbeatDelaysMs=heartbeat;
    state.running=false;await report();
  }
}
await report();
while(state.phase==='ready'){
  await sleep(250);const control=await fetch('/api/runtime/control?id='+id).then(r=>r.json());
  if(control.start){await run();break;}
}
