import { JOB_RULES } from "./job-rules";
import type { CalculatorInput, EquipmentInput, JobId } from "./types";

export const DEFAULT_PROJECTILE_ATTACK = "20";

export function emptyEquipment(): EquipmentInput {
  return {
    mainFlat: "",
    subFlat: "",
    mainPercent: "",
    subPercent: "",
    attackFlat: "",
    attackPercent: "",
    requiredSub: "",
  };
}

export function createDefaultInput(job: JobId): CalculatorInput {
  const rule = JOB_RULES[job];

  return {
    character: {
      job,
      ...(job === "aran" ? { aranWeaponConstant: "5", aranFlatAttack: "0", aranCombo: "0", aranComboCritical: true } : {}),
      level: "160",
      mapleWarrior: 20,
      skillPercent: String(rule.defaultSkillPercent),
      sharpEyes: job === "aran" ? "usable" : "none",
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
        ...(slot === "projectile" && job !== "aran" ? { attackFlat: DEFAULT_PROJECTILE_ATTACK } : {}),
      }]),
    ),
  };
}
