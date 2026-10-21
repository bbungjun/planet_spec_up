import {describe,it,expect} from 'vitest';
import {locateRequirementBlock,requirementValue} from '../../scripts/ocr-requirement-block/block';
import type {OcrReview,OcrReviewLine} from '../../features/calculator/ocr/types';

const line=(id:string,text:string,y:number,x=.39,width=.26):OcrReviewLine=>({id,text,status:'check',bounds:{x,y,width,height:.02},readings:[{text,pass:0}]});
const review=(lines:OcrReviewLine[]):OcrReview=>({category:null,warnings:[],lines});
const texts=['REQ LE! : 1O0','FEQ STR :Q','REQ DEX : O','REQ IHT :ü','REQ LUK : Ω','FEQ FIOP :Q','ITEM LE!! :-','ITEM EHF :'];
const block=(rows=texts,start=.24,pitch=.022)=>rows.map((t,i)=>line('r'+i,t,start+i*pitch));
const options=['STR: +21','DEX: +35','INT: +21','LUK: +21','MaxHP: +10%','MaxMP: +10%','물리 방어력: +178','명중률: +35'].map((t,i)=>line('o'+i,t,.5+i*.03,.02,.3));

describe('requirement block experiment locator',()=>{
  it('assigns fields by row order even when most labels are misread',()=>{
    const result=locateRequirementBlock(review([...block(),...options]));
    expect(result.status).toBe('located');
    if(result.status!=='located')return;
    expect(result.rows.map(r=>[r.field,r.lineIds[0]])).toEqual([['LEV','r0'],['STR','r1'],['DEX','r2'],['INT','r3'],['LUK','r4']]);
  });
  it('rejects a block with a missing row instead of shifting the order',()=>{
    for(const missing of [0,3,7]){
      const rows=block().filter((_,i)=>i!==missing);
      expect(locateRequirementBlock(review(rows)).status).toBe('unavailable');
    }
  });
  it('vetoes a block whose readable label disagrees with its position',()=>{
    const swapped=[...texts];swapped[1]='REQ DEX : 0';swapped[2]='REQ STR : 0';
    expect(locateRequirementBlock(review(block(swapped)))).toEqual({status:'unavailable',reason:'label-conflict-STR'});
  });
  it('needs at least two exactly read labels as anchors',()=>{
    const garbled=texts.map(t=>t.replace(/^REQ/,'FEQ'));
    expect(locateRequirementBlock(review(block(garbled)))).toEqual({status:'unavailable',reason:'too-few-label-anchors'});
  });
  it('widens a row to a split value fragment but not to another column',()=>{
    const rows=[...block(),line('frag','0',.24+4*.022,.61,.03),line('other','공격력 증가량',.24,.7,.25)];
    const result=locateRequirementBlock(review(rows));
    if(result.status!=='located')throw Error(result.reason);
    expect(result.rows[4].lineIds).toContain('frag');
    expect(result.rows[0].lineIds).not.toContain('other');
    expect(result.rows[0].bounds.x+result.rows[0].bounds.width).toBeCloseTo(.39+.26+.02);
  });
  it('accepts only plain integers from the numeric reader',()=>{
    expect(['0','120',' 45 '].map(requirementValue)).toEqual([0,120,45]);
    expect(['O','1O0','','12%','1234','-'].map(requirementValue)).toEqual([null,null,null,null,null,null]);
  });
});
