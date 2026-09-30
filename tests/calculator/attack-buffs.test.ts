import { expect, it } from "vitest";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { calculateDamageResult } from "@/features/calculator/domain/calculate";
import { switchWeaponPreset } from "@/features/calculator/domain/weapon-presets";
import { deserializeSetup, serializeSetup } from "@/features/calculator/storage";

it.each(["corsair", "marksman", "night_lord", "aran"] as const)("starts %s with Pink Bean only and the requested guild bonuses", job => {
  const input = createDefaultInput(job);
  expect(input.character).toMatchObject({ guildBossPercent: "5", guildIgnorePercent: "10", guildAccuracyFlat: "30", guildAttackFlat: "5" });
  input.equipment.weapon!.attackFlat = "100";
  const result = calculateDamageResult(input);
  expect(input.equipment.buff!.attackFlat).toBe("35");
  expect(input.attackBuffs).toEqual({ sprinkling: false, rage: false });
  expect(result.totalAttack).toBe(job === "aran" ? 140 : 160); // weapon 100 + guild 5 + Pink Bean 35 + ammo (non-Aran) 20
  expect(result.windowStats).toMatchObject({ bossDamagePercent: 5, ignoreDefensePercent: 10 });
});

it.each([0, 10, 30, 35, 40, 42])("adds independent buffs once, outside attack percent, with base buff %s", attack => {
  const input = createDefaultInput("corsair");
  Object.assign(input.character, { pureMain: "800", pureSub: "22" });
  Object.assign(input.equipment.weapon!, { attackFlat: "101", attackPercent: "10" });
  input.equipment.buff!.attackFlat = String(attack);
  for (const sprinkling of [false, true]) for (const rage of [false, true]) {
    input.attackBuffs = { sprinkling, rage };
    const result = calculateDamageResult(input);
    expect(result.totalAttack).toBe(111 + 5 + 20 + attack + (sprinkling ? 30 : 0) + (rage ? 12 : 0));
    expect(result.pureMain).toBe(800);
    expect(result.pureSub).toBe(22);
    expect(calculateDamageResult(input)).toEqual(result);
  }
});

it("retains stacking buffs across all weapon presets and storage", () => {
  let input = createDefaultInput("corsair");
  input.attackBuffs = { sprinkling: true, rage: true };
  input.equipment.buff!.attackFlat = "10";
  for (const preset of ["boss", "chaos", "hunting"] as const) {
    input = switchWeaponPreset(input, preset);
    input.equipment.weapon!.attackFlat = "100";
    const loaded = deserializeSetup(serializeSetup(input));
    if (!loaded.ok) throw new Error(loaded.message);
    input = loaded.value.input;
    expect(calculateDamageResult(input).totalAttack).toBe(177);
    expect(input.attackBuffs).toEqual({ sprinkling: true, rage: true });
  }
});

it.each(["", "0", "42"])("keeps old guild and manual buff %j without adding new defaults on restore", buff => {
  const legacy = createDefaultInput("corsair");
  legacy.equipment.projectile!.attackFlat = ""; // The legacy fixture had no ammunition bonus.
  delete legacy.character.guildBossPercent;
  delete legacy.character.guildIgnorePercent;
  delete legacy.character.guildAccuracyFlat;
  delete legacy.character.guildAttackFlat;
  legacy.character.guildAttackLevel = 2;
  legacy.equipment.weapon!.attackFlat = "100";
  legacy.equipment.buff!.attackFlat = buff;
  delete legacy.attackBuffs;
  const loaded = deserializeSetup(serializeSetup(legacy));
  if (!loaded.ok) throw new Error(loaded.message);
  expect(loaded.value.input).toEqual(legacy);
  expect(calculateDamageResult(loaded.value.input).totalAttack).toBe(102 + Number(buff));
});

it.each([null, {}, { sprinkling: true }, { sprinkling: "true", rage: false }, { sprinkling: true, rage: false, extra: true }])("rejects malformed saved buff selections: %j", attackBuffs => {
  const raw = JSON.parse(serializeSetup(createDefaultInput("corsair")));
  raw.input.attackBuffs = attackBuffs;
  expect(deserializeSetup(JSON.stringify(raw)).ok).toBe(false);
});
