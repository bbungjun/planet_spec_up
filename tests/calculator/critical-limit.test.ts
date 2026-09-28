import { expect, it } from "vitest";
import { calculateCriticalMultiplier } from "@/features/calculator/domain/formulas";
import { calculateDamageResult } from "@/features/calculator/domain/calculate";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { calculateOptionEfficiency } from "@/features/calculator/domain/optionEfficiency";
import { candidateEquipment, compareCandidate, type PurchaseCandidate } from "@/features/calculator/domain/candidates";
import { emptySimulation, simulateStats } from "@/features/calculator/domain/statSimulation";

function fixture(rate: string) {
  const input = createDefaultInput("corsair");
  Object.assign(input.character, { pureMain: "800", pureSub: "4", criticalRate: rate, sharpEyes: "sharp_30" });
  Object.assign(input.equipment.weapon!, { attackFlat: "100", requiredLevel: "0", requiredSub: "0" });
  return input;
}
const candidate: PurchaseCandidate = { id: "critical", name: "비교", job: "corsair", category: "건", slot: "weapon", price: "1",
  equipment: candidateEquipment({ attackFlat: "110", requiredLevel: "0", requiredSub: "0" }) };

it("caps the primitive critical multiplier even for unchecked callers", () => {
  expect(calculateCriticalMultiplier(115, 140, 380)).toBeCloseTo(1.368421052631579, 12);
  expect(calculateCriticalMultiplier(-1, 140, 380)).toBe(1);
});

it.each(["85.01", "100"])("rejects total critical chance above 100 consistently for extra %s", rate => {
  const input = fixture(rate), original = structuredClone(input);
  const result = calculateDamageResult(input);
  expect(result.windowStats?.criticalRate).toBe(100);
  expect(result.criticalMultiplier).toBeCloseTo(1.368421052631579, 12);
  expect(result.issues).toContainEqual(expect.objectContaining({ severity: "error", code: "CRITICAL_RATE_EXCEEDED", path: "character.criticalRate" }));
  expect(compareCandidate(input, candidate).status).toBe("blocked");
  expect(compareCandidate(input, candidate).converted).toBeUndefined();
  expect(calculateOptionEfficiency(input)).toMatchObject({ rows: [], unavailableReason: expect.any(String) });
  const simulation = simulateStats(input, emptySimulation());
  expect(simulation.blocked).toBeTruthy(); expect(simulation.after).toBeUndefined();
  expect(input).toEqual(original);
});

it("accepts exactly 100, blocks an additional percent, and restores all flows when corrected", () => {
  const input = fixture("85");
  expect(calculateDamageResult(input).issues).toEqual([]);
  expect(compareCandidate(input, candidate).status).toBe("ready");
  expect(simulateStats(input, emptySimulation()).after).toEqual(calculateDamageResult(input));
  expect(calculateOptionEfficiency(input).rows.find(row => row.option === "criticalRate"))
    .toMatchObject({ convertedAttackGain: 0, equivalentMainStat: null, unavailableReason: expect.stringContaining("100%") });
  expect(simulateStats(input, { ...emptySimulation(), criticalRate: "1" }).errors.criticalRate).toContain("100%");
  input.character.criticalRate = "84";
  expect(calculateOptionEfficiency(input).rows.find(row => row.option === "criticalRate")?.increasePercent).toBeGreaterThan(0);
  expect(simulateStats(input, { ...emptySimulation(), criticalRate: "1" }).after?.windowStats?.criticalRate).toBe(100);
});

it.each([["marksman", "45"], ["night_lord", "35"]] as const)("includes preserved %s base chance in the shared boundary", (job, rate) => {
  const input = createDefaultInput(job);
  Object.assign(input.character, { sharpEyes: "sharp_30", criticalRate: rate });
  expect(calculateDamageResult(input).windowStats?.criticalRate).toBe(100);
  input.character.criticalRate = String(Number(rate) + 1);
  expect(calculateDamageResult(input).issues.some(issue => issue.code === "CRITICAL_RATE_EXCEEDED")).toBe(true);
});
