export type JobId = "marksman" | "corsair" | "night_lord";
export type StatName = "STR" | "DEX" | "LUK";
export type InputMode = "cards" | "bulk";
export type SharpEyes = "none" | "usable" | "sharp_30";
export type MapleWarrior = 0 | 20 | 30;
export type GuildSkillLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type BuiltinEquipmentSlot =
  | "necklace" | "pendant_2" | "cape" | "earrings" | "eye" | "face"
  | "hat" | "shoes" | "gloves" | "overall" | "top" | "bottom"
  | "weapon" | "title" | "ring_1" | "ring_2" | "ring_3" | "ring_4"
  | "projectile" | "blessing_1" | "blessing_2" | "buff";

export type CustomEquipmentSlot = `extra_${string}`;
export type EquipmentSlot = BuiltinEquipmentSlot | CustomEquipmentSlot;
export type CustomSlot = { id: CustomEquipmentSlot; label: string };

export type EquipmentInput = {
  /** Confirmed pendant kind; absent in legacy saves or when unread. */
  pendantId?: string;
  mainFlat: string;
  subFlat: string;
  mainPercent: string;
  subPercent: string;
  attackFlat: string;
  attackPercent: string;
  requiredSub: string;
  /** Blank/absent means not yet verified, explicit 0 means no level requirement. */
  requiredLevel?: string;
  /** Optional for compatibility with existing saved equipment. */
  damagePercent?: string;
  totalDamagePercent?: string;
  bossDamagePercent?: string;
  ignoreDefensePercent?: string;
};

export type CharacterInput = {
  job: JobId;
  level: string;
  mapleWarrior: MapleWarrior;
  skillPercent: string;
  sharpEyes: SharpEyes;
  monsterDefense: string;
  bossAndTotalDamage: string;
  totalDamagePercent?: string;
  bossDamagePercent?: string;
  ignoreDefense: string;
  criticalRate: string;
  manualPureSub: string;
  nightLordStrStat: string;
  guildBossLevel: GuildSkillLevel;
  guildIgnoreLevel: GuildSkillLevel;
  guildAttackLevel: GuildSkillLevel;
  guildActiveBoss: boolean;
  /** Actual bonuses; absent keys retain older level-based saved data. */
  guildBossPercent?: string;
  guildIgnorePercent?: string;
  guildAttackFlat?: string;
  guildAccuracyFlat?: string;
  /** Verified base stats from the character window, separate from equipment. */
  pureMain?: string;
  pureSub?: string;
};

export type CashEquipmentInput = {
  auroraRing: boolean;
  auroraRingCount: string;
  weddingRing: boolean;
  lordHat: boolean;
  lordShoes: boolean;
  lordOverall: boolean;
};

export type CalculatorInput = {
  character: CharacterInput;
  equipment: Partial<Record<EquipmentSlot, EquipmentInput>>;
  /** Independent attack buffs; absent in older saves means disabled. */
  attackBuffs?: { sprinkling: boolean; rage: boolean };
  /** Shared cash equipment; absent in older saves means unequipped. */
  cashEquipment?: CashEquipmentInput;
  /** Older saved setups have no custom slots. */
  customSlots?: CustomSlot[];
  weaponPresets?: {
    active: WeaponPresetId;
    entries: Partial<Record<WeaponPresetId, WeaponPreset>>;
  };
  statWindow?: StatWindowSnapshot;
};

export type StatWindowSnapshot = {
  job: JobId;
  level: number;
  capturedAt: string;
  pure: Partial<Record<"STR" | "DEX" | "INT" | "LUK", number>>;
  total: Partial<Record<"STR" | "DEX" | "INT" | "LUK", number>>;
  maxAttack?: number;
  minAttack?: number;
  totalDamagePercent?: number;
  bossDamagePercent?: number;
  ignoreDefensePercent?: number;
  criticalRate?: number;
  accuracy?: number;
};

export type WeaponPresetId = "chaos" | "boss" | "hunting";
export type WeaponPreset = { weapon: EquipmentInput; monsterDefense: string };

export type ValidationIssue = {
  severity: "error" | "warning";
  path: string;
  code: string;
  message: string;
};

export type CalculationResult = {
  mainStat: number;
  subStat: number;
  extraStr: number;
  totalAttack: number;
  statAttack: number;
  convertedAttack: number;
  defenseMultiplier: number;
  criticalMultiplier: number;
  formulaInputs: {
    bossAndTotalDamage: number;
    homingDamagePercent?: number;
  };
  pureMain: number;
  pureSub: number;
  criticalStats?: { baseRate: number; extraRate: number; buffRate: number; baseDamage: number; buffDamage: number };
  windowStats?: { totalDamagePercent: number; bossDamagePercent: number; ignoreDefensePercent: number; criticalRate: number };
  issues: ValidationIssue[];
};
