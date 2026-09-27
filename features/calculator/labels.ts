import type { BuiltinEquipmentSlot } from "./domain/types";

export const EQUIPMENT_SLOT_LABELS: Record<BuiltinEquipmentSlot, string> = {
  necklace: "펜던트 1",
  pendant_2: "펜던트 2",
  cape: "망토",
  earrings: "귀고리",
  eye: "눈장식",
  face: "얼굴장식",
  hat: "모자",
  shoes: "신발",
  gloves: "장갑",
  overall: "한벌옷",
  top: "상의",
  bottom: "하의",
  weapon: "무기",
  title: "훈장",
  ring_1: "반지 1",
  ring_2: "반지 2",
  ring_3: "반지 3",
  ring_4: "반지 4",
  projectile: "표창·불릿",
  blessing_1: "정령의 축복",
  blessing_2: "여제의 축복",
  buff: "버프",
};

export const WEAPON_LABELS = {
  crossbow: "석궁",
  gun: "건",
  claw: "아대",
} as const;
