import { JOB_RULES } from "./job-rules";
import { MAX_CHARACTER_LEVEL, pureStatPool } from "./level";
import type { CalculationResult, CalculatorInput, StatWindowSnapshot } from "./types";

const stats = ["STR", "DEX", "INT", "LUK"] as const;
const observedFields = ["maxAttack", "minAttack", "totalDamagePercent", "bossDamagePercent", "ignoreDefensePercent", "criticalRate", "accuracy"] as const;
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const value = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1_000_000_000;

export function isStatWindowSnapshot(v: unknown): v is StatWindowSnapshot {
  if (!record(v) || !Object.keys(v).every(key => ["job", "level", "capturedAt", "pure", "total", ...observedFields].includes(key))) return false;
  if (v.job !== "corsair" && v.job !== "marksman" && v.job !== "night_lord") return false;
  if (!Number.isInteger(v.level) || Number(v.level) < 1 || Number(v.level) > MAX_CHARACTER_LEVEL || typeof v.capturedAt !== "string" || !Number.isFinite(Date.parse(v.capturedAt))) return false;
  if (!record(v.pure) || !record(v.total)) return false;
  for (const group of [v.pure, v.total]) if (!Object.keys(group).every(key => stats.includes(key as typeof stats[number])) || !Object.values(group).every(n => value(n) && Number.isInteger(n))) return false;
  const rule = JOB_RULES[v.job];
  for (const stat of [rule.mainStat, rule.subStat]) if (!value(v.pure[stat]) || !value(v.total[stat]) || Number(v.total[stat]) < Number(v.pure[stat])) return false;
  if (Number(v.pure[rule.mainStat]) + Number(v.pure[rule.subStat]) > pureStatPool(Number(v.level))) return false;
  if (!observedFields.every(key => v[key] === undefined || value(v[key]))) return false;
  if (!value(v.maxAttack) || !Number.isInteger(v.maxAttack) || (v.minAttack !== undefined && (!Number.isInteger(v.minAttack) || Number(v.minAttack) > Number(v.maxAttack)))) return false;
  return true;
}

export function applyStatWindow(input: CalculatorInput, snapshot: StatWindowSnapshot): CalculatorInput {
  if (!isStatWindowSnapshot(snapshot) || input.character.job !== snapshot.job) throw new Error("능력창의 직업·레벨·순수 스탯을 확인해주세요.");
  const rule = JOB_RULES[snapshot.job];
  return { ...input, statWindow: snapshot, character: { ...input.character,
    level: String(snapshot.level), pureMain: String(snapshot.pure[rule.mainStat]), pureSub: String(snapshot.pure[rule.subStat]),
    ...(snapshot.job === "night_lord" && snapshot.total.STR !== undefined ? { nightLordStrStat: String(snapshot.total.STR) } : {}),
  } };
}

export type StatWindowComparison = { label: string; observed?: number; calculated?: number; difference?: number; status: "match" | "different" | "unread" | "unavailable" };
export function compareStatWindow(input: CalculatorInput, result: CalculationResult): StatWindowComparison[] {
  const snapshot = input.statWindow;
  if (!snapshot) return [];
  const rule = JOB_RULES[input.character.job], valid = snapshot.job === input.character.job && !result.issues.some(issue => issue.severity === "error" || ["UNMET_LEVEL_REQUIREMENT", "UNMET_SUBSTAT_REQUIREMENT"].includes(issue.code));
  const values: Array<[string, number | undefined, number | undefined]> = [
    [`최종 ${rule.mainStat}`, snapshot.total[rule.mainStat], result.mainStat],
    [`최종 ${rule.subStat}`, snapshot.total[rule.subStat], result.subStat],
    ["최대 스탯공", snapshot.maxAttack, result.issues.some(issue => issue.code === "MISSING_WEAPON_ATTACK") ? undefined : result.statAttack],
    ["총데미지%", snapshot.totalDamagePercent, result.windowStats?.totalDamagePercent],
    ["보스공격력%", snapshot.bossDamagePercent, result.windowStats?.bossDamagePercent],
    ["방어율 무시%", snapshot.ignoreDefensePercent, result.windowStats?.ignoreDefensePercent],
    ["크리티컬 확률%", snapshot.criticalRate, result.windowStats?.criticalRate],
    ["명중률 (참고)", snapshot.accuracy, undefined],
  ];
  return values.map(([label, observed, calculated]) => {
    const usable = valid && !(result.issues.some(issue => issue.code === "LEGACY_DAMAGE_SPLIT") && /데미지|보스/.test(label));
    const difference = usable && observed !== undefined && calculated !== undefined ? calculated - observed : undefined;
    return { label, observed, calculated: usable ? calculated : undefined, difference,
      status: observed === undefined ? "unread" : difference === undefined ? "unavailable" : Math.abs(difference) < 1e-8 ? "match" : "different" };
  });
}
