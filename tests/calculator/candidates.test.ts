import { expect, it } from "vitest";
import { createDefaultInput, emptyEquipment } from "@/features/calculator/domain/defaults";
import { candidateEquipment, compareCandidate, compareCandidatePresets, parseCandidatePrice, type PurchaseCandidate } from "@/features/calculator/domain/candidates";
const baseline=()=>{const input=createDefaultInput("corsair");input.equipment.buff!.attackFlat="0";input.equipment.projectile!.attackFlat="0";Object.assign(input.character,{level:"120",pureMain:"600",pureSub:"22",mapleWarrior:0,guildAttackFlat:"0",guildBossPercent:"0",guildIgnorePercent:"0"});Object.assign(input.equipment.weapon!,{attackFlat:"100",bossDamagePercent:"50",requiredLevel:"0",requiredSub:"0"});Object.assign(input.equipment.cape!,{mainFlat:"10",requiredLevel:"0",requiredSub:"0"});input.weaponPresets={active:"boss" as const,entries:{chaos:{weapon:{...input.equipment.weapon!,attackFlat:"200"},monsterDefense:"80"},hunting:{weapon:{...input.equipment.weapon!},monsterDefense:"0"}}};return input;};
const candidate=(patch:Partial<PurchaseCandidate>={}):PurchaseCandidate=>({id:"test",name:"후보",job:"corsair",slot:"weapon",category:"건",equipment:{...emptyEquipment(),attackFlat:"110",requiredLevel:"0",requiredSub:"0"},price:"0.3",...patch});
it("replaces one item, does not inherit missing boss stats, and preserves all source state",()=>{
 const input=baseline(),original=JSON.stringify(input),other=candidate();const result=compareCandidate(input,other);
 expect(result.status).toBe("ready");expect(result.before!.statAttack).toBe(2218);expect(result.after!.statAttack).toBe(2439);
 expect(result.stat!.difference).toBe(221);expect(result.stat!.percent).toBeCloseTo(221/2218*100);
 expect(result.converted!.after).toBe(2926);expect(result.converted!.difference).toBeLessThan(0);
 expect(result.after!.pureMain).toBe(600);expect(result.after!.pureSub).toBe(22);expect(JSON.stringify(input)).toBe(original);
});
it("compares each candidate independently across the three preset targets",()=>{
 const input=baseline();const one=compareCandidatePresets(input,candidate({slot:"cape",category:"망토",equipment:{...emptyEquipment(),mainFlat:"20",requiredLevel:"0",requiredSub:"0"}}));
 expect(one.map(r=>r.status)).toEqual(["ready","ready","ready"]);expect(one[0].after!.totalAttack).toBe(200);expect(one[1].after!.totalAttack).toBe(100);
 expect(one[1].after!.formulaInputs.bossAndTotalDamage).toBe(50);expect(one[2].after!.formulaInputs.bossAndTotalDamage).toBe(0);
 expect(one.map(r=>r.after!.formulaInputs.homingDamagePercent)).toEqual([20,20,0]);
 const two=compareCandidate(input,candidate({equipment:{...candidate().equipment,attackFlat:"120"}}));expect(two.before!.totalAttack).toBe(100);expect(two.after!.totalAttack).toBe(120);
});
it("compares three glove candidates when unchanged legacy pendants have no kind metadata",()=>{
 const input=baseline();
 Object.assign(input.equipment.necklace!,{mainFlat:"10",requiredLevel:"0",requiredSub:"0"});
 Object.assign(input.equipment.pendant_2!,{mainFlat:"15",requiredLevel:"0",requiredSub:"0"});
 Object.assign(input.equipment.gloves!,{mainFlat:"5",requiredLevel:"0",requiredSub:"0"});
 const original=JSON.stringify(input);
 for(const [index,mainFlat] of ["10","15","20"].entries()){
  const glove=candidate({id:`glove-${index}`,slot:"gloves",category:"장갑",equipment:{...emptyEquipment(),mainFlat,requiredLevel:"0",requiredSub:"0"}});
  const comparisons=compareCandidatePresets(input,glove);
  expect(comparisons.map(result=>result.status)).toEqual(["ready","ready","ready"]);
  for(const result of comparisons){expect(result.reasons).toEqual([]);expect(result.converted!.percent).toBeGreaterThan(0);}
 }
 expect(JSON.stringify(input)).toBe(original);
});
it("rejects unfixed base stats, wrong categories, removed slots and missing current equipment",()=>{
 const input=baseline();delete input.character.pureMain;expect(compareCandidate(input,candidate()).status).toBe("blocked");
 expect(compareCandidate(baseline(),candidate({category:"모자"})).status).toBe("blocked");
 expect(compareCandidate(baseline(),candidate({category:"석궁"})).status).toBe("blocked");
 expect(compareCandidate(baseline(),candidate({slot:"extra_deleted"})).status).toBe("blocked");
 expect(compareCandidate(baseline(),candidate({slot:"ring_1",category:"반지"})).reasons[0]).toContain("현재 장비");
});
it("does not fabricate rates for zero, invalid, unknown or unwearable inputs",()=>{
 let input=baseline();input.equipment.weapon!.attackFlat="0";let result=compareCandidate(input,candidate());expect(result.stat!.percent).toBeNull();
 input=baseline();const gear=candidate();gear.equipment.requiredSub="9999";result=compareCandidate(input,gear);expect(result.status).toBe("blocked");expect(result.converted).toBeUndefined();
 gear.equipment.requiredSub="0";gear.equipment.requiredLevel="121";expect(compareCandidate(input,gear).status).toBe("blocked");
 gear.equipment.requiredLevel="";result=compareCandidate(input,gear);expect(result.status).toBe("review");expect(result.converted!.percent).toBeNull();
 gear.equipment.attackFlat="-2";expect(compareCandidate(input,gear).status).toBe("blocked");
});
it("copies only supplied fields and validates positive decimal hundred-million prices",()=>{
 expect(candidateEquipment({mainFlat:"5",requiredSub:undefined})).toMatchObject({mainFlat:"5",requiredSub:"",attackFlat:""});
 expect(parseCandidatePrice("0.3")).toBe(.3);expect(parseCandidatePrice("1.25")).toBe(1.25);
 for(const price of ["","0","-1","abc","Infinity"])expect(parseCandidatePrice(price)).toBeNull();
});

it("normalizes the unrounded original-equipment gain per hundred million mesos",async()=>{
 const {candidatePriceEfficiency}=await import("@/features/calculator/domain/candidates");
 const comparison={preset:"boss" as const,status:"ready" as const,reasons:[],converted:{before:100,after:103,difference:3,percent:3}};
 expect(candidatePriceEfficiency(comparison,"0.3")).toBe(10);
 expect(candidatePriceEfficiency(comparison,"0.6")).toBe(5);
 expect(candidatePriceEfficiency({...comparison,converted:{...comparison.converted,percent:2.77912345}},"0.3")).toBeCloseTo(9.2637448333,9);
 expect(candidatePriceEfficiency({...comparison,converted:{...comparison.converted,percent:-3}},"0.3")).toBe(-10);
 expect(candidatePriceEfficiency({...comparison,converted:{...comparison.converted,percent:0}},"0.3")).toBe(0);
 for(const raw of ["","0","-1","Infinity"])expect(candidatePriceEfficiency(comparison,raw)).toBeNull();
 expect(candidatePriceEfficiency({...comparison,status:"review"},"0.3")).toBeNull();
 expect(candidatePriceEfficiency({...comparison,status:"blocked"},"0.3")).toBeNull();
 expect(candidatePriceEfficiency({...comparison,converted:{...comparison.converted,percent:null}},"0.3")).toBeNull();
});
