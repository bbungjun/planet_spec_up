import { assessBaseline, hasMeasuredPureStats } from "./baselinePolicy";
import { calculateFromSnapshot, createCalculationSnapshot, type CalculationSnapshot } from "./calculate";
import type { CalculatorInput } from "./types";

const OPTION_FIELDS = [
  "equipmentMain", "equipmentSub", "mainPercent", "percentEligibleAttack", "attackPercent",
  "totalDamagePercent", "bossAndTotalDamage", "ignoreDefense", "criticalRate",
] as const satisfies readonly (keyof CalculationSnapshot)[];

export type EfficiencyOption = typeof OPTION_FIELDS[number];
export type OptionEfficiencyRow = {
  option: EfficiencyOption;
  convertedAttackGain: number;
  increasePercent: number;
  equivalentMainStat: number | null;
  unavailableReason?: string;
};
export type OptionEfficiency = {
  estimated: boolean;
  unavailableReason: string | null;
  rows: OptionEfficiencyRow[];
};

/** Each +1 is independent. All existing rounding and pure stats stay fixed. */
export function calculateOptionEfficiency(input: CalculatorInput): OptionEfficiency {
  const snapshot = createCalculationSnapshot(input);
  const estimated = !hasMeasuredPureStats(input);
  return calculateSnapshotEfficiency(snapshot, estimated);
}

/** Shared by the saved setup and temporary manual simulations. */
export function calculateSnapshotEfficiency(snapshot: CalculationSnapshot, estimated: boolean): OptionEfficiency {
  const current = calculateFromSnapshot(snapshot);
  const unavailableReason = assessBaseline("efficiency", [current], estimated).blocked[0] ?? null;
  if (unavailableReason) return { estimated, unavailableReason, rows: [] };

  const gains = OPTION_FIELDS.map(option => {
    if (option === "criticalRate" && (current.windowStats?.criticalRate ?? 0) + 1 > 100)
      return { option, convertedAttackGain: 0, unavailableReason: "전체 크리확률 100% 초과" };
    const next = calculateFromSnapshot({ ...snapshot, [option]: (snapshot[option] ?? 0) + 1 });
    return { option, convertedAttackGain: next.convertedAttack - current.convertedAttack };
  });
  const mainGain = gains.find(gain => gain.option === "equipmentMain")!.convertedAttackGain;
  return {
    estimated,
    unavailableReason: null,
    rows: gains.map(({ option, convertedAttackGain, unavailableReason }) => ({
      option,
      convertedAttackGain,
      increasePercent: convertedAttackGain / current.convertedAttack * 100,
      equivalentMainStat: !unavailableReason && mainGain > 0 ? convertedAttackGain / mainGain : null,
      ...(unavailableReason ? { unavailableReason } : {}),
    })),
  };
}
