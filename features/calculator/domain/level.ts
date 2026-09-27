export const MAX_CHARACTER_LEVEL = 220;

export function pureStatPool(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > MAX_CHARACTER_LEVEL) return 0;
  return level * 5 + (level >= 120 ? 22 : level >= 70 ? 17 : 12);
}

/** User-supplied 200/205/.../220 milestone totals, not cumulative rewards. */
export function levelAchievementBonus(level: number): { attack: number; allStat: number } {
  if (!Number.isInteger(level) || level < 200 || level > MAX_CHARACTER_LEVEL) return { attack: 0, allStat: 0 };
  const tier = Math.floor((level - 200) / 5) + 1;
  return { attack: tier * 2, allStat: tier * 3 };
}
