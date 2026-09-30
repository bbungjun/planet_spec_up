import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { calculateDamageResult } from "@/features/calculator/domain/calculate";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { activeWeaponPreset, switchWeaponPreset } from "@/features/calculator/domain/weapon-presets";
import { deserializeSetup, serializeSetup, STORAGE_KEY } from "@/features/calculator/storage";
import { mapRecognizedStats } from "@/features/calculator/ocr/mapRecognizedStats";
import { parseMapleTooltip } from "@/features/calculator/ocr/parseMapleTooltip";
import { applyStatReplacement } from "@/features/calculator/ocr/applyStatReplacement";
import { applyOcrBatch } from "@/features/calculator/ocr/batch";
import { EquipmentOcrPanel } from "@/features/calculator/components/EquipmentOcrPanel";
import * as recognition from "@/features/calculator/ocr/recognizeTooltip.client";

beforeEach(() => localStorage.clear());
const replacement = (text: string) => mapRecognizedStats(parseMapleTooltip(text), "corsair");

it("keeps three independent weapons and defense rates with shared armor and buffs", () => {
  let input = createDefaultInput("corsair");
  input.equipment.weapon!.attackFlat = "100";
  input.equipment.weapon!.bossDamagePercent = "60";
  input.character.monsterDefense = "25";
  input.equipment.necklace!.mainFlat = "30";
  input.equipment.buff!.attackFlat = "35";
  const armor = input.equipment.necklace;
  input = switchWeaponPreset(input, "chaos");
  expect(input.character.monsterDefense).toBe("80");
  expect(input.equipment.weapon!.attackFlat).toBe("");
  input.equipment.weapon!.attackFlat = "110";
  input.equipment.weapon!.ignoreDefensePercent = "60";
  input.character.monsterDefense = "60";
  input = switchWeaponPreset(input, "hunting");
  input.equipment.weapon!.attackFlat = "120";
  input.equipment.weapon!.totalDamagePercent = "21";
  const restored = deserializeSetup(serializeSetup(input));
  expect(restored.ok).toBe(true);
  if (!restored.ok) throw new Error("save failed");
  input = switchWeaponPreset(restored.value.input, "boss");
  expect(input.equipment.weapon).toMatchObject({attackFlat: "100", bossDamagePercent: "60"});
  expect(input.character.monsterDefense).toBe("25");
  input = switchWeaponPreset(input, "chaos");
  expect(input.equipment.weapon).toMatchObject({attackFlat: "110", ignoreDefensePercent: "60"});
  expect(input.character.monsterDefense).toBe("60");
  input = switchWeaponPreset(input, "hunting");
  expect(input.equipment.weapon).toMatchObject({attackFlat: "120", totalDamagePercent: "21"});
  expect(input.equipment.necklace).toEqual(armor);
  expect(input.equipment.buff!.attackFlat).toBe("35");
  expect(calculateDamageResult(input).totalAttack).toBe(180); // weapon 120 + buff 35 + guild 5 + projectile 20
});

it("excludes all boss bonuses in hunting but preserves total damage and additive IED", () => {
  let input = createDefaultInput("corsair");
  Object.assign(input.character, {monsterDefense: "80", totalDamagePercent: "10", bossDamagePercent: "20", ignoreDefense: "10", guildBossLevel: 5, guildIgnoreLevel: 5, guildActiveBoss: true});
  Object.assign(input.equipment.weapon!, {attackFlat: "100", totalDamagePercent: "21", bossDamagePercent: "60", ignoreDefensePercent: "30"});
  const boss = calculateDamageResult(input);
  expect(boss.formulaInputs.bossAndTotalDamage).toBe(126);
  expect(boss.formulaInputs.homingDamagePercent).toBe(20);
  expect(boss.defenseMultiplier).toBeCloseTo(0.7);
  const weapon = {...input.equipment.weapon!};
  input = switchWeaponPreset(input, "hunting");
  input.equipment.weapon = weapon;
  input.character.monsterDefense = "80";
  const hunting = calculateDamageResult(input);
  expect(hunting.statAttack).toBe(boss.statAttack);
  expect(hunting.formulaInputs.bossAndTotalDamage).toBe(31);
  expect(hunting.formulaInputs.homingDamagePercent).toBe(0);
  expect(hunting.defenseMultiplier).toBeCloseTo(0.7);
  expect(hunting.convertedAttack).toBe(Math.floor(hunting.statAttack * 1.31 * .7));
  input.equipment.weapon.ignoreDefensePercent = "100";
  expect(calculateDamageResult(input).defenseMultiplier).toBe(1);
});

it("adds homing only in Captain boss presets and recalculates after switching or restoring", () => {
  let input = createDefaultInput("corsair");
  Object.assign(input.character, { level: "120", pureMain: "600", pureSub: "22", guildBossPercent: "0", guildIgnorePercent: "0", guildAttackFlat: "0", monsterDefense: "0" });
  Object.assign(input.equipment.weapon!, { attackFlat: "100", bossDamagePercent: "60", totalDamagePercent: "21", requiredLevel: "0", requiredSub: "0" });
  const weapon = { ...input.equipment.weapon! };
  const boss = calculateDamageResult(input);
  expect(boss.formulaInputs).toMatchObject({ bossAndTotalDamage: 81, homingDamagePercent: 20 });
  expect(boss.convertedAttack).toBe(Math.floor(boss.statAttack * 2.01));

  input = switchWeaponPreset(input, "chaos");
  input.equipment.weapon = { ...weapon };
  input.character.monsterDefense = "0";
  const chaos = calculateDamageResult(input);
  expect(chaos.statAttack).toBe(boss.statAttack);
  expect(chaos.convertedAttack).toBe(boss.convertedAttack);

  input = switchWeaponPreset(input, "hunting");
  input.equipment.weapon = { ...weapon };
  const hunting = calculateDamageResult(input);
  expect(hunting.formulaInputs).toMatchObject({ bossAndTotalDamage: 21, homingDamagePercent: 0 });
  expect(hunting.convertedAttack).toBe(Math.floor(hunting.statAttack * 1.21));

  const restored = deserializeSetup(serializeSetup(input));
  expect(restored.ok).toBe(true);
  if (!restored.ok) throw new Error("save failed");
  const bossAgain = calculateDamageResult(switchWeaponPreset(restored.value.input, "boss"));
  expect(bossAgain.convertedAttack).toBe(boss.convertedAttack);
  expect(bossAgain.formulaInputs.homingDamagePercent).toBe(20);
});

it("preserves ambiguous legacy data and marks it for splitting instead of guessing", () => {
  const old = createDefaultInput("corsair");
  old.equipment.weapon!.attackFlat = "100";
  old.equipment.weapon!.damagePercent = "21";
  old.character.bossAndTotalDamage = "65";
  const loaded = deserializeSetup(serializeSetup(old));
  expect(loaded).toMatchObject({ok: true, value: {input: old}});
  expect(activeWeaponPreset(old)).toBe("boss");
  const result = calculateDamageResult(old);
  expect(result.formulaInputs.bossAndTotalDamage).toBe(91);
  expect(result.issues.filter(issue => issue.code === "LEGACY_DAMAGE_SPLIT")).toHaveLength(2);
  expect(switchWeaponPreset(switchWeaponPreset(old, "chaos"), "boss").equipment.weapon).toEqual(old.equipment.weapon);
});

it("separates OCR boss, total and ignore-defense and clears prior damage options on review apply", () => {
  const parsed = replacement("공격력 +100\n보스 몬스터 공격 시 데미지 +30%\n보스 공격력 +30%\n총 데미지 +9%\n총 데미지 +6%\n몬스터 방어력 무시 +30%\n방어율 무시 +20%");
  expect(parsed).toMatchObject({bossDamagePercent: "60", totalDamagePercent: "15", ignoreDefensePercent: "50", damagePercent: ""});
  const old = {...createDefaultInput("corsair").equipment.weapon!, damagePercent: "90", bossDamagePercent: "60", ignoreDefensePercent: "60"};
  expect(applyStatReplacement(old, replacement("공격력 +120\n총데미지 +21%"))).toMatchObject({attackFlat: "120", totalDamagePercent: "21", bossDamagePercent: "", ignoreDefensePercent: "", damagePercent: ""});
  expect(parseMapleTooltip("방어율 무시 +3096").options).toHaveLength(0);
});

it("imports three weapons atomically into presets without summing them", () => {
  const input = createDefaultInput("corsair"); input.equipment.buff!.attackFlat = "0"; // Fixed no-buff reference.
  const outcome = applyOcrBatch(input, "corsair", [
    {destination: "preset:chaos", label: "건", replacement: replacement("공격력 +110\n방어율 무시 +60%")},
    {destination: "preset:boss", label: "건", replacement: replacement("공격력 +100\n보스공격력 +60%")},
    {destination: "preset:hunting", label: "건", replacement: replacement("공격력 +120\n총데미지 +21%")},
  ]);
  expect(outcome.error).toBeNull();
  if (!outcome.input) throw new Error("import failed");
  expect(calculateDamageResult(outcome.input).totalAttack).toBe(125);
  expect(calculateDamageResult(switchWeaponPreset(outcome.input, "chaos")).totalAttack).toBe(135);
  expect(calculateDamageResult(switchWeaponPreset(outcome.input, "hunting")).totalAttack).toBe(145);
  expect(input.equipment.weapon!.attackFlat).toBe("");
  for (const destinations of [["weapon", "preset:boss"], ["preset:boss", "weapon"], ["preset:chaos", "preset:chaos"]] as const) {
    const conflict = applyOcrBatch(input, "corsair", destinations.map(destination => ({destination, label: "건", replacement: replacement("공격력 +100")})));
    expect(conflict.input).toBeNull();
    expect(conflict.error).toMatch(/적용 위치가 같습니다/);
  }
});

it("rejects malformed preset saves and out-of-range OCR ignore-defense", () => {
  const input = switchWeaponPreset(createDefaultInput("corsair"), "chaos");
  const raw = JSON.parse(serializeSetup(input));
  raw.input.weaponPresets.active = "unknown";
  expect(deserializeSetup(JSON.stringify(raw)).ok).toBe(false);
  raw.input.weaponPresets.active = "chaos";
  raw.input.weaponPresets.entries.hunting = {weapon: {}, monsterDefense: "0"};
  expect(deserializeSetup(JSON.stringify(raw)).ok).toBe(false);
  expect(applyOcrBatch(input, "corsair", [{destination: "preset:chaos", label: "건", replacement: replacement("방어율 무시 +101%")}]).input).toBeNull();
});

it("registers one to three independent weapons and restores them through the UI", async () => {
  const user = userEvent.setup();
  const view = render(<CalculatorApp />);
  const sidebar = screen.getByRole("complementary", {name: "무기 프리셋 및 저장"});
  expect(within(sidebar).getByRole("button", {name: "프리셋 저장"})).toBeVisible();
  expect(sidebar.querySelector("details")).toBeNull();
  expect(within(sidebar).getAllByText("최대 스탯공")).toHaveLength(3);
  expect(within(sidebar).getAllByText("환산 공격력")).toHaveLength(3);
  expect(screen.queryByRole("button", {name: /현재 무기를 .* 복사/})).not.toBeInTheDocument();
  expect(screen.getAllByText("무기 미등록")).toHaveLength(3);
  await user.click(screen.getByRole("button", {name: "일반 보스용 프리셋 선택"}));
  await user.type(screen.getByLabelText("무기 공격력", {exact: true}), "100");
  await user.type(screen.getByLabelText("무기 보스공격력%"), "60");
  expect(within(sidebar).getByRole("status", {name: "저장 상태"})).toHaveTextContent("저장하지 않은 변경 있음");
  await user.click(screen.getByRole("button", {name: "프리셋 저장"}));
  const savedDialog = screen.getByRole("dialog", {name: "저장되었습니다"});
  expect(within(savedDialog).getByRole("button", {name: "확인"})).toHaveFocus();
  await user.click(within(savedDialog).getByRole("button", {name: "확인"}));
  expect(screen.queryByRole("dialog", {name: "저장되었습니다"})).not.toBeInTheDocument();
  expect(screen.getByRole("button", {name: "프리셋 저장"})).toHaveFocus();
  const oneWeapon = deserializeSetup(localStorage.getItem(STORAGE_KEY)!);
  expect(oneWeapon.ok).toBe(true);
  if (!oneWeapon.ok) throw new Error("save failed");
  expect(oneWeapon.value.input.weaponPresets?.entries.chaos).toBeUndefined();
  expect(oneWeapon.value.input.weaponPresets?.entries.hunting).toBeUndefined();
  expect(screen.getAllByText("무기 미등록")).toHaveLength(2);
  await user.click(screen.getByRole("button", {name: "카오스 보스용 프리셋 선택"}));
  expect(screen.getByLabelText("무기 공격력", {exact: true})).toHaveValue(null);
  expect(screen.getByLabelText("무기 보스공격력%")).toHaveValue(null);
  await user.type(screen.getByLabelText("무기 공격력", {exact: true}), "110");
  await user.type(screen.getByLabelText("무기 방어율 무시%"), "60");
  await user.click(screen.getByRole("button", {name: "프리셋 저장"}));
  await user.click(within(screen.getByRole("dialog", {name: "저장되었습니다"})).getByRole("button", {name: "확인"}));
  const twoWeapons = deserializeSetup(localStorage.getItem(STORAGE_KEY)!);
  expect(twoWeapons.ok).toBe(true);
  if (!twoWeapons.ok) throw new Error("save failed");
  expect(twoWeapons.value.input.weaponPresets?.entries.hunting).toBeUndefined();
  expect(screen.getAllByText("무기 미등록")).toHaveLength(1);
  await user.click(screen.getByRole("button", {name: "사냥용 프리셋 선택"}));
  expect(screen.getByLabelText("무기 공격력", {exact: true})).toHaveValue(null);
  await user.click(screen.getByRole("button", {name: "일괄 입력 보기"}));
  await user.type(screen.getByLabelText("일괄 입력 무기 공격력", {exact: true}), "120");
  await user.type(screen.getByLabelText("일괄 입력 무기 총데미지%"), "21");
  await user.click(screen.getByRole("button", {name: "프리셋 저장"}));
  expect(screen.getByRole("dialog", {name: "저장되었습니다"})).toBeVisible();
  expect(localStorage.length).toBe(1);
  const saved = deserializeSetup(localStorage.getItem(STORAGE_KEY)!);
  expect(saved).toMatchObject({ok: true, value: {input: {weaponPresets: {active: "hunting", entries: {
    boss: {weapon: {attackFlat: "100", bossDamagePercent: "60"}},
    chaos: {weapon: {attackFlat: "110", ignoreDefensePercent: "60"}},
    hunting: {weapon: {attackFlat: "120", totalDamagePercent: "21"}},
  }}}}});
  view.unmount();
  render(<CalculatorApp />);
  await waitFor(() => expect(screen.getByRole("button", {name: "사냥용 프리셋 선택"})).toHaveAttribute("aria-pressed", "true"));
  await user.click(screen.getByRole("button", {name: "카오스 보스용 프리셋 선택"}));
  expect(screen.getByLabelText("무기 공격력", {exact: true})).toHaveValue(110);
  expect(screen.getByLabelText("무기 방어율 무시%")).toHaveValue(60);
  await user.click(screen.getByRole("button", {name: "일반 보스용 프리셋 선택"}));
  expect(screen.getByLabelText("무기 보스공격력%")).toHaveValue(60);
  expect(screen.getByLabelText("무기 방어율 무시%")).toHaveValue(null);
});

it("suggests separate preset destinations for multiple weapon screenshots", async () => {
  const recognize = vi.fn().mockResolvedValueOnce("장비분류: 건\n공격력 +100\n방어율 무시 +60%")
    .mockResolvedValueOnce("장비분류: 건\n공격력 +110\n보스공격력 +60%")
    .mockResolvedValueOnce("장비분류: 건\n공격력 +120\n총데미지 +21%");
  const apply = vi.fn().mockReturnValue(null);
  const user = userEvent.setup();
  render(<EquipmentOcrPanel target={{job: "corsair", slot: "weapon"}} onApply={vi.fn()} onApplyBatch={apply}
    createRecognizer={() => ({recognize, terminate: vi.fn().mockResolvedValue(undefined)})} />);
  await user.upload(screen.getByLabelText("장비 스크린샷 파일"), ["chaos", "boss", "hunt"].map(name => new File([name], `${name}.png`, {type: "image/png"})));
  await screen.findByText("3/3장 인식 완료");
  expect(screen.getByLabelText("1번 적용 위치")).toHaveValue("preset:chaos");
  expect(screen.getByLabelText("2번 적용 위치")).toHaveValue("preset:boss");
  expect(screen.getByLabelText("3번 적용 위치")).toHaveValue("preset:hunting");
  await user.click(screen.getByRole("button", {name: "검토한 3개 장비 적용"}));
  expect(apply.mock.calls[0][1].map((entry: {destination: string}) => entry.destination)).toEqual(["preset:chaos", "preset:boss", "preset:hunting"]);
});

it("cancels pending OCR when switching weapon presets and ignores its late result", async () => {
  let finish: (text: string) => void = () => {};
  let signal: AbortSignal | undefined;
  const recognize = vi.fn<recognition.TooltipRecognizer["recognize"]>().mockImplementation((_file, options) => {
    signal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  });
  const spy = vi.spyOn(recognition, "createBrowserTooltipRecognizer").mockImplementation(() => ({recognize, terminate: vi.fn().mockResolvedValue(undefined)}));
  try {
    const user = userEvent.setup();
    render(<CalculatorApp />);
    await user.click(screen.getByRole("button", {name: "일반 보스용 프리셋 선택"}));
    await user.upload(screen.getByLabelText("장비 스크린샷 파일"), new File(["pending"], "pending.png", {type: "image/png"}));
    await waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", {name: "카오스 보스용 프리셋 선택"}));
    expect(signal?.aborted).toBe(true);
    finish("공격력 +200\n보스공격력 +60%");
    await Promise.resolve();
    expect(screen.queryByLabelText("인식 공격력")).not.toBeInTheDocument();
    expect(screen.getByLabelText("무기 공격력", {exact: true})).toHaveValue(null);
  } finally { spy.mockRestore(); }
});

it("blocks edits until the initial saved setup is restored", async () => {
  vi.useFakeTimers();
  try {
    const input = switchWeaponPreset(createDefaultInput("corsair"), "hunting");
    localStorage.setItem(STORAGE_KEY, serializeSetup(input));
    render(<CalculatorApp />);
    expect(screen.getByRole("button", {name: "카오스 보스용 프리셋 선택"})).toBeDisabled();
    act(() => vi.runAllTimers());
    expect(screen.getByRole("button", {name: "카오스 보스용 프리셋 선택"})).toBeEnabled();
    expect(screen.getByRole("button", {name: "사냥용 프리셋 선택"})).toHaveAttribute("aria-pressed", "true");
  } finally { vi.useRealTimers(); }
});
