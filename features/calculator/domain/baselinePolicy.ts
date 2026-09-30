import { isWearBlocked } from "./requirements";
import type { CalculatorInput, CalculationResult } from "./types";

export const hasMeasuredPureStats = (input: CalculatorInput): boolean => !!input.character.pureMain?.trim() && !!input.character.pureSub?.trim();

/** Facts and purpose-specific priorities live together. The formulas remain in CalculationSnapshot.
 * Candidate zero checks concern the before result only; simulation allows zero, with null ratios.
 */
export function assessBaseline(purpose: "candidate" | "efficiency" | "simulation", results: readonly CalculationResult[], estimated: boolean) {
  const current = results[0];
  const issues = results.flatMap(result => result.issues);
  const errors = issues.filter(issue => issue.severity === "error");
  const missingWeapon = issues.filter(issue => issue.code === "MISSING_WEAPON_ATTACK");
  const wear = issues.filter(isWearBlocked);
  const legacy = issues.filter(issue => issue.code === "LEGACY_DAMAGE_SPLIT");
  if (purpose === "candidate") {
    if (estimated) return { estimated, blocked: ["캐릭터 설정에서 순수 주스탯·부스탯을 입력해주세요."], review: [], zeroBaseline: false };
    const invalid = issues.filter(issue => errors.includes(issue) || missingWeapon.includes(issue) || wear.includes(issue));
    return { estimated, blocked: [...new Set(invalid.map(issue => issue.message))],
      review: [...new Set(legacy.map(issue => issue.message))],
      zeroBaseline: !!current && (current.statAttack <= 0 || current.convertedAttack <= 0) };
  }
  const blocked = purpose === "efficiency"
    ? errors.length ? "입력값을 확인하면 옵션 효율을 계산합니다."
      : missingWeapon.length ? "무기 공격력을 입력하면 옵션 효율을 계산합니다."
        : wear.length ? "착용 불가 장비의 요구 조건을 확인해주세요."
          : !Number.isFinite(current.convertedAttack) || current.convertedAttack <= 0 ? "현재 환산공이 0이라 상승률을 계산할 수 없습니다." : null
    : errors.length ? "현재 세팅의 입력값을 먼저 확인해주세요."
      : missingWeapon.length ? "현재 무기의 공격력을 먼저 입력해주세요."
        : wear.length ? "현재 장비의 착용 조건을 먼저 확인해주세요."
          : legacy.length ? "기존 보공·총데미지 합산값을 분리한 뒤 비교해주세요." : null;
  return { estimated, blocked: blocked ? [blocked] : [], review: [], zeroBaseline: false };
}
