import { matchingSlots, RING_SLOTS } from "../domain/slots";
import { checkPendantRequirements, isPendantCategory, isPendantId, isPendantSlot, PENDANT_SLOTS } from "../domain/pendants";
import type { CalculatorInput, EquipmentInput, EquipmentSlot, JobId, WeaponPresetId } from "../domain/types";
import { activeWeaponPreset, captureWeaponPreset, getWeaponPreset, WEAPON_PRESETS } from "../domain/weapon-presets";
import { emptyEquipment } from "../domain/defaults";
import { addEquipmentSlot, getVisibleEquipmentSlots } from "../domain/slots";
import { applyStatReplacement } from "./applyStatReplacement";
import { mapRecognizedStats } from "./mapRecognizedStats";
import { parseMapleTooltip } from "./parseMapleTooltip";
import type { ParsedTooltipStats, StatReplacement } from "./types";
import { tooltipHeader } from "./tooltipHeader";

export type OcrSlotChoice = { slot: EquipmentSlot; label: string; equipment: EquipmentInput };
export type OcrDestination = EquipmentSlot | `preset:${WeaponPresetId}` | "new";
export type OcrBatchEntry = { replacement: StatReplacement; destination: OcrDestination; label: string; category?: string | null; pendantId?: string };
export type ApplyOcrBatch = (job: JobId, entries: OcrBatchEntry[]) => string | null;
export const MAX_BATCH_FILES = 50;
export const MAX_BATCH_BYTES = 120 * 1024 * 1024;

export function occupied(equipment: EquipmentInput): boolean {
  return Object.values(equipment).some(value => (value ?? "").trim() !== "");
}

export { matchingSlots } from "../domain/slots";

export function existingDuplicate(parsed: ParsedTooltipStats, job: JobId, choices: OcrSlotChoice[]): string | null {
  // Up to four distinct rings may have identical names and options.
  if (parsed.category === "반지" || isPendantCategory(parsed.category)) return null;
  const mapped = mapRecognizedStats(parsed, job);
  if (!Object.values(mapped).some(value => value && Number(value) !== 0)) return null;
  const match = matchingSlots(parsed.category, choices).find(({equipment}) => occupied(equipment)
    && Object.entries(mapped).every(([key, value]) => Number(equipment[key as keyof EquipmentInput] ?? "") === Number(value ?? "")));
  return match ? `이미 입력된 ${match.label}와 인식값이 같습니다.` : null;
}

export function tooltipIdentity(text: string): { name: string | null; signature: string | null } {
  const parsed = parseMapleTooltip(text);
  const name = tooltipHeader(text)?.name ?? null;
  if (!parsed.category || parsed.options.length === 0) return {name, signature: null};
  const options = parsed.options.map(o => [o.requirement, o.label.replace(/\s/g, ""), o.percent, o.value]);
  options.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {name, signature: JSON.stringify([parsed.category, name?.replace(/\s/g, "") ?? null, options])};
}

/** Browser-local content hash; the filename is intentionally not part of it. */
export async function imageFingerprint(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("이미지 파일을 읽지 못했습니다."));
    reader.readAsArrayBuffer(file);
  });
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function validReplacement(value: StatReplacement): boolean {
  return Object.values(value).some(raw => raw !== undefined && raw !== "") && Object.entries(value).every(([key, raw]) => {
    if (raw === "" || raw === undefined) return true;
    const number = Number(raw);
    const percent = key.endsWith("Percent");
    return Number.isFinite(number) && number >= 0 && number <= (key === "ignoreDefensePercent" ? 100 : percent ? 999 : 9999) && (percent || Number.isInteger(number));
  });
}

/** Validate the whole import first, then replace records in one immutable update. */
export function applyOcrBatch(input: CalculatorInput, job: JobId, entries: OcrBatchEntry[]): {input: CalculatorInput; error: null} | {input: null; error: string} {
  if (input.character.job !== job) return {input: null, error: "직업이 바뀌었습니다. 이미지를 다시 선택하세요."};
  const seen = new Set<string>();
  const visible = new Set(getVisibleEquipmentSlots(input));
  let next = input;
  for (const entry of entries) {
    if (!validReplacement(entry.replacement)) return {input: null, error: "인식값의 숫자 범위를 확인하세요."};
    if (entry.pendantId !== undefined && !isPendantId(entry.pendantId)) return {input: null, error: "펜던트 종류를 다시 확인해주세요."};
    if ((isPendantCategory(entry.category) || isPendantCategory(entry.label) || entry.pendantId)
      && !PENDANT_SLOTS.includes(entry.destination as EquipmentSlot)) return {input: null, error: "펜던트는 최대 2개입니다. 펜던트 1·2 중 적용 위치를 선택하세요."};
    if ((entry.category === "반지" || /^반지(?:\s+\d+)?$/.test(entry.label.trim())) && !RING_SLOTS.includes(entry.destination as EquipmentSlot)) {
      return { input: null, error: "반지는 최대 4개까지 착용할 수 있습니다. 반지 1~4 중 적용 위치를 선택하세요." };
    }
    if (entry.destination.startsWith("preset:")) {
      const id = entry.destination.slice(7) as WeaponPresetId;
      const preset = WEAPON_PRESETS.find(preset => preset.id === id);
      if (!preset) return { input: null, error: "무기 프리셋을 다시 선택하세요." };
      const destinationKey = id === activeWeaponPreset(next) ? "weapon" : entry.destination;
      if (seen.has(destinationKey)) return {input: null, error: "여러 이미지의 적용 위치가 같습니다. 각각 다른 무기 프리셋을 선택하세요."};
      seen.add(destinationKey);
      const saved = getWeaponPreset(next, id);
      const weapon = applyStatReplacement(saved?.weapon ?? emptyEquipment(), entry.replacement);
      next = captureWeaponPreset(next);
      next = { ...next, weaponPresets: { ...next.weaponPresets!, entries: { ...next.weaponPresets!.entries,
        [id]: { weapon, monsterDefense: saved?.monsterDefense ?? preset.defense },
      } } };
      if (id === activeWeaponPreset(next)) next = { ...next, equipment: { ...next.equipment, weapon } };
      continue;
    }
    let slot: EquipmentSlot;
    if (entry.destination === "new") {
      const added = addEquipmentSlot(next, entry.label);
      if (!added) return {input: null, error: "새 장비 이름(1~30자) 또는 추가 부위 개수(최대 50개)를 확인하세요."};
      next = added.input;
      slot = added.slot;
    } else {
      slot = entry.destination as EquipmentSlot;
      if (!visible.has(slot) || !next.equipment[slot]) return {input: null, error: "적용할 장비가 없어졌습니다. 적용 위치를 다시 선택하세요."};
      if (seen.has(slot)) return {input: null, error: "여러 이미지의 적용 위치가 같습니다. 각각 다른 부위나 새 장비를 선택하세요."};
      seen.add(slot);
    }
    next = {...next, equipment: {...next.equipment, [slot]: { ...applyStatReplacement(next.equipment[slot]!, entry.replacement),
      ...(isPendantSlot(next, slot) && entry.pendantId !== undefined ? { pendantId: entry.pendantId } : {}) }}};
  }
  const pendantIssue = checkPendantRequirements(next)[0];
  if (pendantIssue) return {input: null, error: pendantIssue.message};
  return {input: next, error: null};
}
