import { expect, it } from "vitest";
import { normalizeInput, parseNumber } from "@/features/calculator/domain/normalize";
import { createDefaultInput } from "@/features/calculator/domain/defaults";

it("treats blank input as zero without an issue", () => {
  expect(parseNumber("", { path: "equipment.weapon.attackFlat", min: 0, max: 9999 }))
    .toEqual({ value: 0, issues: [] });
});

it("converts invalid and out-of-range values to zero with an error", () => {
  expect(parseNumber("-1", { path: "character.level", min: 1, max: 200 }).value).toBe(0);
  expect(parseNumber("abc", { path: "equipment.hat.mainFlat", min: 0, max: 9999 }).issues[0])
    .toMatchObject({ severity: "error" });
});

it("rejects fractions for integer rules", () => {
  expect(parseNumber("160.5", {
    path: "character.level", min: 1, max: 200, integer: true,
  })).toMatchObject({ value: 0, issues: [{ code: "INVALID_NUMBER" }] });
});

it("normalizes every mutable number without changing the UI input", () => {
  const input = createDefaultInput("night_lord");
  input.character.level = "160";
  input.character.manualPureSub = "60";
  input.character.nightLordStrStat = "12";
  input.equipment.weapon!.subFlat = "20";
  input.equipment.weapon!.requiredSub = "100";

  const normalized = normalizeInput(input);

  expect(normalized).toMatchObject({
    value: {
      character: { level: 160, manualPureSub: 60, nightLordStrStat: 12 },
      equipment: { weapon: { subFlat: 20, requiredSub: 100 } },
    },
    issues: [],
  });
  expect(input.character.manualPureSub).toBe("60");
  expect(input.equipment.weapon!.subFlat).toBe("20");
});

it("uses the current AP pool as the manual pure-substat maximum", () => {
  const input = createDefaultInput("corsair");
  input.character.level = "160";
  input.character.manualPureSub = "823";

  expect(normalizeInput(input)).toMatchObject({
    value: { character: { manualPureSub: 0 } },
    issues: [{ path: "character.manualPureSub", severity: "error" }],
  });
});

it("ignores Night Lord stat-window STR validation for other jobs", () => {
  const input = createDefaultInput("corsair");
  input.character.nightLordStrStat = "not-used";

  expect(normalizeInput(input)).toMatchObject({
    value: { character: { nightLordStrStat: 0 } },
    issues: [],
  });
});
