import { JOB_RULES } from "./job-rules";
import { DEFAULT_MARKSMAN_ARROW_ATTACK } from "./marksman";
import type { CalculatorInput, EquipmentInput, JobId } from "./types";

export const DEFAULT_PROJECTILE_ATTACK = "20";
export const DEFAULT_BUFF_ATTACK = "35";

export function defaultProjectileAttack(job: JobId): string {
  return job === "aran" ? "" : job === "marksman" ? DEFAULT_MARKSMAN_ARROW_ATTACK : DEFAULT_PROJECTILE_ATTACK;
}

export function emptyEquipment(): EquipmentInput {
  return {
    mainFlat: "",
    subFlat: "",
    mainPercent: "",
    subPercent: "",
    attackFlat: "",
    attackPercent: "",
    criticalRate: "",
    requiredSub: "",
  };
}

export function createDefaultInput(job: JobId): CalculatorInput {
  const rule = JOB_RULES[job];

  return {
    attackBuffs: { sprinkling: false, rage: false },
    character: {
      job,
      ...(job === "aran" ? { aranWeaponConstant: "5", aranFlatAttack: "0", aranCombo: "0", aranComboCritical: true, aranHighMastery: false } : {}),
      level: "160",
      mapleWarrior: 20,
      skillPercent: String(rule.defaultSkillPercent),
      sharpEyes: job === "aran" ? "usable" : job === "marksman" ? "sharp_30" : "none",
      monsterDefense: "",
      bossAndTotalDamage: "",
      ignoreDefense: "",
      criticalRate: "",
      manualPureSub: "",
      nightLordStrStat: "",
      guildBossLevel: 0,
      guildIgnoreLevel: 0,
      guildAttackLevel: 0,
      guildActiveBoss: false,
      guildBossPercent: "5",
      guildIgnorePercent: "10",
      guildAccuracyFlat: "30",
      guildAttackFlat: "5",
    },
    equipment: Object.fromEntries(
      rule.visibleSlots.map((slot) => [slot, {
        ...emptyEquipment(),
        ...(slot === "projectile" ? { attackFlat: defaultProjectileAttack(job) } : {}),
        ...(slot === "buff" ? { attackFlat: DEFAULT_BUFF_ATTACK } : {}),
      }]),
    ),
  };
}
