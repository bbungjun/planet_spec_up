import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import sharp from 'sharp';

// Stage diagnosis for TOOLTIP_NOT_FOUND: runs the product pixel detector on each locked
// source and checks whether any frame contains the reviewed requirement-value crops.
// Review crops are used only to score the detector, never to choose a region.
const arg=(key,fallback)=>process.argv.find(v=>v.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const app=process.cwd(),output=path.resolve(arg('output','output/ocr-tooltip-detection-20261021'));
const runDir=path.resolve(arg('run','output/ocr-requirement-block-20261021-followup31'));
if(!output.startsWith(path.join(app,'output')+path.sep))throw Error('Private output must stay under output/');
fs.mkdirSync(output,{recursive:true});
const bundle=path.join(output,'detect.cjs');
await build({entryPoints:['features/calculator/ocr/detectTooltip.ts'],bundle:true,platform:'node',format:'cjs',outfile:bundle,logLevel:'silent'});
const {detectTooltipRegions,selectTooltipRegion}=await import('file://'+bundle.replace(/\\/g,'/'));

const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const study='output/ocr-numeric-training/followup-photos-20261011/';
const lock=read(study+'pretest-lock.json').rows;
const truth=['review-dev.json','review-test.json'].flatMap(n=>read(study+n).rows).filter(r=>r.source.includes('followup-photos'));
const pipeline=read(path.join(runDir,'pipeline.json'));
const inside=(rect,[x,y,w,h])=>x>=rect.x&&y>=rect.y&&x+w<=rect.x+rect.width&&y+h<=rect.y+rect.height;

const decode=async file=>{const {data,info}=await sharp(path.resolve(app,file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {width:info.width,height:info.height,data};};
// The edge-gap bridging variant was tried (+5/-4 full frames) and reverted; only the product detector remains.
const variants={default:()=>({})};
const rows=[];
for(const row of lock){
  const pixels=await decode(row.frozenSource),info=pixels;
  const crops=truth.filter(t=>t.id.startsWith(row.id+'-')).map(t=>t.crop);
  const variant=arg('variant','default');
  const started=performance.now();
  const candidates=detectTooltipRegions(pixels,variants[variant](pixels));
  const selected=selectTooltipRegion(pixels,candidates);
  const ms=performance.now()-started;
  // The reviewed value crops bound the true tooltip from inside.
  const span={x:Math.min(...crops.map(c=>c[0])),y:Math.min(...crops.map(c=>c[1])),
    right:Math.max(...crops.map(c=>c[0]+c[2])),bottom:Math.max(...crops.map(c=>c[1]+c[3]))};
  const containing=candidates.filter(c=>crops.every(crop=>inside(c,crop)));
  const product=pipeline.reviews.find(r=>r.source===row.id);
  const condition=truth.find(t=>t.id.startsWith(row.id+'-'))?.condition??null;
  rows.push({id:row.id,condition,size:[info.width,info.height],broad:info.width>=700&&info.width>info.height*1.2,
    candidates:candidates.length,containing:containing.length,selectedContainsTruth:!!selected&&crops.every(c=>inside(selected,c)),
    selected:!!selected,selectedRect:selected,requirementSpan:span,candidateRects:candidates.map((c,i)=>({index:i,...c,containsTruth:crops.every(crop=>inside(c,crop)),body:selectTooltipRegion(pixels,[c])===c})),ms:Math.round(ms),
    product:product?.ok?'recognized':product?.error?.code});
}
const stage=r=>!r.candidates?'no-frame-candidate':!r.containing?'frames-miss-tooltip':!r.selected?'selection-rejected':!r.selectedContainsTruth?'selected-wrong-frame':'pixel-ok';
for(const r of rows)r.stage=stage(r);
const summary={variant:arg('variant','default'),images:rows.length,byStage:{},byProduct:{}};
for(const r of rows){const k=`${r.condition}|${r.stage}`;summary.byStage[k]=(summary.byStage[k]??0)+1;
  const p=`${r.stage}|${r.product}`;summary.byProduct[p]=(summary.byProduct[p]??0)+1;}
fs.writeFileSync(path.join(output,`detection-${summary.variant}.json`),JSON.stringify({summary,rows},null,2));
fs.rmSync(bundle);
process.exitCode=0;
console.log(JSON.stringify(summary,null,2));
