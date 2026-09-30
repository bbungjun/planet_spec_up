import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { applyStatWindow } from "@/features/calculator/domain/statWindow";
import { STORAGE_KEY, serializeSetup } from "@/features/calculator/storage";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
function seed() {
  const input = createDefaultInput("corsair");
  input.character.level = "200";
  Object.assign(input.equipment.weapon!, { attackFlat: "100", requiredLevel: "0", requiredSub: "0" });
  localStorage.setItem(STORAGE_KEY, serializeSetup(input));
  return input;
}
const ready = () => waitFor(() => expect(screen.getByLabelText("레벨")).toBeEnabled());
const setBase = (main = "1000", sub = "22") => {
  fireEvent.change(screen.getByLabelText("순수 DEX"), { target: { value: main } });
  fireEvent.change(screen.getByLabelText("순수 STR"), { target: { value: sub } });
};

it("offers direct base stats without photo registration or inventing stats from gear", async () => {
  const input = seed(); input.equipment.gloves!.mainFlat = "99";
  localStorage.setItem(STORAGE_KEY, serializeSetup(input));
  render(<CalculatorApp />); await ready();
  expect(screen.queryByRole("button", { name: /능력창 사진/ })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("능력창 사진 선택")).not.toBeInTheDocument();
  expect(screen.getByLabelText("순수 DEX")).toBeVisible();
  expect(screen.getByLabelText("순수 DEX")).toHaveValue(null);
  expect(screen.getByLabelText("순수 STR")).toHaveValue(null);
  expect(screen.queryByLabelText("순수 부스탯 수동값")).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "적용 후 스탯창" })).getByText("순수 스탯 추정")).toBeInTheDocument();
});

it("saves direct values and keeps them fixed across equipment and preset changes", async () => {
  seed(); const view = render(<CalculatorApp />); await ready();
  const user = userEvent.setup(); setBase();
  await user.click(screen.getByRole("button", { name: "장갑 편집" }));
  fireEvent.change(screen.getByLabelText("장갑 DEX"), { target: { value: "100" } });
  await user.click(screen.getByRole("button", { name: "카오스 보스용 프리셋 선택" }));
  expect(screen.getByLabelText("순수 DEX")).toHaveValue(1000);
  expect(screen.getByLabelText("순수 STR")).toHaveValue(22);
  await user.click(screen.getByRole("button", { name: "일반 보스용 프리셋 선택" }));
  await user.click(screen.getByRole("button", { name: "저장" }));
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
  expect(saved.input.character).toMatchObject({ pureMain: "1000", pureSub: "22" });
  expect(saved.input.equipment.weapon.attackFlat).toBe("100");
  expect(saved.input.equipment.gloves.mainFlat).toBe("100");
  expect(saved.input.statWindow).toBeUndefined();
  view.unmount(); render(<CalculatorApp />); await ready();
  expect(screen.getByLabelText("순수 DEX")).toHaveValue(1000);
  expect(screen.getByLabelText("순수 STR")).toHaveValue(22);
});

it("keeps legacy observations while using and restoring edited current base stats", async () => {
  const oldSnapshot = { job: "corsair" as const, level: 200, capturedAt: "2026-09-27T00:00:00Z", pure: { DEX: 1000, STR: 22 }, total: { DEX: 1100, STR: 22 }, maxAttack: 15000 };
  localStorage.setItem(STORAGE_KEY, serializeSetup(applyStatWindow(seed(), oldSnapshot)));
  const view = render(<CalculatorApp />); await ready();
  expect(screen.getByLabelText("순수 DEX")).toHaveValue(1000);
  setBase("999", "23");
  await userEvent.click(screen.getByRole("button", { name: "저장" }));
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
  expect(saved.input.statWindow).toEqual(oldSnapshot);
  expect(saved.input.character).toMatchObject({ pureMain: "999", pureSub: "23" });
  view.unmount(); render(<CalculatorApp />); await ready();
  expect(screen.getByLabelText("순수 DEX")).toHaveValue(999);
  expect(screen.getByLabelText("순수 STR")).toHaveValue(23);
});

it("focuses the missing base field and does not persist a half-entered pair", async () => {
  seed(); const original = localStorage.getItem(STORAGE_KEY);
  render(<CalculatorApp />); await ready(); setBase("1000", "");
  await userEvent.click(screen.getByRole("button", { name: /오류 순수 부스탯:/ }));
  expect(screen.getByLabelText("순수 STR")).toHaveFocus();
  await userEvent.click(screen.getByRole("button", { name: "프리셋 저장" }));
  expect(screen.queryByRole("dialog", { name: "저장되었습니다" })).not.toBeInTheDocument();
  expect(localStorage.getItem(STORAGE_KEY)).toBe(original);
});

it.each([["1000", "-1"], ["1022", "4"], ["1.5", "4"]])("rejects invalid base stats %s/%s", async (main, sub) => {
  seed(); const original = localStorage.getItem(STORAGE_KEY);
  render(<CalculatorApp />); await ready(); setBase(main, sub);
  expect(document.querySelector('[aria-invalid="true"]')).not.toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(localStorage.getItem(STORAGE_KEY)).toBe(original);
});

it("retains typed values and prior storage after a failed save", async () => {
  seed(); const original = localStorage.getItem(STORAGE_KEY);
  render(<CalculatorApp />); await ready(); setBase();
  const failure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("quota"); });
  await userEvent.click(screen.getByRole("button", { name: "프리셋 저장" }));
  expect(screen.queryByRole("dialog", { name: "저장되었습니다" })).not.toBeInTheDocument();
  expect(localStorage.getItem(STORAGE_KEY)).toBe(original);
  expect(screen.getByLabelText("순수 DEX")).toHaveValue(1000);
  expect(screen.getByLabelText("순수 STR")).toHaveValue(22);
  failure.mockRestore();
  await userEvent.click(screen.getByRole("button", { name: "프리셋 저장" }));
  expect(screen.getByRole("dialog", { name: "저장되었습니다" })).toBeVisible();
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).input.character.pureMain).toBe("1000");
});

it("keeps a legacy allocation input available until the user supplies the actual pair", async () => {
  const input = seed(); input.character.manualPureSub = "40";
  localStorage.setItem(STORAGE_KEY, serializeSetup(input));
  render(<CalculatorApp />); await ready();
  expect(screen.getByLabelText("순수 부스탯 수동값")).toHaveValue(40);
  expect(screen.getByLabelText("순수 STR")).toHaveValue(null);
  setBase();
  expect(screen.queryByLabelText("순수 부스탯 수동값")).not.toBeInTheDocument();
  expect(screen.getByLabelText("순수 STR")).toHaveValue(22);
});

it("keeps guild controls visible and independent of the base-stat inputs", async () => {
  render(<CalculatorApp />); await ready();
  for (const [label, value] of [["길드 보스 공격력 (%)", 5], ["길드 방어율 무시 (%)", 10], ["길드 명중률", 30], ["길드 공격력", 5]] as const) {
    expect(screen.getByLabelText(label)).toHaveValue(value);
    expect(screen.getByLabelText(label).closest("details")).toBeNull();
  }
  expect(screen.getByLabelText("불릿·표창 공격력")).toBeVisible();
});
