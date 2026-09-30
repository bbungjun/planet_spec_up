import {expect,it} from "vitest";
import {assessTooltipCandidate,distinctCompleteCandidates,sameCandidateRegion,type AssessedTooltipCandidate} from "@/features/calculator/ocr/tooltipCandidate";
import type {OcrReading} from "@/features/calculator/ocr/types";

const line=(text:string,y:number,x=.06,width=.4):OcrReading=>({text,pass:0,bounds:{x,y,width,height:.035}});
const complete=()=>[line("테스트 훈장",.04,.2,.6),line("고유 아이템, 교환 불가",.12),line("REQ LEV : 10",.22,.42,.3),
  line("장비분류: 훈장",.56),line("STR +2",.65),line("DEX +2",.73),line("점프력 +15",.87)];
const image={width:900,height:1200};
const region={x:.1,y:.1,width:.3,height:.6};
const candidate=(readings=complete(),bounds=region):AssessedTooltipCandidate=>({region:bounds,assessment:assessTooltipCandidate(readings,image)});

it("accepts complete layouts without requiring a potential grade marker",()=>{
  expect(candidate().assessment.status).toBe("complete");
  expect(candidate(complete().map(l=>({...l,text:l.text.replace("테스트 훈장","다른 장비 (+7)")}))).assessment.status).toBe("complete");
});
it("rejects an inventory-containing crop even when its category and options are readable",()=>{
  const result=assessTooltipCandidate([line("UIPmENT INVENTORY",.02),...complete()],image);
  expect(result.status).toBe("rejected");expect(result.reasons).toContain("foreign-window-heading");
});
it("rereads clipped titles in color then rejects the still clipped crop",()=>{
  const readings=complete();readings[0]=line("테스트 훈",.04,.4,.6);
  expect(assessTooltipCandidate(readings,image).status).toBe("retry-color");
  const result=assessTooltipCandidate(readings,image,"color");
  expect(result.status).toBe("rejected");expect(result.reasons).toContain("clipped-title");
});
it("uses color as a bounded fallback for masked titles but not as permission to accept missing structure",()=>{
  const noTitle=complete().slice(1);
  expect(assessTooltipCandidate(noTitle,image).status).toBe("retry-color");
  expect(assessTooltipCandidate(complete(),image,"color").status).toBe("complete");
  expect(assessTooltipCandidate(noTitle,image,"color").status).toBe("rejected");
});
it("does not treat requirements alone or an option label as a complete gear title",()=>{
  expect(assessTooltipCandidate([line("REQ LEV : 10",.1),line("REQ STR : 0",.2),line("장비분류: 훈장",.5)],image,"color").status).toBe("rejected");
  const readings=complete();readings[0]=line("DEX",.04);
  expect(assessTooltipCandidate(readings,image,"color").status).toBe("rejected");
});
it("rejects a cut final option and equipment options mixed above the classification",()=>{
  const cut=complete();cut[cut.length-1]=line("점프력 +1",.98);
  expect(assessTooltipCandidate(cut,image,"color").reasons).toContain("clipped-equipment-content");
  const mixed=complete();mixed[4]=line("STR +2",.3);
  expect(assessTooltipCandidate(mixed,image,"color").reasons).toContain("options-above-classification");
});
it("preserves two real gear tooltips even with the same name and stats",()=>{
  expect(distinctCompleteCandidates([candidate(),candidate(complete(),{...region,x:.6})])).toHaveLength(2);
});
it("groups duplicate crops only when title and all options match original image positions",()=>{
  const wider={x:.09,y:.09,width:.32,height:.62};
  const readings=complete().map(l=>({...l,bounds:{x:(region.x+l.bounds!.x*region.width-wider.x)/wider.width,
    y:(region.y+l.bounds!.y*region.height-wider.y)/wider.height,width:l.bounds!.width*region.width/wider.width,height:l.bounds!.height*region.height/wider.height}}));
  expect(distinctCompleteCandidates([candidate(),candidate(readings,wider)])).toHaveLength(1);
  const different=readings.map(l=>({...l,text:l.text.replace("DEX +2","DEX +3")}));
  expect(distinctCompleteCandidates([candidate(),candidate(different,wider)])).toHaveLength(2);
});
it("does not discard incomplete alternatives merely because their rectangles overlap",()=>{
  expect(sameCandidateRegion(region,{...region})).toBe(true);
  expect(sameCandidateRegion(region,{...region,x:region.x+.002})).toBe(false);
  expect(distinctCompleteCandidates([candidate(complete().slice(1)),candidate()])).toHaveLength(1);
});
