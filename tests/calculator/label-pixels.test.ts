import { expect,it } from "vitest";
import { labelMaskSimilarity,normalizeLabelMask,separateLabelPixels,selectPixelLabel,singleGlyphCandidates,type PixelLabelEvidence,type PixelPlane } from "@/features/calculator/ocr/labelPixels";

function row():PixelPlane {
  const p={width:120,height:30,data:new Uint8ClampedArray(120*30*4)};
  for(let i=0;i<p.data.length;i+=4)p.data.set([15,15,15,255],i);
  const rect=(x:number,y:number,w:number,h:number)=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)p.data.set([235,235,235,255],(yy*120+xx)*4);};
  rect(4,14,2,2);rect(18,6,9,18);rect(34,6,9,18);rect(50,6,9,18);
  rect(72,10,2,3);rect(72,18,2,3);rect(86,7,10,17);
  return p;
}
it("locates a unique colon and preserves name pixels while excluding the leading marker and value",()=>{
  expect(separateLabelPixels(row())).toEqual({status:"located",separatorX:72,label:{x:17,y:5,width:43,height:20}});
});
it("does not turn diagonal glyph fragments into colon dots",()=>{
  const p=row();
  for(let n=0;n<14;n++)p.data.set([235,235,235,255],((7+n)*120+100+n)*4);
  expect(separateLabelPixels(p).status).toBe("located");
});
it("declines blank, low-contrast or ambiguous separator rows",()=>{
  const p=row();p.data.fill(25);expect(separateLabelPixels(p).status).toBe("unavailable");
  const q=row();for(const y of [10,18])for(let yy=y;yy<y+3;yy++)for(let x=102;x<104;x++)q.data.set([235,235,235,255],(yy*120+x)*4);
  expect(separateLabelPixels(q)).toEqual({status:"unavailable",reason:"separator-ambiguous"});
});
it("normalizes contrast without asserting a textual label",()=>{
  const mask=normalizeLabelMask(row());expect(mask).not.toBeNull();
  expect(labelMaskSimilarity(mask!.data,mask!.data)).toBeCloseTo(1);
  expect(labelMaskSimilarity(new Float32Array([1,0]),new Float32Array([0,1]))).toBe(0);
  expect(labelMaskSimilarity(new Float32Array([NaN]),new Float32Array([1]))).toBe(0);
});
const evidence=(best:string|null="DEX",score=.9,other=.7):PixelLabelEvidence=>({method:"font-pixels-v1",status:"read",sourceId:"source",operationId:"op",lineId:"row",
 candidates:[{text:best??"[EX",label:best,score,font:"Gulim",size:12,spacing:0},{text:"STR",label:"STR",score:other,font:"Gulim",size:12,spacing:0}]});
it("requires strong fit and separation from unknown alternatives, not merely the closest allowed word",()=>{
  expect(selectPixelLabel(evidence())).toMatchObject({label:"DEX"});
  expect(selectPixelLabel(evidence(null))).toBeNull();
  expect(selectPixelLabel(evidence("DEX",.7))).toBeNull();
  expect(selectPixelLabel(evidence("DEX",.9,.88))).toBeNull();
  const e=evidence();e.candidates.push({text:"[EX",label:null,score:.92,font:"Gulim",size:12,spacing:0});
  expect(selectPixelLabel(e)).toBeNull();
});
it("treats aliases of one known label as the same meaning while retaining a different unknown spelling",()=>{
  const e=evidence("올스탯",.91,.7);e.candidates.push({text:"올스텟",label:"올스탯",score:.905,font:"Gulim",size:12,spacing:0});
  expect(selectPixelLabel(e)?.label).toBe("올스탯");
  e.candidates.push({text:"홀스탯",label:null,score:.90,font:"Gulim",size:12,spacing:0});
  expect(selectPixelLabel(e)).toBeNull();
});
it("requires local pixel support against every near-tied alternative",()=>{
  const e=evidence("올스탯",.9,.89);
  e.candidates[1].contrast=.8;
  expect(selectPixelLabel(e)?.label).toBe("올스탯");
  e.candidates.push({text:"올스택",label:null,score:.885,font:"Gulim",size:12,spacing:0,contrast:.49});
  expect(selectPixelLabel(e)).toBeNull();
  e.candidates[2].contrast=1.1;
  expect(selectPixelLabel(e)).toBeNull();
});
it("uses exact whole-row agreement only when pixels independently prefer that same name",()=>{
  const e=evidence("올스탯",.9,.89);e.candidates[1].contrast=.2;
  expect(selectPixelLabel(e)).toBeNull();
  expect(selectPixelLabel(e,"올스탯")?.label).toBe("올스탯");
  expect(selectPixelLabel(e,"STR")).toBeNull();
  e.candidates[1].contrast=0;
  expect(selectPixelLabel(e,"올스탯")).toBeNull();
  e.candidates[1].contrast=.2;e.candidates[1].score=.91;
  expect(selectPixelLabel(e,"올스탯")).toBeNull();
});
it("includes unknown Hangul neighbours and never proposes a correction for Latin or multiple damaged glyphs",()=>{
  const vocabulary=[{text:"올스탯",label:"올스탯"},{text:"공격력",label:"공격력"}];
  const candidates=singleGlyphCandidates(["홀스탯","톨스탯"],vocabulary);
  expect(candidates).toContainEqual({text:"올스탯",label:"올스탯"});
  expect(candidates).toContainEqual({text:"홀스탯",label:null});
  expect(candidates).toContainEqual({text:"울스탯",label:null});
  expect(candidates).toContainEqual({text:"올스택",label:null});
  expect(candidates.length).toBeGreaterThan(60);
  for(const readings of [["REX"],["홀스택"],["홀스탯","올스택"],[]])expect(singleGlyphCandidates(readings,vocabulary)).toEqual([]);
});
