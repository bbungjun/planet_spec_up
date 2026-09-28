/** Planet 2026-07-17 update653: master level20, maximum10 stacks.
 * This exposes the official effect table, not a measured damage formula. */
export function aranComboCritical(combo: number, learned: boolean) {
  const stacks = learned ? Math.min(10, Math.floor(Math.max(0, combo) / 10)) : 0;
  return { stacks, rate: learned ? 10 + 6 * stacks : 0, damage: learned ? 100 + 10 * stacks : 0 };
}
