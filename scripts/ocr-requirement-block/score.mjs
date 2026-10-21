import fs from 'node:fs';
import path from 'node:path';

// Scores a finished run. The merge rule is fixed in protocol.json before inference.
const arg=(key,fallback)=>process.argv.find(v=>v.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const dir=path.resolve(arg('output','output/ocr-requirement-block-20261021'));
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const protocol=read(path.join(dir,'protocol.json')),pipeline=read(path.join(dir,'pipeline.json'));
const models=Object.fromEntries(['A1','BN1'].map(m=>[m,read(path.join(dir,m+'.json'))]));
for(const [m,r] of Object.entries(models))if(r.modelSha256!==protocol.models[m].sha256)throw Error('Model receipt mismatch '+m);
const located=pipeline.regions.filter(r=>!r.failure);
for(const r of Object.values(models))if(r.rows.length!==located.length||r.rows.some((row,i)=>row.id!==located[i].id||row.inputSha256!==located[i].cropSha256))throw Error('Prediction alignment changed');

const devTruth=read('output/ocr-accuracy-implementation/ground-truth.json').rows;
const newTruth=read('output/ocr-numeric-training/new-photos-20261011/review.json').rows;
const fieldOf={requiredLevel:'LEV',requiredSub:'STR'};
const value=raw=>{const t=String(raw??'').normalize('NFKC').trim();return /^\d{1,3}$/.test(t)?Number(t):null;};

// Truth: per source, requirement label → integer, plus dev19 full stat table.
const truth=new Map();
for(const f of protocol.fixtures){
  if(f.set==='dev19'){const t=devTruth.find(t=>t.name===f.name);if(!t)throw Error('Missing truth '+f.name);
    truth.set(f.id,{category:t.category,stats:t.stats,requirements:Object.fromEntries(Object.entries(fieldOf).filter(([k])=>t.stats[k]!==undefined).map(([k,l])=>[l,t.stats[k]]))});}
  else{const rows=newTruth.filter(r=>r.id.startsWith(f.id+'-'));if(rows.length!==5)throw Error('Missing truth '+f.id);
    truth.set(f.id,{requirements:Object.fromEntries(rows.map(r=>[r.field,Number(r.label)]))});}
}

const arms=['product','BN1-only','A1-only','BN1-merged','A1-merged'];
function decide(arm,p,dedicated){
  if(arm==='product')return {value:p};
  const v=dedicated[arm.split('-')[0]];
  if(arm.endsWith('only'))return {value:v};
  if(v==null)return {value:p};
  if(p==null)return {value:v,recovered:true};
  return v===p?{value:p}:{value:undefined,conflict:true};
}

const fields=[],equipment=[];
for(const review of pipeline.reviews){
  const t=truth.get(review.source);
  const dedicated=label=>Object.fromEntries(['A1','BN1'].map(m=>{
    const row=models[m].rows.find(r=>r.id===`${review.source}-${label}`);return [m,row?value(row.rawText):null];}));
  const perArm=Object.fromEntries(arms.map(a=>[a,{}]));
  for(const [label,expected] of Object.entries(t.requirements)){
    const p=review.ok?review.product.requirements[label]??null:null;
    const region=pipeline.regions.find(r=>r.id===`${review.source}-${label}`);
    const raw=Object.fromEntries(['A1','BN1'].map(m=>[m,models[m].rows.find(r=>r.id===`${review.source}-${label}`)?.rawText??null]));
    const row={source:review.source,set:review.set,label,expected,productValue:p,raw,regionFailure:region?.failure};
    for(const arm of arms){const d=decide(arm,p,dedicated(label));perArm[arm][label]=d.value;
      row[arm]=d.value==null?(d.conflict?'conflict':'missing'):d.value===expected?'correct':'wrong';}
    fields.push(row);
  }
  if(review.set==='dev19'){
    const row={source:review.source,ok:review.ok,categoryOk:review.ok&&(review.category==='목걸이'?'펜던트':review.category)===t.category,questions:review.product?.questions};
    for(const arm of arms){
      const stats={...(review.product?.corsair??{})};
      for(const [k,l] of Object.entries(fieldOf)){const v=perArm[arm][l];if(v==null)delete stats[k];else stats[k]=String(v);}
      const missing=Object.keys(t.stats).filter(k=>stats[k]===undefined);
      const wrong=Object.keys(stats).filter(k=>Number(stats[k])!==(t.stats[k]??0));
      row[arm]={complete:row.categoryOk&&!missing.length&&!wrong.length,missing,wrong};
    }
    equipment.push(row);
  }else{
    const row={source:review.source,ok:review.ok};
    for(const arm of arms)row[arm]={complete:fields.filter(f=>f.source===review.source).every(f=>f[arm]==='correct')};
    equipment.push(row);
  }
}

const count=(rows,arm,kind)=>rows.filter(r=>r[arm]===kind).length;
const summary={};
for(const set of ['dev19','new14']){
  const rows=fields.filter(f=>f.set===set),eq=equipment.filter(e=>pipeline.reviews.find(r=>r.source===e.source).set===set);
  summary[set]={fields:rows.length,blockLocated:pipeline.reviews.filter(r=>r.set===set&&r.block?.status==='located').length,
    images:eq.length,regionFailures:rows.filter(r=>r.regionFailure).length,
    arms:Object.fromEntries(arms.map(a=>[a,{correct:count(rows,a,'correct'),missing:count(rows,a,'missing'),conflict:count(rows,a,'conflict'),wrong:count(rows,a,'wrong'),
      equipmentComplete:eq.filter(e=>e[a].complete).length}])),
    regressions:Object.fromEntries(arms.slice(1).map(a=>[a,rows.filter(r=>r.product==='correct'&&r[a]!=='correct').length]))};
}
// Review-level outcome: product as recognized vs. review after the BN1 merge was applied to its lines.
const mergedPath=path.join(dir,'merged.json');
if(fs.existsSync(mergedPath)){
  const merged=read(mergedPath).merged;
  for(const set of ['dev19','new14']){
    const rows=equipment.filter(e=>pipeline.reviews.find(r=>r.source===e.source).set===set);
    const outcome=rows.map(e=>{const r=pipeline.reviews.find(r=>r.source===e.source),m=merged.find(m=>m.source===e.source);
      return {source:e.source,
        product:{questions:r.product?.questions??null,blocked:r.product?.blocked??true,complete:e.product.complete},
        merged:{questions:m?.questions?.length??null,blocked:m?.blocked??true,complete:e['BN1-merged'].complete,applied:m?.applied,conflicts:m?.conflicts}};});
    const noEdit=k=>outcome.filter(o=>o[k].complete&&o[k].questions===0&&!o[k].blocked).length;
    summary[set].review={productQuestions:outcome.reduce((n,o)=>n+(o.product.questions??0),0),mergedQuestions:outcome.reduce((n,o)=>n+(o.merged.questions??0),0),
      productNoEdit:noEdit('product'),mergedNoEdit:noEdit('merged'),productBlocked:outcome.filter(o=>o.product.blocked).length,mergedBlocked:outcome.filter(o=>o.merged.blocked).length,
      conflicts:outcome.reduce((n,o)=>n+(o.merged.conflicts?.length??0),0),outcome};
  }
}
const complete=fs.existsSync(path.join(dir,'complete.json'))?read(path.join(dir,'complete.json')):null;
fs.writeFileSync(path.join(dir,'score.json'),JSON.stringify({summary,timing:complete,fields,equipment},null,2));
console.log(JSON.stringify({summary,timing:complete&&{durationMs:complete.durationMs,recognitionMs:complete.recognitionMs,cropMs:complete.cropMs,timings:complete.timings}},null,2));
