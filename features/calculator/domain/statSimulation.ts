import { calculateFromSnapshot, createCalculationSnapshot, type CalculationSnapshot } from "./calculate";
import { isWearBlocked } from "./requirements";
import type { CalculatorInput } from "./types";

export const SIMULATION_FIELDS = [
  { field: "equipmentMain", label: "장비 주스탯", limit: 9999, integer: true },
  { field: "equipmentSub", label: "장비 부스탯", limit: 9999, integer: true },
  { field: "mainPercent", label: "주스탯%", limit: 999, integer: false },
  { field: "percentEligibleAttack", label: "장비 공격력", limit: 9999, integer: true },
  { field: "attackPercent", label: "공격력%", limit: 999, integer: false },
  { field: "totalDamagePercent", label: "총데미지%", limit: 999, integer: false },
  { field: "bossAndTotalDamage", label: "보공%", limit: 999, integer: false },
  { field: "ignoreDefense", label: "방어율 무시%", limit: 100, integer: false },
  { field: "criticalRate", label: "크리확률%", limit: 100, integer: false },
] as const;
export type SimulationField = typeof SIMULATION_FIELDS[number]["field"];
export type SimulationInput = Record<SimulationField, string>;
export const emptySimulation = (): SimulationInput => Object.fromEntries(SIMULATION_FIELDS.map(({ field }) => [field, "0"])) as SimulationInput;

export const simulationChange = (before: number, after: number) => ({ before, after, difference: after - before,
  percent: before > 0 ? (after / before - 1) * 100 : null });

/** Deltas affect only a detached snapshot. Pure AP, source gear and saved state never change. */
export function simulateStats(input: CalculatorInput, deltas: SimulationInput) {
  const snapshot = createCalculationSnapshot(input);
  const before = calculateFromSnapshot(snapshot);
  const next: CalculationSnapshot = { ...snapshot };
  const errors: Partial<Record<SimulationField, string>> = {};
  const values = {} as Record<SimulationField, number>;
  const estimated = !input.character.pureMain?.trim() || !input.character.pureSub?.trim();
  const blocked = before.issues.some(issue => issue.severity === "error") ? "현재 세팅의 입력값을 먼저 확인해주세요."
    : before.issues.some(issue => issue.code === "MISSING_WEAPON_ATTACK") ? "현재 무기의 공격력을 먼저 입력해주세요."
    : before.issues.some(isWearBlocked) ? "현재 장비의 착용 조건을 먼저 확인해주세요."
    : before.issues.some(issue => issue.code === "LEGACY_DAMAGE_SPLIT") ? "기존 보공·총데미지 합산값을 분리한 뒤 비교해주세요." : null;
  for (const { field, limit, integer } of SIMULATION_FIELDS) {
    const raw = deltas[field].trim(), delta = raw === "" ? 0 : Number(raw);
    values[field] = delta;
    if (!Number.isFinite(delta) || Math.abs(delta) > limit || (integer && !Number.isInteger(delta))) {
      errors[field] = `−${limit.toLocaleString("ko-KR")}~${limit.toLocaleString("ko-KR")}${integer ? " 정수" : ""}로 입력해주세요.`;
      continue;
    }
    const total = (snapshot[field] ?? 0) + delta;
    if (total < 0) errors[field] = "현재 옵션 합계보다 많이 줄일 수 없습니다.";
    next[field] = total;
  }
  const crit = before.criticalStats;
  if ((crit?.baseRate ?? 0) + (crit?.equipmentRate ?? 0) + (crit?.buffRate ?? 0) + (next.criticalRate ?? 0) > 100)
    errors.criticalRate = "적용 후 전체 크리확률은 100% 이하여야 합니다.";
  if (blocked || Object.keys(errors).length) return { before, estimated, blocked, errors };
  const after = calculateFromSnapshot(next);
  const isolated = Object.fromEntries(SIMULATION_FIELDS.map(({ field }) => {
    const one = calculateFromSnapshot({ ...snapshot, [field]: (snapshot[field] ?? 0) + values[field] });
    return [field, simulationChange(before.convertedAttack, one.convertedAttack)];
  })) as Record<SimulationField, ReturnType<typeof simulationChange>>;
  return { before, after, snapshot: next, estimated, blocked, errors, isolated,
    stat: simulationChange(before.statAttack, after.statAttack), converted: simulationChange(before.convertedAttack, after.convertedAttack) };
}
