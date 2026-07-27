import { expect, it } from "vitest";
import { allocatePureStats, sumEquipment } from "@/features/calculator/domain/equipment";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { JOB_RULES } from "@/features/calculator/domain/job-rules";

it("separates attack-percent eligible attack from flat attack", () => {
  const input = createDefaultInput("corsair");
  input.equipment.weapon!.attackFlat = "100";
  input.equipment.gloves!.attackFlat = "10";
  input.equipment.projectile!.attackFlat = "20";
  input.equipment.buff!.attackFlat = "30";

  expect(sumEquipment(input.equipment, JOB_RULES.corsair)).toMatchObject({
    percentEligibleAttack: 110,
    flatAttack: 50,
  });
});

it("allocates the minimum pure substat when there are no requirements", () => {
  expect(allocatePureStats({
    level: 160,
    mapleWarriorRate: 0.1,
    minimumSub: 4,
    equipmentSub: 0,
    equipmentSubPercent: 0,
    requirements: [],
    manualPureSub: null,
  })).toMatchObject({ pureMain: 818, pureSub: 4 });
});

it("uses the swap model and excludes the equipped item's own substat", () => {
  const allocation = allocatePureStats({
    level: 160,
    mapleWarriorRate: 0,
    minimumSub: 4,
    equipmentSub: 60,
    equipmentSubPercent: 0,
    requirements: [{ slot: "weapon", requiredSub: 100, itemSub: 20 }],
    manualPureSub: null,
  });
  expect(allocation.pureSub).toBe(60);
  expect(allocation.pureMain).toBe(762);
});

it("returns each equipment requirement with that slot's own substat", () => {
  const input = createDefaultInput("marksman");
  input.equipment.weapon!.subFlat = "20";
  input.equipment.weapon!.requiredSub = "100";
  input.equipment.hat!.subFlat = "15";
  input.equipment.hat!.requiredSub = "50";

  expect(sumEquipment(input.equipment, JOB_RULES.marksman).requirements).toEqual([
    { slot: "hat", requiredSub: 50, itemSub: 15 },
    { slot: "weapon", requiredSub: 100, itemSub: 20 },
  ]);
});

it("keeps a supplied manual pure substat and warns when it misses a requirement", () => {
  expect(allocatePureStats({
    level: 160,
    mapleWarriorRate: 0,
    minimumSub: 4,
    equipmentSub: 60,
    equipmentSubPercent: 0,
    requirements: [{ slot: "weapon", requiredSub: 100, itemSub: 20 }],
    manualPureSub: 50,
  })).toMatchObject({
    pureMain: 772,
    pureSub: 50,
    issues: [{ severity: "warning", path: "equipment.weapon.requiredSub" }],
  });
});

it("caps automatic pure-sub allocation at the AP pool when a requirement is impossible", () => {
  expect(allocatePureStats({
    level: 1,
    mapleWarriorRate: 0,
    minimumSub: 4,
    equipmentSub: 0,
    equipmentSubPercent: 0,
    requirements: [{ slot: "weapon", requiredSub: 9999, itemSub: 0 }],
    manualPureSub: null,
  })).toMatchObject({
    pool: 17,
    pureMain: 0,
    pureSub: 17,
    issues: [{
      severity: "warning",
      path: "equipment.weapon.requiredSub",
      code: "UNMET_SUBSTAT_REQUIREMENT",
    }],
  });
});
