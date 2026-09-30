import { expect, it } from "vitest";
import { calculateDamageResult } from "@/features/calculator/domain/calculate";
import { createDefaultCashEquipment } from "@/features/calculator/domain/cash-equipment";
import { createDefaultInput, emptyEquipment } from "@/features/calculator/domain/defaults";
import { normalizeInput } from "@/features/calculator/domain/normalize";
import { compareCandidatePresets, type PurchaseCandidate } from "@/features/calculator/domain/candidates";
import { switchWeaponPreset } from "@/features/calculator/domain/weapon-presets";
import { deserializeSetup, serializeSetup } from "@/features/calculator/storage";

function base() {
  const input = createDefaultInput("corsair"); input.equipment.buff!.attackFlat = "0"; // Fixed no-buff reference.
  Object.assign(input.character, { level: "120", pureMain: "600", pureSub: "22", mapleWarrior: 30 });
  Object.assign(input.equipment.weapon!, { attackFlat: "101", attackPercent: "21", mainFlat: "10", subFlat: "5", mainPercent: "30", subPercent: "20", requiredSub: "0", requiredLevel: "0" });
  for (const slot of ["ring_1", "ring_2", "ring_3", "ring_4"] as const) {
    Object.assign(input.equipment[slot]!, { mainFlat: "1", subFlat: "1" });
  }
  return input;
}

it.each([0, 1, 2, 3, 4, 5, 6, 7])("calculates lord selection %i with both rings, without consuming normal slots", mask => {
  const input = base(), equipment = JSON.stringify(input.equipment);
  const lordCount = [mask & 1, mask & 2, mask & 4].filter(Boolean).length;
  const lordStats = [0, 5, 15, 20][lordCount];
  for (const count of [0, 1, 2, 3, 4]) for (const weddingRing of [false, true]) {
    input.cashEquipment = { ...createDefaultCashEquipment(), auroraRing: true, auroraRingCount: String(count), weddingRing,
      lordHat: !!(mask & 1), lordShoes: !!(mask & 2), lordOverall: !!(mask & 4) };
    const allStat = count + (weddingRing ? 3 : 0) + lordStats;
    const result = calculateDamageResult(input);
    expect(result.mainStat).toBe(Math.floor((614 + allStat) * 1.3) + 90);
    expect(result.subStat).toBe(Math.floor((31 + allStat) * 1.2) + 3);
    expect(result.totalAttack).toBe(Math.floor((101 + (lordCount === 3 ? 5 : 0)) * 1.21) + 25);
    expect(result.pureMain).toBe(600); expect(result.pureSub).toBe(22);
    expect(JSON.stringify(input.equipment)).toBe(equipment);
    expect(result.issues).toEqual([]);
    expect(calculateDamageResult(input)).toEqual(result);
  }
});

it("disables cash bonuses without losing the saved aurora count", () => {
  const input = base(), before = calculateDamageResult(input);
  input.cashEquipment = { ...createDefaultCashEquipment(), auroraRingCount: "4" };
  expect(calculateDamageResult(input)).toEqual(before);
  input.cashEquipment.auroraRing = true;
  expect(calculateDamageResult(input).mainStat).toBe(before.mainStat + 5);
  input.cashEquipment.auroraRing = false;
  expect(input.cashEquipment.auroraRingCount).toBe("4");
  expect(calculateDamageResult(input)).toEqual(before);
});

it("uses independently worn cash stats to satisfy regular gear requirements without reallocating AP", () => {
  const input = base(); input.character.mapleWarrior = 0;
  input.equipment.weapon!.requiredSub = "53";
  expect(calculateDamageResult(input).issues.some(issue => issue.code === "UNMET_SUBSTAT_REQUIREMENT")).toBe(true);
  input.cashEquipment = { auroraRing: true, auroraRingCount: "4", weddingRing: true, lordHat: true, lordShoes: true, lordOverall: true };
  expect(calculateDamageResult(input).issues).toEqual([]);
  expect(calculateDamageResult(input).pureSub).toBe(22);
  input.equipment.weapon!.requiredSub = "54";
  expect(calculateDamageResult(input).issues.find(issue => issue.code === "UNMET_SUBSTAT_REQUIREMENT")?.message).toContain("1 부족");
});

it("adds all-stat to the night lord's separate STR input once", () => {
  const input = createDefaultInput("night_lord");
  Object.assign(input.character, { pureMain: "700", pureSub: "25", nightLordStrStat: "44" });
  input.equipment.weapon!.attackFlat = "100";
  const before = calculateDamageResult(input);
  input.cashEquipment = { ...createDefaultCashEquipment(), weddingRing: true };
  const after = calculateDamageResult(input);
  expect(after.extraStr).toBe(47); expect(after.mainStat).toBe(before.mainStat + 3);
  expect(after.subStat).toBe(before.subStat + 3); expect(input.character.nightLordStrStat).toBe("44");
});

it.each(["", "-1", "5", "1.5", "abc"])("flags the selected aurora count %j and blocks candidate confirmation", count => {
  const input = base();
  input.cashEquipment = { ...createDefaultCashEquipment(), auroraRing: true, auroraRingCount: count };
  expect(normalizeInput(input).issues).toContainEqual(expect.objectContaining({ severity: "error", path: "cashEquipment.auroraRingCount" }));
  const candidate: PurchaseCandidate = { id: "test", name: "후보", job: "corsair", slot: "weapon", category: "건", price: "1",
    equipment: { ...emptyEquipment(), attackFlat: "120", requiredSub: "0", requiredLevel: "0" } };
  expect(compareCandidatePresets(input, candidate).every(comparison => comparison.status !== "ready")).toBe(true);
  input.cashEquipment.auroraRing = false;
  expect(normalizeInput(input).issues).toEqual([]);
});

it("keeps cash equipment across all presets, storage and independent candidate replacements", () => {
  let input = base();
  input.cashEquipment = { auroraRing: true, auroraRingCount: "4", weddingRing: true, lordHat: true, lordShoes: true, lordOverall: true };
  for (const preset of ["boss", "chaos", "hunting"] as const) {
    input = switchWeaponPreset(input, preset);
    Object.assign(input.equipment.weapon!, { attackFlat: "100", requiredSub: "0", requiredLevel: "0" });
    const loaded = deserializeSetup(serializeSetup(input));
    if (!loaded.ok) throw new Error(loaded.message);
    input = loaded.value.input;
    expect(input.cashEquipment?.auroraRingCount).toBe("4");
  }
  const original = JSON.stringify(input);
  const candidate: PurchaseCandidate = { id: "test", name: "후보", job: "corsair", slot: "ring_1", category: "반지", price: "1",
    equipment: { ...emptyEquipment(), mainFlat: "2", subFlat: "1", requiredLevel: "0", requiredSub: "0" } };
  for (const comparison of compareCandidatePresets(input, candidate)) {
    expect(comparison.status).toBe("ready");
    expect(comparison.before!.subStat).toBe(comparison.after!.subStat);
    expect(comparison.before!.totalAttack).toBe(comparison.after!.totalAttack);
    expect(comparison.after!.mainStat).toBeGreaterThan(comparison.before!.mainStat);
  }
  expect(JSON.stringify(input)).toBe(original);
});

it("restores older saves as unequipped without overwriting equipment or inserting selections", () => {
  const legacy = base(), encoded = serializeSetup(legacy);
  const loaded = deserializeSetup(encoded);
  if (!loaded.ok) throw new Error(loaded.message);
  expect(loaded.value.input).toEqual(legacy);
  expect(loaded.value.input.cashEquipment).toBeUndefined();
});

it.each([null, {}, { ...createDefaultCashEquipment(), auroraRing: "true" }, { ...createDefaultCashEquipment(), auroraRingCount: 4 }, { ...createDefaultCashEquipment(), extra: true }])("rejects malformed cash selections in storage: %j", cashEquipment => {
  const saved = JSON.parse(serializeSetup(base()));
  saved.input.cashEquipment = cashEquipment;
  expect(deserializeSetup(JSON.stringify(saved)).ok).toBe(false);
});
