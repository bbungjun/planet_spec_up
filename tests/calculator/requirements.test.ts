import { expect, it } from "vitest";
import { createDefaultInput, emptyEquipment } from "@/features/calculator/domain/defaults";
import { calculateDamageResult } from "@/features/calculator/domain/calculate";
import { checkEquipmentRequirements } from "@/features/calculator/domain/requirements";
import { normalizeInput } from "@/features/calculator/domain/normalize";
import { parseMapleTooltip } from "@/features/calculator/ocr/parseMapleTooltip";
import { mapRecognizedStats } from "@/features/calculator/ocr/mapRecognizedStats";
import { mapReviewedStats } from "@/features/calculator/ocr/reviewRecognition";
import { serializeSetup, deserializeSetup } from "@/features/calculator/storage";
import type { CalculatorInput } from "@/features/calculator/domain/types";
const base=()=>{const input=createDefaultInput("corsair");Object.assign(input.character,{level:"120",pureMain:"600",pureSub:"22",mapleWarrior:0});return input;};
const gear=(requiredLevel:string,requiredSub:string,subFlat:string,subPercent="")=>({...emptyEquipment(),requiredLevel,requiredSub,subFlat,subPercent});
const check=(input:CalculatorInput)=>checkEquipmentRequirements(input,normalizeInput(input).value);
it("allows a reachable chain from unrestricted gear, independent of slot order",()=>{
  const input=base();input.equipment.weapon=gear("120","80","5");input.equipment.hat=gear("120","0","40");input.equipment.cape=gear("120","60","20");
  expect(check(input)).toEqual([]);expect(calculateDamageResult(input).pureSub).toBe(22);
});
it("rejects a level deficit and does not lend the locked gear's STR to another item",()=>{
  const input=base();input.equipment.hat=gear("121","0","100");input.equipment.weapon=gear("120","50","0");
  const issues=check(input);expect(issues).toHaveLength(2);
  expect(issues.find(i=>i.path.endsWith("requiredLevel"))?.message).toContain("레벨 1 부족");
  expect(issues.find(i=>i.path.endsWith("requiredSub"))?.message).toContain("28 부족");
  input.character.level="121";expect(check(input)).toEqual([]);
});
it("excludes both the item's own flat STR and STR% when unlocking it",()=>{
  const input=base();input.equipment.weapon=gear("120","40","30","100");
  expect(check(input)[0]).toMatchObject({code:"UNMET_SUBSTAT_REQUIREMENT"});expect(check(input)[0].message).toContain("18 부족");
});
it("rejects circular dependency where neither item can be equipped first",()=>{
  const input=base();input.equipment.hat=gear("120","40","30");input.equipment.weapon=gear("120","40","30");
  expect(check(input).map(i=>i.code)).toEqual(["UNMET_SUBSTAT_REQUIREMENT","UNMET_SUBSTAT_REQUIREMENT"]);
});
it("uses Maple Warrior and the level milestone without modifying pure stats",()=>{
  const input=base();Object.assign(input.character,{level:"200",mapleWarrior:20});input.equipment.weapon=gear("200","27","0");
  expect(check(input)).toEqual([]);input.equipment.weapon.requiredSub="28";expect(check(input)[0].message).toContain("1 부족");
});
it("treats absent requirements or actual base stats as unknown, not no restriction",()=>{
  const input=base();input.equipment.hat={...emptyEquipment(),subFlat:"100"};input.equipment.weapon=gear("120","50","0");
  expect(check(input)).toEqual([]);
  input.equipment.hat=gear("0","0","100");delete input.character.pureMain;delete input.character.pureSub;
  expect(check(input)).toEqual([]);
});
it("includes custom unrestricted gear but only the selected weapon",()=>{
  const input=base();input.customSlots=[{id:"extra_test",label:"추가 장비"}];input.equipment.extra_test=gear("0","0","60");input.equipment.weapon=gear("120","80","0");
  input.weaponPresets={active:"boss",entries:{chaos:{weapon:gear("0","0","999"),monsterDefense:"80"}}};
  expect(check(input)).toEqual([]);input.equipment.extra_test.subFlat="0";expect(check(input)[0].code).toBe("UNMET_SUBSTAT_REQUIREMENT");
});
it("maps level and substat requirements separately through both OCR paths, preserving explicit zero",()=>{
  const text="REQ LEV : 120\nREQ STR : 0\nSTR : +5";
  expect(mapRecognizedStats(parseMapleTooltip(text),"corsair")).toMatchObject({requiredLevel:"120",requiredSub:"0",subFlat:"5"});
  expect(mapReviewedStats({category:null,warnings:[],lines:text.split("\n").map((text,i)=>({id:String(i),text,readings:[],status:"recognized"}))},"corsair")).toEqual({requiredLevel:"120",requiredSub:"0",subFlat:"5"});
});
it("roundtrips requirement levels and keeps old saves compatible",()=>{
  const input=base();expect(deserializeSetup(serializeSetup(input)).ok).toBe(true);input.equipment.weapon=gear("120","80","5");
  expect(deserializeSetup(serializeSetup(input))).toMatchObject({ok:true,value:{input:{equipment:{weapon:{requiredLevel:"120"}}}}});
});

it("does not warn merely because older gear has unrecognized requirements",()=>{
  const input=base();input.equipment.hat={...emptyEquipment(),mainFlat:"20",subFlat:"40"};input.equipment.weapon={...emptyEquipment(),attackFlat:"100"};
  const source=JSON.stringify(input);expect(check(input)).toEqual([]);expect(JSON.stringify(input)).toBe(source);
});
it("checks recognized STR independently of a missing level, using other gear before itself",()=>{
  const input=base();input.equipment.hat={...emptyEquipment(),subFlat:"20"};input.equipment.weapon={...emptyEquipment(),requiredSub:"50",subFlat:"100",subPercent:"100",attackFlat:"100"};
  expect(check(input)).toHaveLength(1);expect(check(input)[0]).toMatchObject({code:"UNMET_SUBSTAT_REQUIREMENT"});expect(check(input)[0].message).toContain("8 부족");
  input.equipment.hat.subFlat="28";expect(check(input)).toEqual([]);
});
it("checks recognized level independently of a missing STR, and skips unverified base stat failures",()=>{
  const input=base();input.equipment.weapon={...emptyEquipment(),requiredLevel:"121",attackFlat:"100"};
  expect(check(input)[0].code).toBe("UNMET_LEVEL_REQUIREMENT");input.equipment.weapon.requiredLevel="120";input.equipment.weapon.requiredSub="200";
  delete input.character.pureMain;delete input.character.pureSub;
  expect(check(input)).toEqual([]);expect(calculateDamageResult(input).issues.some(i=>i.code==="UNMET_SUBSTAT_REQUIREMENT")).toBe(false);
});
