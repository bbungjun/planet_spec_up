import { afterEach, expect, it, vi } from "vitest";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { createDefaultCashEquipment } from "@/features/calculator/domain/cash-equipment";
import { saveBaselineSetup } from "@/features/calculator/saveBaselineSetup";
import { serializeSetup } from "@/features/calculator/storage";
import type { CalculatorInput } from "@/features/calculator/domain/types";

afterEach(() => vi.restoreAllMocks());
const ocr = (job: CalculatorInput["character"]["job"] = "corsair") => ({ kind: "ocr" as const, job, entries: [], loading: false });

it("keeps raw blanks, explicit zero, inactive presets, pure stats and edited active weapon", () => {
  const input = createDefaultInput("corsair");
  Object.assign(input.character, { pureMain: "600", pureSub: "22" });
  Object.assign(input.equipment.weapon!, { attackFlat: "00100", mainFlat: "", subFlat: "0" });
  input.weaponPresets = { active: "chaos", entries: { boss: { weapon: { ...input.equipment.weapon!, attackFlat: "140" }, monsterDefense: "50" } } };
  const original = structuredClone(input);
  const persist = vi.fn().mockReturnValue("2026-10-01T00:00:00Z");
  const result = saveBaselineSetup(input, { kind: "preset" }, persist);
  expect(result).toMatchObject({ ok: true, input: { character: { pureMain: "600", pureSub: "22" }, equipment: { weapon: { attackFlat: "00100", mainFlat: "", subFlat: "0" } },
    weaponPresets: { entries: { chaos: { weapon: { attackFlat: "00100" } }, boss: { weapon: { attackFlat: "140" } } } } } });
  if (!result.ok) throw Error("Expected success");
  expect(persist).toHaveBeenCalledWith(result.input);
  expect(result.snapshot).toBe(JSON.stringify(result.input));
  expect(input).toEqual(original);
});

it("prepares a new slot exactly once and persists and returns the same generated ID", () => {
  const input = createDefaultInput("corsair");
  const id = vi.spyOn(crypto, "randomUUID");
  const persist = vi.fn().mockReturnValue("saved");
  const result = saveBaselineSetup(input, { ...ocr(), entries: [{ destination: "new", label: "새 어깨", replacement: { mainFlat: "3" } }] }, persist);
  expect(result.ok).toBe(true);
  expect(id).toHaveBeenCalledTimes(1);
  if (!result.ok) throw Error("Expected success");
  expect(persist.mock.calls[0][0]).toBe(result.input);
  expect(result.input.equipment[result.input.customSlots![0].id]?.mainFlat).toBe("3");
  expect(input.customSlots).toBeUndefined();
});

it.each(["preset", "ocr"] as const)("returns no success state and preserves input and real browser storage on %s write failure", kind => {
  const input = createDefaultInput("corsair"), original = structuredClone(input);
  const stored = serializeSetup(input, "2026-09-30T10:00:00.000Z");
  localStorage.setItem("failure-test", stored);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("quota"); });
  const persist = vi.fn((next: CalculatorInput) => { localStorage.setItem("failure-test", serializeSetup(next)); return "new timestamp"; });
  const result = saveBaselineSetup(input, kind === "preset" ? { kind } : ocr(), persist);
  expect(result).toMatchObject({ ok: false, message: kind === "ocr" ? expect.stringContaining("인식 목록은 유지") : "세팅을 저장할 수 없습니다." });
  expect(result).not.toHaveProperty("savedAt");
  expect(result).not.toHaveProperty("snapshot");
  expect(localStorage.getItem("failure-test")).toBe(stored);
  expect(JSON.parse(localStorage.getItem("failure-test")!).savedAt).toBe("2026-09-30T10:00:00.000Z");
  expect(input).toEqual(original);
});

it("preserves the ordinary-save vs photo-save validation difference for invalid level", () => {
  const input = createDefaultInput("corsair"); input.character.level = "999";
  expect(saveBaselineSetup(input, { kind: "preset" }, () => "saved").ok).toBe(true);
  const persist = vi.fn();
  expect(saveBaselineSetup(input, ocr(), persist)).toMatchObject({ ok: false, focusPath: "character.level", message: expect.stringContaining("캐릭터 설정") });
  expect(persist).not.toHaveBeenCalled();
});

it("preserves arrow priority before other character errors and distinct messages", () => {
  const input = createDefaultInput("marksman"); input.equipment.projectile!.attackFlat = "20"; input.character.level = "999";
  expect(saveBaselineSetup(input, { kind: "preset" }, vi.fn())).toEqual({ ok: false, focusPath: "equipment.projectile.attackFlat", message: "화살 공격력을 0~2 사이의 정수로 입력한 뒤 저장해주세요." });
  expect(saveBaselineSetup(input, ocr("marksman"), vi.fn())).toEqual({ ok: false, focusPath: "equipment.projectile.attackFlat", message: "화살 공격력을 0~2 사이의 정수로 입력한 뒤 저장하세요." });
});

it("preserves Aran then critical then cash then pure-stat priority for ordinary saves", () => {
  const input = createDefaultInput("aran"); input.character.aranWeaponConstant = ""; input.character.criticalRate = "101";
  expect(saveBaselineSetup(input, { kind: "preset" }, vi.fn())).toMatchObject({ ok: false, focusPath: "character.aranWeaponConstant" });
  const captain = createDefaultInput("corsair"); captain.character.criticalRate = "101";
  captain.cashEquipment = { ...createDefaultCashEquipment(), auroraRing: true, auroraRingCount: "5" }; captain.character.pureMain = "3";
  expect(saveBaselineSetup(captain, { kind: "preset" }, vi.fn())).toMatchObject({ ok: false, focusPath: "character.criticalRate" });
  captain.character.criticalRate = "0";
  expect(saveBaselineSetup(captain, { kind: "preset" }, vi.fn())).toMatchObject({ ok: false, focusPath: "cashEquipment.auroraRingCount" });
  captain.cashEquipment!.auroraRingCount = "0";
  expect(saveBaselineSetup(captain, { kind: "preset" }, vi.fn())).toMatchObject({ ok: false, focusPath: "character.pureSub" });
});

it("rejects loading and destination collisions before persistence and never partially applies", () => {
  const input = createDefaultInput("corsair"), original = structuredClone(input), persist = vi.fn();
  expect(saveBaselineSetup(input, { ...ocr(), loading: true }, persist)).toMatchObject({ ok: false, message: expect.stringContaining("불러오는 중") });
  expect(saveBaselineSetup(input, { ...ocr(), entries: [{ destination: "cape", label: "망토", replacement: { mainFlat: "3" } }, { destination: "cape", label: "망토", replacement: { mainFlat: "4" } }] }, persist)).toMatchObject({ ok: false, message: expect.stringContaining("적용 위치가 같습니다") });
  expect(persist).not.toHaveBeenCalled(); expect(input).toEqual(original);
});
