import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {rawNumericText} from './value-text.mjs';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const output=path.resolve(arg('output',path.join(app,'output/playwright/ocr-numeric-regions-20261010')));
const truthPath=path.resolve(arg('truth',path.join(app,'output/ocr-accuracy-implementation/ground-truth.json')));
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const data=read(path.join(output,'result-baseline.json')),segments=read(path.join(output,'result-segmentation.json'));
if(data.error||data.running)throw Error('The model run failed or is incomplete');
if(data.manifestName!==segments.manifestName)throw Error('Segmentation and prediction sources differ');
const truth=read(truthPath).rows;
const cases=segments.rows.map(row=>{
  const entry=truth.find(t=>t.name===row.name);
  if(!entry||entry.stats[row.target.field]===undefined)throw Error('Missing field truth');
  return {...row,expected:String(entry.stats[row.target.field])};
});
if(new Set(cases.map(c=>c.id)).size!==cases.length)throw Error('Duplicate target IDs');
const scored=data.rows.map(row=>{
  const c=cases.find(c=>c.id===row.id);if(!c)throw Error('Unknown target');
  const rawValue=rawNumericText(row.rawText,row.variant,c.target.kind);
  const numeric=rawValue!==null&&/^\d+$/.test(rawValue);
  return {id:row.id,sample:c.sample,field:c.target.field,kind:c.target.kind,profile:row.profile,variant:row.variant,expected:c.expected,
    rawText:row.rawText,rawValue,score:row.score,width:row.width,height:row.height,failure:row.failure,
    correct:!row.failure&&rawValue===c.expected,numeric,wrongNumeric:numeric&&rawValue!==c.expected,nonzeroToZero:c.expected!=='0'&&rawValue==='0'};
});
const groups=[];
for(const profile of ['current-contrast','min-inverted','original-color'])for(const variant of ['whole-row','number-fixed-canvas','number-tight']){
  const rows=scored.filter(r=>r.profile===profile&&r.variant===variant);
  if(rows.length!==cases.length||new Set(rows.map(r=>r.id)).size!==cases.length)throw Error('Incomplete comparison denominator');
  const base=scored.filter(r=>r.profile===profile&&r.variant==='whole-row');
  groups.push({profile,variant,total:rows.length,correct:rows.filter(r=>r.correct).length,requirements:rows.filter(r=>r.kind==='requirement').length,
    correctRequirements:rows.filter(r=>r.kind==='requirement'&&r.correct).length,correctBonus:rows.filter(r=>r.kind==='bonus'&&r.correct).length,
    zeroTotal:rows.filter(r=>r.expected==='0').length,correctZeros:rows.filter(r=>r.expected==='0'&&r.correct).length,
    nonzeroTotal:rows.filter(r=>r.expected!=='0').length,correctNonzeros:rows.filter(r=>r.expected!=='0'&&r.correct).length,
    wrongNumeric:rows.filter(r=>r.wrongNumeric).length,nonNumericOrEmpty:rows.filter(r=>!r.failure&&!r.numeric).length,segmentationFailed:rows.filter(r=>r.failure).length,
    nonzeroToZero:rows.filter(r=>r.nonzeroToZero).length,improved:rows.filter(r=>r.correct&&!base.find(b=>b.id===r.id).correct).length,
    regressed:rows.filter(r=>!r.correct&&base.find(b=>b.id===r.id).correct).length,
    sameInputSizesAsRow:rows.every(r=>{const b=base.find(b=>b.id===r.id);return r.width===b.width&&r.height===b.height;})});
}
const summary={manifestName:data.manifestName,modelComparisons:scored.length,targets:cases.length,segmentationLocated:cases.filter(c=>!c.failure).length,groups,
  scoringSources:Object.fromEntries(['score.mjs','value-text.mjs'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(app,'scripts/ocr-numeric-regions',name))).digest('hex')])),
  receiptSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(output,'result-baseline.json'))).digest('hex'),
  notes:['Development dataset and frozen previously located rows, not new-user validation or end-to-end equipment success.',
    'No character replacement, digit whitelist, training or per-image best-result selection.',
    'number-fixed-canvas preserves row dimensions, ordering and batch padding; number-tight also changes normalization/padding.',
    'Recognition-only in the browser; latency includes instrumented preprocessing and is not a speed benchmark.']};
fs.writeFileSync(path.join(output,'score.json'),JSON.stringify({summary,rows:scored},null,2));
console.log(JSON.stringify(summary,null,2));
