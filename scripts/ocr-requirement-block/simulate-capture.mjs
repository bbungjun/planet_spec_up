import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

// Simulates the guided capture path (Win+Shift+S around one tooltip) from full screenshots.
// The reviewed requirement crops only say WHICH tooltip a user would pick; the capture edges
// come from the tooltip's own gold border. Photos without that border are reported, not guessed.
const arg=(key,fallback)=>process.argv.find(v=>v.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const app=process.cwd(),output=path.resolve(arg('output','output/ocr-tooltip-capture-sim-20261021'));
if(!output.startsWith(path.join(app,'output')+path.sep))throw Error('Private output must stay under output/');
if(fs.existsSync(output)&&fs.readdirSync(output).length)throw Error('Use a new directory');
fs.mkdirSync(path.join(output,'sources'),{recursive:true});
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const study='output/ocr-numeric-training/followup-photos-20261011/';
const truth=['review-dev.json','review-test.json'].flatMap(n=>read(study+n).rows).filter(r=>r.source.includes('followup-photos'));
const MARGIN=6,GOLD=p=>p[0]>200&&p[1]>150&&p[2]<80;

const rows=[],skipped=[];
for(const row of read(study+'pretest-lock.json').rows){
  const crops=truth.filter(t=>t.id.startsWith(row.id+'-')).map(t=>t.crop);
  const sx=Math.min(...crops.map(c=>c[0])),sy=Math.min(...crops.map(c=>c[1]));
  const ex=Math.max(...crops.map(c=>c[0]+c[2])),ey=Math.max(...crops.map(c=>c[1]+c[3]));
  const {data,info}=await sharp(row.frozenSource).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const W=info.width,H=info.height,at=(x,y)=>{const o=(y*W+x)*4;return [data[o],data[o+1],data[o+2]];};
  // Nearest long gold vertical run on each side of the requirement values, bounded by the same rows.
  const column=(from,to,step)=>{
    for(let x=from;x!==to;x+=step){
      let run=0,best=null;
      for(let y=0;y<H;y++){if(GOLD(at(x,y))){run++;if(run>=120)best={x,bottom:y,top:y-run+1};}else run=0;}
      if(best)return best;
    }
    return null;
  };
  const left=column(sx,Math.max(0,sx-700),-1),right=column(ex,Math.min(W,ex+500),1);
  if(!left||!right||right.x-left.x<200){skipped.push({id:row.id,reason:'gold-border-not-found'});continue;}
  const top=(()=>{for(let y=Math.max(0,sy-1);y>=0;y--){let gold=0;for(let x=left.x;x<=right.x;x+=3)if(GOLD(at(x,y)))gold++;if(gold/((right.x-left.x)/3)>.8)return y;}return null;})();
  const bottom=(()=>{for(let y=ey;y<H;y++){let gold=0;for(let x=left.x;x<=right.x;x+=3)if(GOLD(at(x,y)))gold++;if(gold/((right.x-left.x)/3)>.8)return y;}return H-1;})();
  if(top===null){skipped.push({id:row.id,reason:'gold-top-not-found'});continue;}
  const rect={x:Math.max(0,left.x-MARGIN),y:Math.max(0,top-MARGIN)};
  rect.width=Math.min(W,right.x+MARGIN+1)-rect.x;rect.height=Math.min(H,bottom+MARGIN+1)-rect.y;
  const png=await sharp(row.frozenSource).extract({left:rect.x,top:rect.y,width:rect.width,height:rect.height}).png().toBuffer();
  const file=path.join(output,'sources',row.id+'.png');fs.writeFileSync(file,png);
  rows.push({id:row.id,frozenSource:path.relative(app,file).replace(/\\/g,'/'),sha256:sha(png),from:row.frozenSource,fromSha256:row.sha256,
    capture:rect,clippedAtScreenBottom:bottom>=H-2});
}
const lock={createdAt:new Date().toISOString(),method:'gold-border capture simulation, margin '+MARGIN+'px; reviewed requirement crops select which tooltip only',rows,skipped};
fs.writeFileSync(path.join(output,'pretest-lock.json'),JSON.stringify(lock,null,2),{flag:'wx'});
console.log(JSON.stringify({captured:rows.length,skipped,clippedAtScreenBottom:rows.filter(r=>r.clippedAtScreenBottom).length,sizes:rows.map(r=>`${r.id}:${r.capture.width}x${r.capture.height}`)},null,1));
