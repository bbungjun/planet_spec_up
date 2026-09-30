import { describe, expect, it } from "vitest";
import { aranComboCritical } from "@/features/calculator/domain/aran";
import { createDefaultInput, emptyEquipment } from "@/features/calculator/domain/defaults";
import { calculateDamageResult } from "@/features/calculator/domain/calculate";
import { compareCandidate, type PurchaseCandidate } from "@/features/calculator/domain/candidates";
import { calculateOptionEfficiency } from "@/features/calculator/domain/optionEfficiency";
import { emptySimulation, simulateStats } from "@/features/calculator/domain/statSimulation";
import { deserializeSetup, serializeSetup } from "@/features/calculator/storage";
import { parseMapleTooltip } from "@/features/calculator/ocr/parseMapleTooltip";
import { mapRecognizedStats } from "@/features/calculator/ocr/mapRecognizedStats";
import { applyOcrBatch } from "@/features/calculator/ocr/batch";
import { matchingSlots } from "@/features/calculator/domain/slots";

const baseline = () => {
  const input = createDefaultInput("aran");
  Object.assign(input.character, { level: "160", pureMain: "800", pureSub: "4", mapleWarrior: 0,
    guildAttackFlat: "0", guildBossPercent: "0", guildIgnorePercent: "0", aranFlatAttack: "20" });
  Object.assign(input.equipment.weapon!, { attackFlat: "100", attackPercent: "10", requiredSub: "0", requiredLevel: "0" });
  return input;
};
const candidate = (): PurchaseCandidate => ({ id: "polearm", name: "합성 폴암", job: "aran", slot: "weapon", category: "폴암", price: "0.3",
  equipment: { ...emptyEquipment(), attackFlat: "110", attackPercent: "10", requiredSub: "0", requiredLevel: "0" } });

describe("Aran official effect table and explicit reference equipment model", () => {
  it.each([[0,10,100],[9,10,100],[10,16,110],[19,16,110],[20,22,120],[99,64,190],[100,70,200],[101,70,200],[999,70,200]])("combo %s respects official ten-stack boundary", (combo,rate,damage) => {
    expect(aranComboCritical(combo,true)).toMatchObject({rate,damage});
    expect(aranComboCritical(combo,false)).toMatchObject({rate:0,damage:0});
  });
  it("uses fixed STR/DEX and equipment-only attack%, excluding preserved ammo", () => {
    const input=baseline(); input.equipment.projectile!.attackFlat="999";
    const result=calculateDamageResult(input);
    expect(result.totalAttack).toBe(130);
    expect(result.mainStat).toBe(800); expect(result.subStat).toBe(4);
    expect(result.statAttack).toBe(5205); // floor((800*5+4)*130/100)
    expect(result.pureMain).toBe(800); expect(result.pureSub).toBe(4);
    expect(input.equipment.projectile!.attackFlat).toBe("999");
  });
  it("propagates combo state into candidate, efficiency and simulation without mutating sources", () => {
    const input=baseline(); Object.assign(input.character,{aranComboCritical:true,aranCombo:"100",skillPercent:"100"});
    const original=JSON.stringify(input), c=compareCandidate(input,candidate());
    expect(c.status).toBe("ready"); expect(c.before!.criticalStats).toMatchObject({baseRate:70,baseDamage:200});
    expect(c.before!.criticalMultiplier).toBeCloseTo(2.72); expect(c.after!.totalAttack).toBe(141);
    expect(c.stat!.percent).toBeGreaterThan(0); expect(c.after!.pureMain).toBe(800);
    expect(calculateOptionEfficiency(input).rows).toHaveLength(9);
    const simulation=simulateStats(input,{...emptySimulation(),percentEligibleAttack:"1"});
    expect(simulation.after!.totalAttack).toBe(131); expect(simulation.after!.criticalStats!.baseRate).toBe(70);
    expect(JSON.stringify(input)).toBe(original);
  });
  it("blocks all validated outputs on combo-driven critical overflow and missing assumptions", () => {
    const input=baseline(); Object.assign(input.character,{aranComboCritical:true,aranCombo:"100",criticalRate:"16",sharpEyes:"sharp_30"});
    expect(calculateDamageResult(input).issues.some(i=>i.code==="CRITICAL_RATE_EXCEEDED")).toBe(true);
    expect(compareCandidate(input,candidate()).status).toBe("blocked");
    expect(calculateOptionEfficiency(input).rows).toHaveLength(0); expect(simulateStats(input,emptySimulation()).after).toBeUndefined();
    input.character.criticalRate="15";
    expect(calculateDamageResult(input).windowStats!.criticalRate).toBe(100);
    expect(calculateOptionEfficiency(input).rows.at(-1)!.unavailableReason).toContain("100%");
    const criticalMultiplier = calculateDamageResult(input).criticalMultiplier;
    input.character.skillPercent="0.001";
    expect(calculateDamageResult(input).criticalMultiplier).toBe(criticalMultiplier);
    input.character.skillPercent="100";
    const proposed=candidate(), preserved=JSON.stringify(proposed);
    input.character.aranWeaponConstant="";
    expect(compareCandidate(input,proposed).status).toBe("blocked");
    input.character.aranWeaponConstant="5";
    expect(compareCandidate(input,proposed).status).toBe("ready");
    expect(proposed.price).toBe("0.3"); expect(JSON.stringify(proposed)).toBe(preserved);
  });
  it("blocks missing weapons, self-supporting DEX and wrong-job weapon candidates", () => {
    const input=baseline(); const c=candidate(); c.equipment.requiredSub="5"; c.equipment.subFlat="100";
    expect(compareCandidate(input,c).status).toBe("blocked");
    expect(compareCandidate(input,{...candidate(),category:"건"}).status).toBe("blocked");
    input.equipment.weapon!.attackFlat=""; expect(compareCandidate(input,candidate()).status).toBe("blocked");
  });
  it("keeps boss damage out of hunting and preserves reference state in valid saves", () => {
    const input=baseline(); input.character.bossDamagePercent="50";
    input.weaponPresets={active:"boss",entries:{hunting:{weapon:{...input.equipment.weapon!},monsterDefense:"0"}}};
    expect(compareCandidate(input,candidate(),"hunting").before!.formulaInputs.bossAndTotalDamage).toBe(0);
    const saved=deserializeSetup(serializeSetup(input)); expect(saved.ok).toBe(true);
    if(saved.ok) expect(saved.value.input.character).toEqual(input.character);
    const raw=JSON.parse(serializeSetup(input)); raw.input.character.aranComboCritical="true";
    expect(deserializeSetup(JSON.stringify(raw)).ok).toBe(false);
  });
  it("parses polearm stats and requirements, routes batch weapons without inheriting options", () => {
    const parsed=parseMapleTooltip("장비분류 : 폴암\nSTR : +12\nDEX : +5\nSTR : +6%\n공격력 : +110\nREQ DEX : 80\nREQ LEV : 100");
    expect(parsed.category).toBe("폴암");
    const replacement=mapRecognizedStats(parsed,"aran"); expect(replacement).toMatchObject({mainFlat:"12",subFlat:"5",mainPercent:"6",attackFlat:"110",requiredSub:"80",requiredLevel:"100"});
    expect(matchingSlots(parsed.category,[{slot:"weapon" as const,label:"무기"}])).toHaveLength(1);
    const input=baseline(); const applied=applyOcrBatch(input,"aran",[{replacement,destination:"preset:hunting",label:"폴암",category:"폴암"}]);
    expect(applied.error).toBeNull(); expect(applied.input!.weaponPresets!.entries.hunting!.weapon.attackFlat).toBe("110");
    expect(input.equipment.weapon!.attackFlat).toBe("100");
  });
});
