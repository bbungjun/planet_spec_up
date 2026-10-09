import type { OcrBounds } from "./types";

export type PixelPlane = { width: number; height: number; data: Uint8ClampedArray };
export type LabelPixelRect = { x: number; y: number; width: number; height: number };
export type LabelMask = { width: number; height: number; data: Float32Array };
type Component = LabelPixelRect & { area: number };
export type LabelSeparation = { status: "located"; label: LabelPixelRect; separatorX: number }
  | { status: "unavailable"; reason: string };
export type PixelLabelScore = { text: string; label: string | null; score: number; font: string; size: number; spacing: number; contrast?: number };
export type PixelLabelEvidence = { method: "font-pixels-v1"; status: "read" | "unavailable"; reason?: string;
  sourceId: string; operationId: string; lineId: string; sourceBounds?: OcrBounds;
  candidates: PixelLabelScore[] };

export type LabelPixelCandidate = { text: string; label: string | null };

/** A dictionary proposes a search, never an answer. Include out-of-vocabulary
 * Hangul neighbours so a closed list cannot force an unrelated glyph to fit. */
export function singleGlyphCandidates(observed: string[], vocabulary: LabelPixelCandidate[]): LabelPixelCandidate[] {
  const names = [...new Set(observed.map(text => text.normalize("NFKC").replace(/\s/g, "")))];
  if (!names.length || names.some(text => !/^[가-힣]{3,16}$/.test(text))) return [];
  const matches = vocabulary.filter(candidate => candidate.label && names.every(name => {
    const text = candidate.text.replace(/\s/g, "");
    return name.length === text.length && [...name].filter((char, i) => char !== text[i]).length <= 1;
  }));
  if (new Set(matches.map(candidate => candidate.label)).size !== 1) return [];
  const candidate = matches[0];
  if (!candidate) return [];
  const text = candidate.text.replace(/\s/g, "");
  const positions = [...new Set(names.flatMap(name => [...name].flatMap((char, i) => char === text[i] ? [] : [i])))];
  if (positions.length !== 1) return [];
  const alternatives = new Set(names);
  // Even an agreed suffix can be wrong in every OCR pass. Challenge every
  // glyph, not just the position on which the observed names disagree.
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at) - 0xac00;
    if (code < 0 || code >= 11172) return [];
    const onset = Math.floor(code / 588), vowel = Math.floor(code / 28) % 21, coda = code % 28;
    const add = (initial: number, medial: number, final: number) => alternatives.add(text.slice(0, at)
      + String.fromCharCode(0xac00 + initial * 588 + medial * 28 + final) + text.slice(at + 1));
    for (let i = 0; i < 19; i++) add(i, vowel, coda);
    for (let i = 0; i < 21; i++) add(onset, i, coda);
    for (let i = 0; i < 28; i++) add(onset, vowel, i);
  }
  const known = new Map(vocabulary.map(c => [c.text.replace(/\s/g, ""), c.label]));
  return [...alternatives].map(name => ({ text: name, label: known.get(name) ?? null }));
}

function validPlane(p: PixelPlane) {
  return Number.isSafeInteger(p.width) && Number.isSafeInteger(p.height) && p.width > 0 && p.height > 0
    && p.width <= 2048 && p.height <= 256 && p.width * p.height <= 131072 && p.data.length === p.width * p.height * 4;
}
function luminance(p: PixelPlane) {
  const values=new Float32Array(p.width*p.height);
  for(let i=0;i<values.length;i++)values[i]=.299*p.data[i*4]+.587*p.data[i*4+1]+.114*p.data[i*4+2];
  return values;
}

/** Geometry only: a unique colon separates the name from the value; no label/value is guessed. */
export function separateLabelPixels(p: PixelPlane): LabelSeparation {
  const fail=(reason:string):LabelSeparation=>({status:"unavailable",reason});
  if(!validPlane(p))return fail("invalid-row-pixels");
  const {width:w,height:h}=p,g=luminance(p),ordered=Array.from(g).sort((a,b)=>a-b);
  const bg=ordered[Math.floor(ordered.length*.4)],peak=ordered[Math.floor(ordered.length*.98)];
  if(peak-bg<30)return fail("insufficient-label-contrast");
  const threshold=bg+(peak-bg)*.4,seen=new Uint8Array(w*h),parts:Component[]=[];
  for(let start=0;start<g.length;start++){
    if(seen[start]||g[start]<threshold)continue;
    const queue=[start];seen[start]=1;let x0=w,y0=h,x1=0,y1=0,area=0;
    for(let i=0;i<queue.length;i++){
      const at=queue[i],x=at%w,y=Math.floor(at/w);x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);area++;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy,next=yy*w+xx;
        if(xx>=0&&xx<w&&yy>=0&&yy<h&&!seen[next]&&g[next]>=threshold){seen[next]=1;queue.push(next);}
      }
    }
    parts.push({x:x0,y:y0,width:x1-x0+1,height:y1-y0+1,area});
  }
  const dots=parts.filter(a=>a.width<=h*.22&&a.height<=h*.25&&a.area>=2&&a.x>w*.1&&a.x+a.width-1<w*.9);
  const pairs:Array<{x:number;y:number;height:number}>=[];
  for(const a of dots)for(const b of dots){
    if(b.y<=a.y+a.height-1||Math.abs(a.x+a.width/2-b.x-b.width/2)>1.1)continue;
    const height=b.y+b.height-a.y;
    if(height<h*.22||height>h*.7||Math.abs((a.y+b.y+b.height-1)/2-h/2)>h*.3)continue;
    pairs.push({x:Math.min(a.x,b.x),y:a.y,height});
  }
  const columns=[...new Set(pairs.map(a=>a.x))];
  if(columns.length!==1)return fail("separator-ambiguous");
  const stop=columns[0],separator=pairs.find(a=>a.x===stop)!;
  const middle=separator.y+(separator.height-1)/2,half=separator.height*.9;
  let glyphs=parts.filter(a=>a.x+a.width-1<stop-2&&a.area>=2
    &&a.y+(a.height-1)/2>=middle-half&&a.y+(a.height-1)/2<=middle+half).sort((a,b)=>a.x-b.x);
  const first=glyphs[0];
  if(first&&first.width<h*.22&&first.height<h*.28&&first.area<h*.6)glyphs=glyphs.slice(1);
  if(!glyphs.length)return fail("no-label-pixels");
  const x=Math.max(0,Math.min(...glyphs.map(a=>a.x))-1),y=Math.max(0,Math.min(...glyphs.map(a=>a.y))-1);
  const right=Math.min(stop-2,Math.max(...glyphs.map(a=>a.x+a.width-1))+2);
  const bottom=Math.min(h,Math.max(...glyphs.map(a=>a.y+a.height-1))+2);
  if(x===0||y===0||bottom===h||right<=x)return fail("label-touches-row-edge");
  return {status:"located",label:{x,y,width:right-x,height:bottom-y},separatorX:stop};
}

export function trimLabelMask(data:Float32Array,w:number,h:number):LabelMask|null {
  let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(data[y*w+x]>.15){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  if(x1<x0||y1<y0)return null;
  const width=x1-x0+1,height=y1-y0+1,out=new Float32Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)out[y*width+x]=data[(y+y0)*w+x+x0];
  return {data:out,width,height};
}
export function normalizeLabelMask(p:PixelPlane):LabelMask|null {
  if(!validPlane(p))return null;
  const data=luminance(p),sorted=Array.from(data).sort((a,b)=>a-b);
  const bg=sorted[Math.floor(sorted.length*.5)],low=sorted[Math.floor(sorted.length*.02)],high=sorted[Math.floor(sorted.length*.98)];
  const white=high-bg>=bg-low,range=white?high-bg:bg-low;if(range<25)return null;
  for(let i=0;i<data.length;i++)data[i]=Math.max(0,Math.min(1,(white?data[i]-bg:bg-data[i])/range));
  return trimLabelMask(data,p.width,p.height);
}
export function labelMaskSimilarity(a:Float32Array,b:Float32Array):number {
  if(a.length!==b.length||!a.length)return 0;
  let intersection=0,sum=0;
  for(let i=0;i<a.length;i++){
    if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))return 0;
    intersection+=Math.min(a[i],b[i]);sum+=a[i]+b[i];
  }
  return sum?2*intersection/sum:0;
}


/** Fit and competing-glyph checks for the narrowly scoped label recovery strategy. */
export function selectPixelLabel(evidence:PixelLabelEvidence, exactRowLabel?:string):{label:string;score:number;margin:number}|null {
  if(evidence.status!=="read"||evidence.method!=="font-pixels-v1")return null;
  const meanings=new Map<string,PixelLabelScore>();
  for(const candidate of evidence.candidates){
    if(!Number.isFinite(candidate.score)||candidate.score<0||candidate.score>1)return null;
    const meaning=candidate.label??`unknown:${candidate.text}`;
    if((meanings.get(meaning)?.score??-1)<candidate.score)meanings.set(meaning,candidate);
  }
  const sorted=[...meanings.values()].sort((a,b)=>b.score-a.score);
  const best=sorted[0],second=sorted[1];
  if(!best?.label||!second||best.score<.75||best.score<=second.score)return null;
  // Whole-word overlap dilutes a one-stroke distinction. Every near-tied
  // alternative must also lose on the pixels where its template differs.
  // With an exact whole-row OCR label, require agreement between the two
  // readers and positive pixel support against every near alternative.
  // Without that textual evidence, retain the stronger standalone gate.
  const hasRowAgreement=exactRowLabel===best.label;
  if(sorted.slice(1).some(other=>best.score-other.score<.03
    && (other.contrast===undefined||!Number.isFinite(other.contrast)||other.contrast<=0
      || (!hasRowAgreement&&other.contrast<.5)||other.contrast>1+1e-6)))return null;
  return {label:best.label,score:best.score,margin:best.score-second.score};
}
