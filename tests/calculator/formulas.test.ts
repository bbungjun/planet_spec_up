import { expect, it } from "vitest";
import {
  calculateCriticalMultiplier,
  calculateDefenseMultiplier,
  calculateTotalAttack,
  calculateTotalStat,
  mapleWarriorRate,
} from "@/features/calculator/domain/formulas";

it("floors total stat at both reference floor points", () => {
  expect(calculateTotalStat(818, 100, 50, 0.1)).toBe(1458);
  expect(calculateTotalStat(9, 0, 50, 0.1)).toBe(13);
});

it("maps every supported Maple Warrior level", () => {
  expect(mapleWarriorRate(0)).toBe(0);
  expect(mapleWarriorRate(20)).toBe(0.1);
  expect(mapleWarriorRate(30)).toBe(0.15);
});

it("keeps flat attack outside attack percent", () => {
  expect(calculateTotalAttack(100, 30, 10)).toBe(140);
});

it("uses simple defense subtraction", () => {
  expect(calculateDefenseMultiplier(60, 30)).toBe(0.7);
  expect(calculateDefenseMultiplier(60, 80)).toBe(1);
});

it("returns one when skill percent is zero", () => {
  expect(calculateCriticalMultiplier(50, 100, 0)).toBe(1);
});

it("applies the two supported Sharp Eyes bonuses", () => {
  expect(calculateCriticalMultiplier(10, 115, 100)).toBe(1.115);
  expect(calculateCriticalMultiplier(15, 140, 100)).toBe(1.21);
});
