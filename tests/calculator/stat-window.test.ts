import { describe, expect, it } from "vitest";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { calculateDamageResult } from "@/features/calculator/domain/calculate";
import { levelAchievementBonus, pureStatPool } from "@/features/calculator/domain/level";
import { applyStatWindow, compareStatWindow, isStatWindowSnapshot } from "@/features/calculator/domain/statWindow";
import { parseStatWindow, reconcileStatReads, statRows } from "@/features/calculator/ocr/parseStatWindow";
import { serializeSetup, deserializeSetup } from "@/features/calculator/storage";
import type { StatWindowSnapshot } from "@/features/calculator/domain/types";
const photo:StatWindowSnapshot={job:"corsair",level:200,capturedAt:"2026-09-27T00:00:00Z",pure:{DEX:1000,STR:22,INT:4,LUK:4},total:{DEX:2306,STR:81,INT:7,LUK:7},maxAttack:15000,bossDamagePercent:5,ignoreDefensePercent:10};

describe("level milestones and direct guild bonuses",()=>{
  it.each([[199,0,0],[200,2,3],[204,2,3],[205,4,6],[209,4,6],[210,6,9],[215,8,12],[220,10,15],[221,0,0],[200.5,0,0]])("level %s has attack %s and allstat %s",(level,attack,allStat)=>{
    expect(levelAchievementBonus(level)).toEqual({attack,allStat});
  });
  it("adds allstat before potential and excludes it from Maple Warrior base",()=>{
    const input=applyStatWindow(createDefaultInput("corsair"),photo);
    Object.assign(input.equipment.necklace!,{mainFlat:"100",subFlat:"20",mainPercent:"100",subPercent:"80"});
    input.equipment.weapon!.attackFlat="100";
    const result=calculateDamageResult(input);
    expect(result.mainStat).toBe(2306); // (1000+100+3)*2 + floor(1000*.1)
    expect(result.subStat).toBe(83); // floor((22+20+3)*1.8)+floor(22*.1)
    expect(result.totalAttack).toBe(102);
    input.equipment.weapon!.attackPercent="10";
    expect(calculateDamageResult(input).totalAttack).toBe(112);
    expect(calculateDamageResult(input).issues.some(i=>i.code==="LEVEL_BUFF_ATTACK_PERCENT_UNVERIFIED")).toBe(false);
  });
  it("scales the sum of equipment attack only and adds every other source afterward",()=>{
    const input=applyStatWindow(createDefaultInput("corsair"),photo);
    input.character.level="220";
    input.character.guildAttackFlat="5";
    Object.assign(input.equipment.weapon!,{attackFlat:"101",attackPercent:"10"});
    input.equipment.gloves!.attackFlat="9";
    input.equipment.projectile!.attackFlat="20";
    input.equipment.blessing_1!.attackFlat="15";
    input.equipment.blessing_2!.attackFlat="12";
    input.equipment.buff!.attackFlat="35";
    // floor((101+9)*1.10) + ammo20 + blessings27 + guild5 + buff35 + level10
    expect(calculateDamageResult(input).totalAttack).toBe(218);
    input.equipment.weapon!.attackPercent="0";
    expect(calculateDamageResult(input).totalAttack).toBe(207);
  });
  it("preserves legacy guild settings until direct bonuses are supplied, without double addition",()=>{
    const input=createDefaultInput("corsair");input.equipment.weapon!.attackFlat="100";
    Object.assign(input.character,{guildAttackLevel:5,guildBossLevel:5,guildIgnoreLevel:5});
    expect(calculateDamageResult(input).totalAttack).toBe(105);
    Object.assign(input.character,{guildAttackFlat:"2",guildBossPercent:"3",guildIgnorePercent:"7",guildAccuracyFlat:"30"});
    const result=calculateDamageResult(input);
    expect(result.totalAttack).toBe(102);expect(result.windowStats).toMatchObject({bossDamagePercent:3,ignoreDefensePercent:7});
    input.character.guildAccuracyFlat="0";expect(calculateDamageResult(input).statAttack).toBe(result.statAttack);
  });
  it("accepts 220 and rejects 221 and invalid direct guild ranges",()=>{
    expect(pureStatPool(220)).toBe(1122);
    const input=createDefaultInput("corsair");input.character.level="220";
    expect(calculateDamageResult(input).issues.filter(i=>i.severity==="error")).toHaveLength(0);
    Object.assign(input.character,{level:"221",guildBossPercent:"6",guildIgnorePercent:"11",guildAttackFlat:"6",guildAccuracyFlat:"31"});
    expect(calculateDamageResult(input).issues.filter(i=>i.severity==="error")).toHaveLength(5);
  });
});

describe("ability snapshot",()=>{
  it("fixes base stats across equipment changes and reports unmet requirements instead of moving AP",()=>{
    const input=applyStatWindow(createDefaultInput("corsair"),photo);
    input.equipment.weapon!.attackFlat="100";input.equipment.weapon!.requiredSub="500";input.equipment.weapon!.requiredLevel="0";
    input.character.manualPureSub="9999"; // Superseded legacy field must not block the verified base pair.
    const result=calculateDamageResult(input);
    expect(result.pureMain).toBe(1000);expect(result.pureSub).toBe(22);
    expect(result.issues.some(i=>i.path==="character.manualPureSub")).toBe(false);
    expect(result.issues.some(i=>i.code==="UNMET_SUBSTAT_REQUIREMENT")).toBe(true);
    input.equipment.necklace!.subFlat="600";
    expect(calculateDamageResult(input).pureMain).toBe(1000);
  });
  it("keeps observed boss/IED separate from additive settings and roundtrips storage",()=>{
    const original=createDefaultInput("corsair");original.character.guildBossPercent="5";
    const input=applyStatWindow(original,photo);
    expect(original.statWindow).toBeUndefined();expect(input.equipment).toBe(original.equipment);
    expect(calculateDamageResult(input).windowStats?.bossDamagePercent).toBe(5);
    expect(deserializeSetup(serializeSetup(input))).toMatchObject({ok:true,value:{input}});
    expect(deserializeSetup(serializeSetup(original)).ok).toBe(true);
  });
  it("marks missing weapon, mismatched observation and reference-only accuracy honestly",()=>{
    const input=applyStatWindow(createDefaultInput("corsair"),{...photo,accuracy:999});
    const rows=compareStatWindow(input,calculateDamageResult(input));
    expect(rows.find(r=>r.label==="최대 스탯공")?.status).toBe("unavailable");
    expect(rows.find(r=>r.label==="최종 DEX")?.status).toBe("different");
    expect(rows.find(r=>r.label==="명중률 (참고)")?.status).toBe("unavailable");
  });
  it("rejects impossible snapshots and wrong job",()=>{
    expect(isStatWindowSnapshot({...photo,pure:{DEX:3000,STR:22}})).toBe(false);
    expect(isStatWindowSnapshot({...photo,maxAttack:undefined})).toBe(false);
    expect(()=>applyStatWindow(createDefaultInput("marksman"),photo)).toThrow();
  });
});

const lines=["직업 캡틴","레벨 200","STR 81 (22+59)","DEX 2306 (1000+1306)","INT 7 (4+3)","LUK 7 (4+3)","공격력 10000 ~ 15000","총 데미지 21%","보스데미지 5%","방어율무시 10%","크리확률 0%","명중률 999"];
describe("stat window parsing",()=>{
  it("distinguishes base, total, range and percentages",()=>{
    const result=parseStatWindow(lines);
    expect(result.draft).toMatchObject({pure:{DEX:1000,STR:22},total:{DEX:2306,STR:81},maxAttack:15000,minAttack:10000,bossDamagePercent:5,ignoreDefensePercent:10,totalDamagePercent:21,accuracy:999});
    expect(reconcileStatReads(result,result).automatic).toBe(true);
  });
  it("does not guess hidden digits, inconsistent sums or conflicting passes",()=>{
    const missing=parseStatWindow(lines.filter(l=>!l.startsWith("DEX")));
    expect(missing.draft.pure.DEX).toBeUndefined();expect(reconcileStatReads(missing,missing).automatic).toBe(false);
    const bad=parseStatWindow([...lines,"STR 90 (22+59)"]);
    expect(reconcileStatReads(bad,bad).automatic).toBe(false);
    const first=parseStatWindow(lines),second=parseStatWindow(lines.map(l=>l.replace("15000","15001")));
    expect(reconcileStatReads(first,second).automatic).toBe(false);
  });
  it("reconstructs label/value fragments using their positions",()=>{
    expect(statRows([{text:"100 (4+96)",pass:0,bounds:{x:.2,y:.1,width:.2,height:.03}},{text:"STR",pass:0,bounds:{x:.1,y:.102,width:.05,height:.025}}])).toEqual(["STR 100 (4+96)"]);
  });
});
