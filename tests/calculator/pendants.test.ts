import { expect, it } from "vitest";
import { createDefaultInput, emptyEquipment } from "@/features/calculator/domain/defaults";
import { PENDANTS, checkPendantRequirements, pendantFromName } from "@/features/calculator/domain/pendants";
import { addEquipmentSlot, matchingSlots } from "@/features/calculator/domain/slots";
import { calculateDamageResult } from "@/features/calculator/domain/calculate";
import { candidatePriceEfficiency, compareCandidate, type PurchaseCandidate } from "@/features/calculator/domain/candidates";
import { applyOcrBatch } from "@/features/calculator/ocr/batch";
import { deserializeSetup, serializeSetup } from "@/features/calculator/storage";

function baseline() {
  const input = createDefaultInput("corsair");
  Object.assign(input.character, { pureMain: "600", pureSub: "100", mapleWarrior: 0 });
  input.equipment.weapon!.attackFlat = "100";
  input.equipment.necklace = { ...emptyEquipment(), pendantId: "horntail", mainFlat: "10", attackFlat: "2", requiredLevel: "0", requiredSub: "0" };
  input.equipment.pendant_2 = { ...emptyEquipment(), pendantId: "yokai", mainFlat: "20", attackFlat: "3", requiredLevel: "0", requiredSub: "0" };
  return input;
}

const pairs = PENDANTS.flatMap((first, index) => PENDANTS.slice(index + 1).map(second => [first, second] as const));
it.each(pairs)("accepts distinct pair %j + %j with both items counted once", (first, second) => {
  const input = baseline();
  input.equipment.necklace!.pendantId = first.id;
  input.equipment.pendant_2!.pendantId = second.id;
  const result = calculateDamageResult(input);
  expect(checkPendantRequirements(input)).toEqual([]);
  expect(result.mainStat).toBe(630);
  expect(result.totalAttack).toBe(130); // weapon 100 + pendants 5 + guild 5 + projectile 20
  expect(result.pureMain).toBe(600);
});

it.each(PENDANTS)("blocks two copies of $label even with different options", item => {
  const input = baseline();
  input.equipment.necklace!.pendantId = item.id;
  input.equipment.pendant_2!.pendantId = item.id;
  expect(checkPendantRequirements(input).map(issue => issue.code)).toEqual(["DUPLICATE_PENDANT", "DUPLICATE_PENDANT"]);
});

it("has exactly ten pairs, resolves legacy categories, and prevents extra pendant slots", () => {
  expect(pairs).toHaveLength(10);
  const input = baseline();
  for (const label of ["목걸이", "펜던트", "목걸이 3", "펜던트3"]) expect(addEquipmentSlot(input, label)).toBeNull();
  for (const item of PENDANTS) expect(addEquipmentSlot(input, item.label)).toBeNull();
  for (const label of ["목걸이", "펜던트"]) expect(matchingSlots(label, [
    { slot: "necklace", label: "펜던트 1" }, { slot: "pendant_2", label: "펜던트 2" }, { slot: "extra_old", label: "목걸이 3" },
  ]).map(item => item.slot)).toEqual(["necklace", "pendant_2"]);
  for (const item of PENDANTS) expect(pendantFromName(`${item.label} (+7)`)).toBe(item.id);
  expect(pendantFromName("혼테일의 목걸ㅇ" )).toBeUndefined();
});

it("only blocks the replacement that duplicates the retained pendant and keeps the source intact", () => {
  const input = baseline(), original = JSON.stringify(input);
  const candidate: PurchaseCandidate = { id: "new", name: "새 염주", job: "corsair", slot: "necklace", category: "펜던트", price: "0.3",
    equipment: { ...input.equipment.pendant_2!, mainFlat: "30" } };
  const blocked = compareCandidate(input, candidate);
  expect(blocked.status).toBe("blocked");
  expect(blocked.reasons.join()).toContain("중복 착용 불가");
  expect(candidatePriceEfficiency(blocked, "0.3")).toBeNull();
  const valid = compareCandidate(input, { ...candidate, slot: "pendant_2" });
  expect(valid.status).toBe("ready");
  expect(valid.after!.mainStat - valid.before!.mainStat).toBe(10);
  expect(valid.after!.pureMain).toBe(valid.before!.pureMain);
  expect(valid.converted!.percent).toBeGreaterThan(0);
  expect(JSON.stringify(input)).toBe(original);
  delete input.equipment.necklace!.pendantId;
  const pending = compareCandidate(input, { ...candidate, slot: "pendant_2" });
  expect(pending.status).toBe("review");
  expect(pending.converted!.percent).toBeNull();
});

it.each(["펜던트", "목걸이", null])("gates missing-kind verification by OCR category %s, not a manually selected pendant slot", category => {
  const input = baseline();
  delete input.equipment.necklace!.pendantId;
  delete input.equipment.pendant_2!.pendantId;
  const candidate: PurchaseCandidate = { id: "ocr-category", name: "후보", job: "corsair", slot: "necklace", category, price: "0.3",
    equipment: { ...input.equipment.necklace!, mainFlat: "30" } };
  const result = compareCandidate(input, candidate);
  expect(result.status).toBe(category === null ? "ready" : "review");
  if (category === null) {
    expect(result.reasons).toEqual([]);
    expect(result.converted!.percent).toBeGreaterThan(0);
  } else {
    expect(result.reasons.join()).toContain("펜던트 종류를 확인해주세요");
    expect(result.converted!.percent).toBeNull();
  }
});

it("applies two recognized kinds atomically, rejecting duplicates and a third destination", () => {
  const input = createDefaultInput("corsair");
  const entries = [
    { destination: "necklace" as const, label: "펜던트", category: "펜던트", pendantId: "horntail", replacement: { mainFlat: "10" } },
    { destination: "pendant_2" as const, label: "목걸이", category: "목걸이", pendantId: "chaos_horntail", replacement: { mainFlat: "20" } },
  ];
  expect(applyOcrBatch(input, "corsair", entries).input?.equipment.pendant_2).toMatchObject({ pendantId: "chaos_horntail", mainFlat: "20" });
  expect(applyOcrBatch(input, "corsair", [entries[0], { ...entries[1], pendantId: "horntail" }])).toMatchObject({ input: null });
  for (const destination of ["new", "cape", "preset:boss"] as const) expect(applyOcrBatch(input, "corsair", [...entries, { ...entries[0], destination }]).input).toBeNull();
  expect(input.equipment.necklace!.mainFlat).toBe("");
});

it("migrates the original slot and one custom pendant without losing options, preserving any excess for review", () => {
  const input = baseline();
  delete input.equipment.pendant_2;
  input.customSlots = [{ id: "extra_second", label: "목걸이 2" }, { id: "extra_third", label: "펜던트 3" }];
  input.equipment.extra_second = { ...emptyEquipment(), mainFlat: "21" };
  input.equipment.extra_third = { ...emptyEquipment(), mainFlat: "31" };
  const original = JSON.stringify(input), raw = serializeSetup(input), restored = deserializeSetup(raw);
  expect(restored.ok).toBe(true);
  if (!restored.ok) throw new Error("failed to restore");
  expect(restored.value.input.equipment.necklace).toEqual(input.equipment.necklace);
  expect(restored.value.input.equipment.pendant_2).toEqual(input.equipment.extra_second);
  expect(restored.value.input.customSlots).toEqual([{ id: "extra_third", label: "펜던트 3" }]);
  expect(restored.value.input.equipment.extra_third!.mainFlat).toBe("31");
  expect(checkPendantRequirements(restored.value.input).some(issue => issue.code === "PENDANT_LIMIT")).toBe(true);
  expect(JSON.stringify(input)).toBe(original);
  expect(deserializeSetup(serializeSetup(baseline()))).toMatchObject({ ok: true, value: { input: baseline() } });
  input.equipment.necklace!.pendantId = "invalid";
  expect(deserializeSetup(serializeSetup(input)).ok).toBe(false);
});

it("restores a legacy single necklace with an empty second slot and no guessed kind", () => {
  const input = createDefaultInput("corsair");
  delete input.equipment.pendant_2;
  input.equipment.necklace!.mainFlat = "31";
  expect(deserializeSetup(serializeSetup(input))).toMatchObject({ ok: true, value: { input: { equipment: {
    necklace: { mainFlat: "31" }, pendant_2: emptyEquipment(),
  } } } });
  expect(input.equipment.pendant_2).toBeUndefined();
});
