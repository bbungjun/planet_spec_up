import type { CashEquipmentInput } from "./types";

export type NormalizedCashEquipmentInput = Omit<CashEquipmentInput, "auroraRingCount"> & {
  auroraRingCount: number;
};

export function createDefaultCashEquipment(): CashEquipmentInput {
  return {
    auroraRing: false,
    auroraRingCount: "1",
    weddingRing: false,
    lordHat: false,
    lordShoes: false,
    lordOverall: false,
  };
}

export function cashEquipmentBonus(selection: NormalizedCashEquipmentInput) {
  const lordCount = [selection.lordHat, selection.lordShoes, selection.lordOverall].filter(Boolean).length;
  return {
    allStat: (selection.auroraRing ? selection.auroraRingCount : 0)
      + (selection.weddingRing ? 3 : 0) + lordCount * 5 + (lordCount >= 2 ? 5 : 0),
    attack: lordCount === 3 ? 5 : 0,
    lordCount,
  };
}
