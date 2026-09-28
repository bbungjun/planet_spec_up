import type { MapleWarrior } from "./types";

export const mapleWarriorRate = (level: MapleWarrior) =>
  level === 30 ? 0.15 : level === 20 ? 0.1 : 0;

export const calculateTotalStat = (
  pure: number,
  equipment: number,
  percent: number,
  mapleWarrior: number,
) => Math.floor((pure + equipment) * (1 + percent / 100))
  + Math.floor(pure * mapleWarrior);

// Attack% scales equipment attack only; ammo, blessings, guild and buffs stay flat.
export const calculateTotalAttack = (
  percentEligible: number,
  flat: number,
  percent: number,
) => Math.floor(percentEligible * (1 + percent / 100)) + flat;

export const calculateDefenseMultiplier = (monster: number, ignore: number) =>
  Math.max(0, 1 - Math.max(0, monster - ignore) / 100);

export const effectiveCriticalRate = (rate: number) => Math.max(0, Math.min(100, rate));

export const calculateCriticalMultiplier = (
  rate: number,
  damage: number,
  skillPercent: number,
) => skillPercent > 0 ? 1 + (effectiveCriticalRate(rate) / 100) * (damage / skillPercent) : 1;

export const calculateStatAttack = (
  main: number,
  sub: number,
  extraStr: number,
  weaponConstant: number,
  attack: number,
) => Math.floor((main * weaponConstant + sub + extraStr) * attack / 100);

export const calculateConvertedAttack = (
  statAttack: number,
  bossAndTotalDamage: number,
  defenseMultiplier: number,
  criticalMultiplier: number,
) => Math.floor(
  statAttack
  * (1 + bossAndTotalDamage / 100)
  * defenseMultiplier
  * criticalMultiplier,
);
