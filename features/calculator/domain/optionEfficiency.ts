import { isWearBlocked } from "./requirements";
import { calculateFromSnapshot, createCalculationSnapshot, type CalculationSnapshot } from "./calculate";
import type { CalculatorInput } from "./types";

const OPTION_FIELDS = [
  "equipmentMain", "mainPercent", "percentEligibleAttack", "attackPercent",
  "totalDamagePercent", "bossAndTotalDamage", "ignoreDefense", "criticalRate",
] as const satisfies readonly (keyof CalculationSnapshot)[];

export type EfficiencyOption = typeof OPTION_FIELDS[number];
export type OptionEfficiencyRow = {
  option: EfficiencyOption;
  convertedAttackGain: number;
  increasePercent: number;
  equivalentMainStat: number | null;
};
export type OptionEfficiency = {
  estimated: boolean;
  unavailableReason: string | null;
  rows: OptionEfficiencyRow[];
};

/** Each +1 is independent. All existing rounding and pure stats stay fixed. */
export function calculateOptionEfficiency(input: CalculatorInput): OptionEfficiency {
  const snapshot = createCalculationSnapshot(input);
  const current = calculateFromSnapshot(snapshot);
  const estimated = !input.character.pureMain?.trim() || !input.character.pureSub?.trim();
  const unavailableReason = current.issues.some(issue => issue.severity === "error")
    ? "입력값을 확인하면 옵션 효율을 계산합니다."
    : current.issues.some(issue => issue.code === "MISSING_WEAPON_ATTACK")
      ? "무기 공격력을 입력하면 옵션 효율을 계산합니다."
      : current.issues.some(issue => isWearBlocked(issue))
        ? "착용 불가 장비의 요구 조건을 확인해주세요."
        : !Number.isFinite(current.convertedAttack) || current.convertedAttack <= 0
          ? "현재 환산공이 0이라 상승률을 계산할 수 없습니다."
          : null;
  if (unavailableReason) return { estimated, unavailableReason, rows: [] };

  const gains = OPTION_FIELDS.map(option => {
    const next = calculateFromSnapshot({ ...snapshot, [option]: (snapshot[option] ?? 0) + 1 });
    return { option, convertedAttackGain: next.convertedAttack - current.convertedAttack };
  });
  const mainGain = gains[0].convertedAttackGain;
  return {
    estimated,
    unavailableReason: null,
    rows: gains.map(({ option, convertedAttackGain }) => ({
      option,
      convertedAttackGain,
      increasePercent: convertedAttackGain / current.convertedAttack * 100,
      equivalentMainStat: mainGain > 0 ? convertedAttackGain / mainGain : null,
    })),
  };
}
