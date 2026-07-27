import type { JobRule } from "./job-rules";
import type { NormalizedEquipmentInput } from "./normalize";
import type { EquipmentInput, EquipmentSlot, ValidationIssue } from "./types";

export type EquipmentRequirement = {
  slot: EquipmentSlot;
  requiredSub: number;
  itemSub: number;
};

export type EquipmentTotals = {
  mainFlat: number;
  subFlat: number;
  mainPercent: number;
  subPercent: number;
  attackPercent: number;
  percentEligibleAttack: number;
  flatAttack: number;
  requirements: EquipmentRequirement[];
};

export type PureStatAllocationInput = {
  level: number;
  mapleWarriorRate: number;
  minimumSub: number;
  equipmentSub: number;
  equipmentSubPercent: number;
  requirements: EquipmentRequirement[];
  manualPureSub: number | null;
};

export type PureStatAllocation = {
  pool: number;
  pureMain: number;
  pureSub: number;
  issues: ValidationIssue[];
};

type EquipmentValues = EquipmentInput | NormalizedEquipmentInput;

const FLAT_ATTACK_SLOTS = new Set<EquipmentSlot>([
  "blessing_1", "blessing_2", "buff", "projectile",
]);

function asNumber(value: string | number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function sumEquipment(
  equipment: Partial<Record<EquipmentSlot, EquipmentValues>>,
  job: JobRule,
): EquipmentTotals {
  const totals: EquipmentTotals = {
    mainFlat: 0,
    subFlat: 0,
    mainPercent: 0,
    subPercent: 0,
    attackPercent: 0,
    percentEligibleAttack: 0,
    flatAttack: 0,
    requirements: [],
  };

  for (const slot of job.visibleSlots) {
    const item = equipment[slot];
    if (item === undefined) continue;

    const mainFlat = asNumber(item.mainFlat);
    const subFlat = asNumber(item.subFlat);
    const attackFlat = asNumber(item.attackFlat);
    const requiredSub = asNumber(item.requiredSub);

    totals.mainFlat += mainFlat;
    totals.subFlat += subFlat;
    totals.mainPercent += asNumber(item.mainPercent);
    totals.subPercent += asNumber(item.subPercent);
    totals.attackPercent += asNumber(item.attackPercent);
    if (FLAT_ATTACK_SLOTS.has(slot)) {
      totals.flatAttack += attackFlat;
    } else {
      totals.percentEligibleAttack += attackFlat;
    }
    if (requiredSub > 0) {
      totals.requirements.push({ slot, requiredSub, itemSub: subFlat });
    }
  }

  return totals;
}

function apPool(level: number): number {
  return level * 5 + (level >= 120 ? 22 : level >= 70 ? 17 : 12);
}

function hasRequirement(
  pureSub: number,
  equipmentSub: number,
  equipmentSubPercent: number,
  mapleWarriorRate: number,
  requirement: EquipmentRequirement,
): boolean {
  const availableSub = Math.floor(
    (pureSub + equipmentSub - requirement.itemSub)
    * (1 + equipmentSubPercent / 100),
  ) + Math.floor(pureSub * mapleWarriorRate);
  return availableSub >= requirement.requiredSub;
}

export function allocatePureStats(input: PureStatAllocationInput): PureStatAllocation {
  const pool = apPool(input.level);
  const requirementsMet = (pureSub: number) => input.requirements.every((requirement) =>
    hasRequirement(
      pureSub,
      input.equipmentSub,
      input.equipmentSubPercent,
      input.mapleWarriorRate,
      requirement,
    ));

  const pureSub = input.manualPureSub ?? (() => {
    let candidate = Math.min(input.minimumSub, pool);
    while (candidate < pool && !requirementsMet(candidate)) candidate += 1;
    return candidate;
  })();
  const issues = input.requirements
    .filter((requirement) => !hasRequirement(
      pureSub,
      input.equipmentSub,
      input.equipmentSubPercent,
      input.mapleWarriorRate,
      requirement,
    ))
    .map((requirement): ValidationIssue => ({
      severity: "warning",
      path: `equipment.${requirement.slot}.requiredSub`,
      code: "UNMET_SUBSTAT_REQUIREMENT",
      message: "The selected pure substat does not meet this equipment requirement.",
    }));

  return {
    pool,
    pureSub,
    pureMain: Math.max(0, pool - pureSub),
    issues,
  };
}
