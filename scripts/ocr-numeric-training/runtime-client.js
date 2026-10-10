// Experiment-only client. Termination invalidates pending and queued worker replies.
export class NumericRuntimeClient{
  constructor(onProgress){
    this.worker=new Worker(new URL('./numeric-runtime.worker.js',import.meta.url),{type:'module'});
    this.pending=new Map();this.sequence=0;this.lateReplies=0;this.onProgress=onProgress;
    const worker=this.worker;
    worker.onmessage=({data})=>{
      if(this.worker!==worker){this.lateReplies++;return;}
      const pending=this.pending.get(data.requestId);if(!pending){this.lateReplies++;return;}
      if(data.kind==='progress'){this.onProgress?.(data.phase);return;}
      this.pending.delete(data.requestId);
      if(data.kind==='error')pending.reject(Error(data.error));else pending.resolve(data.value);
    };
    worker.onerror=event=>{const error=Error(event.message);this.terminate(error);};
  }
  call(type,payload={}){
    if(!this.worker)return Promise.reject(new DOMException('Worker terminated','AbortError'));
    const requestId=++this.sequence;
    return new Promise((resolve,reject)=>{
      this.pending.set(requestId,{resolve,reject});this.worker.postMessage({requestId,type,payload});
    });
  }
  terminate(error=new DOMException('Cancelled','AbortError')){
    const worker=this.worker;this.worker=null;worker?.terminate();
    for(const promise of this.pending.values())promise.reject(error);this.pending.clear();
  }
  async dispose(){if(!this.worker)return;try{await this.call('dispose');}finally{this.terminate();}}
}
