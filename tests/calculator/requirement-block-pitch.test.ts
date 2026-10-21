import {describe,it,expect} from 'vitest';
import {locateRequirementBlockByPitch} from '../../scripts/ocr-requirement-block/block-pitch';
import {hasGlyphs,redShare,trimAtGap,whitenRed,type Plane} from '../../scripts/ocr-requirement-block/value-crop';
import type {OcrReview,OcrReviewLine} from '../../features/calculator/ocr/types';

const line=(id:string,text:string,y:number,x=.39,width=.26):OcrReviewLine=>({id,text,status:'check',bounds:{x,y,width,height:.02},readings:[{text,pass:0}]});
const review=(lines:OcrReviewLine[]):OcrReview=>({category:null,warnings:[],lines});
const at=(i:number)=>.24+i*.025;

describe('pitch-anchored requirement rows',()=>{
  it('places a red LEV row the detector missed from STR/DEX anchors',()=>{
    const result=locateRequirementBlockByPitch(review([line('s','REQ STR : 0',at(1)),line('d','REQ DEX : 160',at(2)),line('i','FEQ INT : O',at(3))]));
    if(result.status!=='located')throw Error(result.reason);
    expect(result.rows[0].field).toBe('LEV');
    expect(result.rows[0].lineIds).toEqual([]);
    expect(result.rows[0].bounds.y+result.rows[0].bounds.height/2).toBeCloseTo(at(0)+.01);
    expect(result.rows[3].lineIds).toEqual(['i']);
  });
  it('works without ITEM rows and ignores rows below the block',()=>{
    const rows=[line('l','REQ LEV : 120',at(0)),line('s','REQ STR : 0',at(1)),line('p','REQ POP : 0',at(5)),line('o','DEX: +3',.5,.03,.3)];
    const result=locateRequirementBlockByPitch(review(rows));
    expect(result.status).toBe('located');
  });
  it('needs two exactly read anchors on one pitch and column',()=>{
    expect(locateRequirementBlockByPitch(review([line('s','REQ STR : 0',at(1))]))).toEqual({status:'unavailable',reason:'too-few-label-anchors'});
    expect(locateRequirementBlockByPitch(review([line('s','REQ STR : 0',at(1)),line('d','REQ DEX : 0',at(2),.45)]))).toEqual({status:'unavailable',reason:'anchors-not-aligned'});
    const uneven=[line('l','REQ LEV : 1',at(0)),line('s','REQ STR : 0',at(1)),line('d','REQ DEX : 0',at(3))];
    expect(locateRequirementBlockByPitch(review(uneven)).status).toBe('unavailable');
  });
  it('rejects two anchors whose pitch disagrees with the detected line spacing',()=>{
    // INT row misread as LUK: pitch from the two anchors would be 2/3 of the real spacing.
    const rows=[line('s','REQ STR : 0',at(1)),line('d','FEQ DEX : O',at(2)),line('x','REQ LUK : 0',at(3))];
    expect(locateRequirementBlockByPitch(review(rows))).toEqual({status:'unavailable',reason:'pitch-vs-spacing'});
  });
  it('rejects a placed row whose detected line names another requirement',()=>{
    // A misplaced anchor breaks the shared pitch.
    const misplaced=[line('s','REQ STR : 0',at(1)),line('d','REQ DEX : 0',at(2)),line('x','REQ LUK : 0',at(3))];
    expect(locateRequirementBlockByPitch(review(misplaced)).status).toBe('unavailable');
    // A non-anchor line read as two labels still vetoes the row it sits on.
    const mixed=line('x','REQ INT : 0',at(3));mixed.readings.push({text:'REQ LUK : 0',pass:1});
    expect(locateRequirementBlockByPitch(review([line('s','REQ STR : 0',at(1)),line('d','REQ DEX : 0',at(2)),mixed]))).toEqual({status:'unavailable',reason:'label-conflict-INT'});
  });
});

const plane=(w:number,h:number,paint:(x:number,y:number)=>number[]|null):Plane=>{
  const data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const c=paint(x,y)??[13,38,110];data.set([...c,255],(y*w+x)*4);}
  return {width:w,height:h,data};
};
describe('value crop helpers',()=>{
  it('whitens red glyphs only and reports their share',()=>{
    const p=plane(10,10,(x)=>x<3?[240,0,0]:x<5?[255,255,255]:null);
    expect(redShare(p)).toBeCloseTo(.6);
    const w=whitenRed(p);
    expect([...w.data.slice(0,3)]).toEqual([240,240,240]);
    expect([...w.data.slice(5*4*10+40,5*4*10+43)].length).toBe(3);
    expect(hasGlyphs(plane(10,10,()=>null))).toBe(false);
  });
  it('cuts the value at the first gap wider than the row height',()=>{
    const p=plane(80,10,(x)=>(x>=2&&x<8)||(x>=40&&x<44)?[255,255,255]:null);
    expect(trimAtGap(p,{x:0,width:80})).toBe(8+2);
  });
});
