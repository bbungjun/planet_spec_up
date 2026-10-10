import {describe,it,expect} from 'vitest';
import {automaticTargets,requirementLabels} from '../../scripts/ocr-numeric-training/auto-targets';
import type {OcrReview,OcrReviewLine} from '../../features/calculator/ocr/types';

const line=(id:string,text:string):OcrReviewLine=>({id,text,status:'check',bounds:{x:.1,y:.2,width:.3,height:.1},readings:[{text,pass:0}]});
const review=(lines:OcrReviewLine[]):OcrReview=>({category:null,warnings:[],lines});
describe('automatic requirement experiment boundaries',()=>{
  it('locates all five labels independently of whether their values are readable',()=>{
    const result=automaticTargets(review(requirementLabels.map(f=>line(f,`REQ ${f}: unreadable`))));
    expect(result.map(r=>r.line?.id)).toEqual([...requirementLabels]);
    expect(result.every(r=>!r.failure)).toBe(true);
  });
  it('retains absent and duplicate rows as failures instead of selecting the first',()=>{
    const result=automaticTargets(review([line('a','REQ STR: 0'),line('b','REQ STR: 100')]));
    expect(result.find(r=>r.field==='STR')).toEqual({field:'STR',failure:'multiple-field-rows'});
    expect(result.find(r=>r.field==='LEV')).toEqual({field:'LEV',failure:'field-row-not-found'});
    expect(result).toHaveLength(5);
  });
  it('does not turn bonus stats or rows lacking geometry into requirement crops',()=>{
    const missing=line('missing','REQ LEV: 100');delete missing.bounds;
    expect(automaticTargets(review([line('bonus','DEX: +23'),missing])).every(r=>r.failure)).toBe(true);
  });
});
