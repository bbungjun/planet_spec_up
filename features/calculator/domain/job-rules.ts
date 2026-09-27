import type { BuiltinEquipmentSlot, JobId, StatName } from "./types";

export type JobRule = {
  id: JobId;
  label: string;
  groupLabel: string;
  mainStat: StatName;
  subStat: StatName;
  weapon: "crossbow" | "gun" | "claw";
  weaponConstant: 3.6;
  minimumSub: number;
  baseCriticalRate: number;
  baseCriticalDamage: number;
  defaultSkillPercent: number;
  visibleSlots: readonly BuiltinEquipmentSlot[];
};

const COMMON = [
  "necklace", "pendant_2", "cape", "earrings", "eye", "face", "hat", "shoes",
  "gloves", "weapon", "title", "ring_1", "ring_2", "ring_3", "ring_4",
  "projectile", "blessing_1", "blessing_2", "buff",
] as const satisfies readonly BuiltinEquipmentSlot[];

export const JOB_RULES: Record<JobId, JobRule> = {
  marksman: {
    id: "marksman", label: "신궁", groupLabel: "궁수",
    mainStat: "DEX", subStat: "STR", weapon: "crossbow",
    weaponConstant: 3.6, minimumSub: 4,
    baseCriticalRate: 40, baseCriticalDamage: 100, defaultSkillPercent: 270,
    visibleSlots: [...COMMON, "top", "bottom"],
  },
  corsair: {
    id: "corsair", label: "캡틴", groupLabel: "해적",
    mainStat: "DEX", subStat: "STR", weapon: "gun",
    weaponConstant: 3.6, minimumSub: 4,
    baseCriticalRate: 0, baseCriticalDamage: 0, defaultSkillPercent: 380,
    visibleSlots: [...COMMON, "overall"],
  },
  night_lord: {
    id: "night_lord", label: "나이트로드", groupLabel: "도적",
    mainStat: "LUK", subStat: "DEX", weapon: "claw",
    weaponConstant: 3.6, minimumSub: 25,
    baseCriticalRate: 50, baseCriticalDamage: 100, defaultSkillPercent: 150,
    visibleSlots: [...COMMON, "top", "bottom"],
  },
};
