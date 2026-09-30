/** D-MARKSMAN-IMPLEMENT-001: fixed master skills, separate from active Sharp Eyes. */
export const MARKSMAN_MASTER_SKILLS = {
  crossbowExpert: { level: 30, attack: 10, mastery: 90 },
  sharpEyesPassive: { criticalRate: 10, criticalDamage: 10 },
} as const;

/** The user's applied arrow attack, outside the equipment attack% term. */
export const MARKSMAN_ARROW_ATTACK_MAX = 2;
export const DEFAULT_MARKSMAN_ARROW_ATTACK = "0";
