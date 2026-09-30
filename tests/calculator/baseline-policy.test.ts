import { expect, it } from "vitest";
import { assessBaseline, hasMeasuredPureStats } from "@/features/calculator/domain/baselinePolicy";
import { calculateDamageResult } from "@/features/calculator/domain/calculate";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import type { ValidationIssue } from "@/features/calculator/domain/types";
const result = (issues: ValidationIssue[] = [], convertedAttack = 100, statAttack = 100) => ({ ...calculateDamageResult(createDefaultInput("corsair")), issues, convertedAttack, statAttack });
const issue = (code: string, severity: "warning" | "error" = "warning"): ValidationIssue => ({ code, severity, path: "test", message: code });

it("centralizes actual pure-stat presence without converting blanks or zero", () => {
  const input = createDefaultInput("corsair"); expect(hasMeasuredPureStats(input)).toBe(false);
  input.character.pureMain = "0"; input.character.pureSub = "0"; expect(hasMeasuredPureStats(input)).toBe(true);
  input.character.pureSub = " "; expect(hasMeasuredPureStats(input)).toBe(false);
  expect(assessBaseline("candidate", [], true).blocked[0]).toContain("순수 주스탯·부스탯");
});
it("retains error, missing weapon, wear priority for efficiency and simulation", () => {
  const current = result([issue("MISSING_WEAPON_ATTACK"), issue("LEGACY_DAMAGE_SPLIT"), issue("INVALID_NUMBER", "error")]);
  expect(assessBaseline("efficiency", [current], true)).toMatchObject({ estimated: true, blocked: ["입력값을 확인하면 옵션 효율을 계산합니다."] });
  expect(assessBaseline("simulation", [current], true).blocked).toEqual(["현재 세팅의 입력값을 먼저 확인해주세요."]);
  current.issues.pop(); expect(assessBaseline("efficiency", [current], false).blocked[0]).toContain("무기 공격력");
});
it("keeps legacy review for candidates, allowed efficiency and blocked simulation", () => {
  const current = result([issue("LEGACY_DAMAGE_SPLIT")]);
  expect(assessBaseline("candidate", [current, result()], false)).toMatchObject({ blocked: [], review: ["LEGACY_DAMAGE_SPLIT"] });
  expect(assessBaseline("efficiency", [current], true)).toMatchObject({ estimated: true, blocked: [] });
  expect(assessBaseline("simulation", [current], true).blocked[0]).toContain("분리");
});
it("keeps candidate-before zero review, efficiency zero/nonfinite block and simulation zero allowance", () => {
  expect(assessBaseline("candidate", [result([], 0), result()], false).zeroBaseline).toBe(true);
  expect(assessBaseline("candidate", [result(), result([], 0)], false).zeroBaseline).toBe(false);
  expect(assessBaseline("candidate", [result([], 100, 0)], false).zeroBaseline).toBe(true);
  for (const converted of [0, NaN, Infinity]) expect(assessBaseline("efficiency", [result([], converted)], true).blocked[0]).toContain("0");
  expect(assessBaseline("simulation", [result([], 0)], true).blocked).toEqual([]);
});
it("keeps both candidate results' blocking messages in issue order and deduplicates", () => {
  expect(assessBaseline("candidate", [result([issue("MISSING_WEAPON_ATTACK"), issue("bad", "error")]), result([issue("bad", "error")])], false).blocked).toEqual(["MISSING_WEAPON_ATTACK", "bad"]);
});
