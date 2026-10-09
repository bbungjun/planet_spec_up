import { expect, it } from "vitest";
import { canonicalRecoveryLabel, evaluateLabelRecovery, type LabelRecoveryObservation } from "@/features/calculator/ocr/recoverLabels";
import { createSourceFrame, locateSourceRegion, type SourceFrame } from "@/features/calculator/ocr/sourceFrame";
import type { OcrReviewLine } from "@/features/calculator/ocr/types";
import { agreedLiteralValue } from "@/features/calculator/ocr/recognitionIssues";
import { overrideReviewRequirement } from "@/features/calculator/ocr/reviewRecognition";
import type { PixelLabelEvidence } from "@/features/calculator/ocr/labelPixels";

const frame = (): SourceFrame => createSourceFrame(new File(["source"], "source.png"), new File(["crop"], "crop.png"), {
  version: 1, kind: "selected", inset: 0, sourceSize: { width: 1000, height: 800 }, preparedSize: { width: 300, height: 600 },
  crop: { x: 100, y: 50, width: 300, height: 600 },
}, { sourceId: "source", operationId: "operation" })!;
const line = (): OcrReviewLine => ({ id: "row", bounds: { x: .1, y: .3, width: .6, height: .03 }, text: "미식별:+6%", status: "check",
  readings: [0, 1].map(pass => ({ text: "미식별:+6%", pass,
    provenance: { role: "discovery", sourceId: "source", operationId: "operation", viewId: `initial-${pass}`, readingId: `initial-${pass}` } })) });
const weight = (s: string) => [...s].reduce((n, c) => n + (/[가-힣]/.test(c) ? 1 : /\s/.test(c) ? .3 : .55), 0);
function observations(row = line(), source = frame(), label = "DEX"): LabelRecoveryObservation[] {
  const value=agreedLiteralValue(row)!;
  const fraction = Math.min(.9, weight(value.labelText) / weight(value.labelText+" : +"+value.literal) + .04);
  return (["row", "label"] as const).flatMap(part => (["color", "luma"] as const).map(mode => {
    const viewId = `${part}-${mode}`;
    const bounds = { ...row.bounds!, width: row.bounds!.width * (part === "row" ? 1 : fraction) };
    return { part, mode, scale: 3, sourceId: source.sourceId, operationId: source.operationId, lineId: row.id, viewId,
      bounds, sourceBounds: locateSourceRegion(source, bounds, 2)!.bounds, status: "read", readings: [{
        text: part === "row" ? `${label}:+${value.literal}` : `${label}:`, pass: 3, bounds,
        provenance: { role: "verification", sourceId: source.sourceId, operationId: source.operationId, rowId: row.id, viewId, readingId: viewId },
      }] };
  }));
}
it("recovers a label only after whole-row values and separately read labels agree", () => {
  const row = line(), before = structuredClone(row);
  expect(evaluateLabelRecovery(row, frame(), observations(row))).toMatchObject({ status: "recovered", option: { label: "DEX", value: 6, percent: true } });
  expect(row).toEqual(before);
});
it("keeps all numeric/unit conflicts and cannot replace the original literal", () => {
  for (const text of ["DEX:+60%", "DEX:+6", "DEX:+6% 1I", "DEX:+O%"]){
    const views = observations();views[1].readings[0].text = text;
    expect(evaluateLabelRecovery(line(), frame(), views).status).toBe("unresolved");
  }
});
it("still inspects later numeric evidence when an earlier name remains unreadable", () => {
  const views=observations();views[0].readings[0].text="홀스탯:+6%";
  views[1].readings[0].text="홀스탯:+60%";
  expect(evaluateLabelRecovery(line(),frame(),views).reason).toBe("numeric-or-unit-conflict");
});
it("does not discard a final contradictory or missing label read", () => {
  const views = observations();views[3].readings[0].text = "STR:";
  expect(evaluateLabelRecovery(line(), frame(), views).reason).toBe("label-conflict");
  views[3].readings = [];
  expect(evaluateLabelRecovery(line(), frame(), views).status).toBe("unresolved");
  expect(evaluateLabelRecovery(line(), frame(), observations().slice(0, 3)).status).toBe("unresolved");
});
it("rejects duplicate, stale, foreign-region and adjacent-row evidence", () => {
  for (const mutate of [
    (v: LabelRecoveryObservation[]) => {v[3] = v[2];},
    (v: LabelRecoveryObservation[]) => {v[3].operationId = "old";},
    (v: LabelRecoveryObservation[]) => {v[3].sourceBounds.x += .1;},
    (v: LabelRecoveryObservation[]) => {v[3].readings[0].bounds!.y += .2;},
    (v: LabelRecoveryObservation[]) => {v[3].readings[0].bounds!.x += .7;},
    (v: LabelRecoveryObservation[]) => {v[3].readings[0].provenance!.viewId = "other";},
    (v: LabelRecoveryObservation[]) => {v[3].status = "failed";},
  ]){
    const views=observations();mutate(views);
    expect(evaluateLabelRecovery(line(),frame(),views).status).toBe("unresolved");
  }
});
it("does not use spelling guesses or numeric text as a label", () => {
  expect(canonicalRecoveryLabel("· DEX :")).toBe("DEX");
  expect(canonicalRecoveryLabel("보스 공격 시 데미지:")).toBe("보스데미지");
  for (const raw of ["홀스탯", "[EX", "DEX +6", "DEX:3", "REQ STR", "unknown"]) expect(canonicalRecoveryLabel(raw)).toBeNull();
});
it("retains an adjacent row fragment but never joins its number into this row", () => {
  const views=observations();
  views[0].readings.push({text:"80",pass:3,bounds:{x:.12,y:.335,width:.1,height:.008},
    provenance:{...views[0].readings[0].provenance!,readingId:"adjacent-row"}});
  const decision=evaluateLabelRecovery(line(),frame(),views);
  expect(decision.status).toBe("recovered");
  expect(decision.observations[0].readings).toHaveLength(2);
  expect(decision.selectedReadingIds).not.toContain("adjacent-row");
  views[0].readings[1].bounds!.y=.303;
  expect(evaluateLabelRecovery(line(),frame(),views).status).toBe("unresolved");
});
it("keeps a nested label-stroke duplicate in evidence but never filters a number or a whole-row sign",()=>{
  for(const [part,text,expected] of [[2,"–","recovered"],[2,"1","unresolved"],[0,"–","unresolved"]] as const){
    const views=observations(),parent=views[part].readings[0];
    views[part].readings.push({text,pass:3,bounds:{x:parent.bounds!.x+.02,y:parent.bounds!.y+.005,width:.01,height:.004},
      provenance:{...parent.provenance!,readingId:"nested"}});
    const result=evaluateLabelRecovery(line(),frame(),views);
    expect(result.status).toBe(expected);
    expect(result.observations[part].readings).toHaveLength(2);
    if(expected==="recovered")expect(result.selectedReadingIds).not.toContain("nested");
  }
});
it("preserves human-owned rows and refuses repeated original IDs", () => {
  for (const status of ["confirmed", "ignored", "recognized"] as const) expect(evaluateLabelRecovery({ ...line(), status },frame(),observations()).status).toBe("unresolved");
  const row=line();row.readings[1].provenance!.readingId=row.readings[0].provenance!.readingId;
  expect(evaluateLabelRecovery(row,frame(),observations()).status).toBe("unresolved");
});
it("does not turn a damaged requirement name or a known field missing its unit into a label recovery", () => {
  for (const raw of ["REQ LE!:6", "보스데미지:+6"]){
    const row=line();row.text=raw;row.readings=row.readings.map(r=>({...r,text:raw}));
    expect(evaluateLabelRecovery(row,frame(),observations()).reason).toBe("not-label-only");
  }
});
it("preserves large-flat-stat and critical-rate review rules after recovering the label", () => {
  for(const [raw,label] of [["미식별:+600","DEX"],["미식별:+101%","크리티컬확률"]]){
    const row=line();row.text=raw;row.readings=row.readings.map(r=>({...r,text:raw}));
    expect(evaluateLabelRecovery(row,frame(),observations(row,frame(),label)).reason).toBe("review-policy-blocked");
  }
});
it("normalizes existing non-calculation defense reference spellings without confusing attack or defense-ignore", () => {
  const row=line();row.text="물리 밤머력:+137";row.readings=row.readings.map(r=>({...r,text:row.text}));
  const views=observations(row,frame(),"물리 방어력");
  views[1].readings[0].text="물리 방머력:+137";views[3].readings[0].text="물리 방미력:";
  expect(evaluateLabelRecovery(row,frame(),views)).toMatchObject({status:"recovered",option:{label:"물리 방어력",value:137}});
  expect(canonicalRecoveryLabel("물리 공격력")).toBe("공격력");
  expect(canonicalRecoveryLabel("물리 방무력")).toBeNull();
  expect(canonicalRecoveryLabel("물리 밤머력")).toBeNull();
  expect(canonicalRecoveryLabel(": 물리 방머력")).toBe("물리 방어력");
});
it("invalidates recovered bonus evidence on a manual aggregate edit without turning it into a requirement", () => {
  const row=line(), decision=evaluateLabelRecovery(row,frame(),observations());
  const review={category:null,warnings:[],lines:[{...row,text:"DEX +6%",status:"recognized" as const,equipmentRecovery:decision}]};
  expect(overrideReviewRequirement(review,"corsair","requiredSub","40")).toBe(review);
  expect(overrideReviewRequirement(review,"corsair","attackFlat","30")).toBe(review);
  const changed=overrideReviewRequirement(review,"corsair","mainPercent","9")!;
  expect(changed.lines[0]).toMatchObject({text:"DEX +6%",equipmentRecovery:undefined});
  expect(review.lines[0].equipmentRecovery).toBe(decision);
});
function pixelCase() {
  const row=line();row.text="톨스택:+6%";row.readings=row.readings.map(r=>({...r,text:row.text}));
  const views=observations(row,frame(),"홀스탯");
  const candidates=evaluateLabelRecovery(row,frame(),views).pixelCandidates!;
  const pixels:PixelLabelEvidence={method:"font-pixels-v1",status:"read",sourceId:"source",operationId:"operation",lineId:row.id,
    sourceBounds:locateSourceRegion(frame(),{...row.bounds!,width:row.bounds!.width*.5},0)!.bounds,
    candidates:candidates.map(c=>({...c,score:c.label?.85:.7,font:"Gulim",size:12,spacing:0,contrast:.8}))};
  return {row,views,pixels};
}
it("recovers a pixel-supported glyph without changing the literal or raw OCR evidence",()=>{
  const {row,views,pixels}=pixelCase();
  expect(evaluateLabelRecovery(row,frame(),views,pixels)).toMatchObject({status:"recovered",reason:"source-glyph-and-row-agreement-v1",option:{label:"올스탯",value:6,percent:true}});
  expect(row.readings[0].text).toBe("톨스택:+6%");
  expect(views[0].readings[0].text).toBe("홀스탯:+6%");
});
it("cannot use stale, clipped, incomplete or competing pixel evidence",()=>{
  for(const mutate of [
    (p:PixelLabelEvidence)=>{p.operationId="old";},
    (p:PixelLabelEvidence)=>{p.lineId="another";},
    (p:PixelLabelEvidence)=>{p.sourceBounds!.x+=.3;},
    (p:PixelLabelEvidence)=>{p.sourceBounds!.width=-1;},
    (p:PixelLabelEvidence)=>{p.candidates.pop();},
    (p:PixelLabelEvidence)=>{p.candidates[0]={...p.candidates[1]};},
    (p:PixelLabelEvidence)=>{p.candidates.find(c=>!c.label)!.score=.99;},
    (p:PixelLabelEvidence)=>{p.status="unavailable";},
  ]){
    const {row,views,pixels}=pixelCase();mutate(pixels);
    expect(evaluateLabelRecovery(row,frame(),views,pixels).status).toBe("unresolved");
  }
});
it("pixel evidence never overrides a numeric or unit contradiction",()=>{
  for(const raw of ["홀스탯:+60%","홀스탯:+6","홀스탯:+6% 1I"]){
    const {row,views,pixels}=pixelCase();views[1].readings[0].text=raw;
    expect(evaluateLabelRecovery(row,frame(),views,pixels).reason).toBe("numeric-or-unit-conflict");
  }
});
it("distinguishes exact row-and-pixel agreement from a pixel-only recovery",()=>{
  const {row,views,pixels}=pixelCase();
  for(const candidate of pixels.candidates)if(!candidate.label){candidate.score=.84;candidate.contrast=.2;}
  expect(evaluateLabelRecovery(row,frame(),views,pixels).status).toBe("unresolved");
  views[1].readings[0].text="올스탯:+6%";
  expect(evaluateLabelRecovery(row,frame(),views,pixels)).toMatchObject({status:"recovered",reason:"source-row-label-and-glyph-agreement-v1"});
  views[1].readings[0].text="올스탯:+60%";
  expect(evaluateLabelRecovery(row,frame(),views,pixels).reason).toBe("numeric-or-unit-conflict");
});
