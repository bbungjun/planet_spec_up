import { describe, expect, it } from "vitest";
import {
  CHAOS_WEAPON_COMBINATIONS,
  chaosWeaponDefense,
  chaosWeaponGain,
  rankChaosWeaponCombinations,
} from "@/features/calculator/domain/chaosWeaponEfficiency";

const combination = (label: string) => CHAOS_WEAPON_COMBINATIONS.find(row => row.label === label)!;

describe("fixed guild chaos weapon reference", () => {
  it("enumerates the 19 legal multisets without a lower-grade first line", () => {
    expect(CHAOS_WEAPON_COMBINATIONS).toHaveLength(19);
    expect(new Set(CHAOS_WEAPON_COMBINATIONS.map(row => row.id)).size).toBe(19);
    expect(combination("방무15 · 방무15 · 방무15")).toBeUndefined();
    expect(combination("방무30 · 방무15 · 방무15")).toMatchObject({ boss: 0, ignore: 60 });
    expect(combination("보공30 · 보공30 · 보공30")).toMatchObject({ boss: 90, ignore: 0 });
    expect(CHAOS_WEAPON_COMBINATIONS.every(row => !row.label.includes("방무20"))).toBe(true);
  });

  it("keeps guild bonuses in both sides of the blank and boss90 baselines", () => {
    const best = combination("방무30 · 방무30 · 보공30");
    // Independent: 1.35 / (1.05 * .5), and 1.35 * .9 / (1.05 * .3).
    expect(chaosWeaponGain(best, 60, "blank")).toBeCloseTo(157.14285714);
    expect(chaosWeaponGain(best, 80, "blank")).toBeCloseTo(285.71428571);
    expect(chaosWeaponGain(best, 60, "boss90")).toBeCloseTo(38.46153846);
    expect(chaosWeaponGain(best, 80, "boss90")).toBeCloseTo(107.69230769);
    expect(chaosWeaponGain(best, 80, "best")).toBeCloseTo(0);
  });

  it("changes the ordering for the actual target while retaining tied results", () => {
    const zakum = rankChaosWeaponCombinations("zakum");
    const horntail = rankChaosWeaponCombinations("horntail");
    const moreBoss = combination("방무30 · 보공30 · 보공30").id;
    const moreIgnore = combination("방무30 · 방무15 · 보공30").id;
    expect(zakum.findIndex(row => row.id === moreBoss)).toBeLessThan(zakum.findIndex(row => row.id === moreIgnore));
    expect(horntail.findIndex(row => row.id === moreIgnore)).toBeLessThan(horntail.findIndex(row => row.id === moreBoss));
    expect(horntail[0].label).toBe("방무30 · 방무30 · 보공30");
    const ignore90 = horntail.find(row => row.ignore === 90)!;
    const ignore75 = horntail.find(row => row.ignore === 75)!;
    expect(ignore90.rank).toBe(ignore75.rank);
  });

  it("caps defense removal and reports unused ignore without amplifying damage", () => {
    const ignore90 = combination("방무30 · 방무30 · 방무30");
    const ignore75 = combination("방무30 · 방무30 · 방무15");
    expect(chaosWeaponDefense({ boss: 0, ignore: 50 }, 60)).toEqual({ totalIgnore: 60, remaining: 0, excess: 0 });
    expect(chaosWeaponDefense({ boss: 0, ignore: 70 }, 80)).toEqual({ totalIgnore: 80, remaining: 0, excess: 0 });
    expect(chaosWeaponDefense(combination("방무30 · 방무30 · 보공30"), 60)).toEqual({ totalIgnore: 70, remaining: 0, excess: 10 });
    expect(chaosWeaponGain(ignore90, 80, "blank")).toBeCloseTo(chaosWeaponGain(ignore75, 80, "blank"));
  });
});
