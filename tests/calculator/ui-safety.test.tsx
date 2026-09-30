import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { serializeSetup, STORAGE_KEY } from "@/features/calculator/storage";
import * as presets from "@/features/calculator/components/WeaponPresetsPanel";
const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const input = createDefaultInput("corsair");
  Object.assign(input.character, { level: "120", pureMain: "600", pureSub: "22" });
  Object.assign(input.equipment.weapon!, { attackFlat: "100", requiredLevel: "0", requiredSub: "0" });
  localStorage.setItem(STORAGE_KEY, serializeSetup(input));
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalScrollIntoView) Element.prototype.scrollIntoView = originalScrollIntoView;
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

async function openCalculator() {
  render(<CalculatorApp />);
  await waitFor(() => expect(screen.getByRole("button", { name: "저장" })).toBeEnabled());
}
function leaveIsBlocked() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function addManualCandidate(price = "3") {
  fireEvent.click(screen.getByRole("button", { name: "비교 후보 추가" }));
  const dialog = within(screen.getByRole("dialog", { name: "비교할 장비 추가" }));
  fireEvent.click(dialog.getByRole("button", { name: "직접 입력" }));
  fireEvent.change(dialog.getByLabelText("새 후보 공격력", { exact: true }), { target: { value: "110" } });
  fireEvent.change(dialog.getByLabelText("새 후보 구매 가격"), { target: { value: price } });
  fireEvent.submit(dialog.getByRole("button", { name: "후보로 비교" }).closest("form")!);
}

it("tracks edits, reversal, successful save and failed save without treating viewing modes as edits", async () => {
  await openCalculator();
  expect(leaveIsBlocked()).toBe(false);
  fireEvent.click(screen.getByRole("tab", { name: "전체장비 직접입력" }));
  expect(leaveIsBlocked()).toBe(false);
  const attack = screen.getByLabelText("일괄 입력 무기 공격력", { exact: true });
  fireEvent.change(attack, { target: { value: "111" } });
  expect(screen.getByLabelText("저장 상태")).toHaveTextContent("저장하지 않은 변경 있음");
  expect(leaveIsBlocked()).toBe(true);
  fireEvent.change(attack, { target: { value: "100" } });
  expect(leaveIsBlocked()).toBe(false);
  fireEvent.change(attack, { target: { value: "111" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(leaveIsBlocked()).toBe(false);
  fireEvent.change(attack, { target: { value: "112" } });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(leaveIsBlocked()).toBe(true);
  expect(attack).toHaveValue(112);
});

it("retains savedAt and savedSnapshot after ordinary save failure", async () => {
  const raw = localStorage.getItem(STORAGE_KEY)!;
  const previousSavedAt = JSON.parse(raw).savedAt;
  const renderPanel = presets.WeaponPresetsPanel;
  const panel = vi.spyOn(presets, "WeaponPresetsPanel").mockImplementation(props => renderPanel(props));
  await openCalculator();
  expect(document.querySelector("time[datetime]")).toHaveAttribute("datetime", previousSavedAt);
  const attack = screen.getByLabelText("일괄 입력 무기 공격력", { exact: true });
  fireEvent.change(attack, { target: { value: "112" } });
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("quota"); });
  fireEvent.click(screen.getByRole("button", { name: "프리셋 저장" }));
  expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  expect(screen.queryByRole("dialog", { name: "저장되었습니다" })).not.toBeInTheDocument();
  // The save-error presentation hides <time>; observe the actual rendered panel's interface.
  expect(panel.mock.calls.at(-1)?.[0].savedAt).toBe(previousSavedAt);
  expect(leaveIsBlocked()).toBe(true);
  // Reversing the failed edit should match the old savedSnapshot, not the failed one.
  fireEvent.change(attack, { target: { value: "100" } });
  expect(leaveIsBlocked()).toBe(false);
  write.mockRestore();
  expect(panel.mock.calls.at(-1)?.[0].savedAt).toBe(previousSavedAt);
});

it("cancels load without losing edits, then restores only after confirmation", async () => {
  await openCalculator();
  fireEvent.click(screen.getByRole("tab", { name: "전체장비 직접입력" }));
  const attack = screen.getByLabelText("일괄 입력 무기 공격력", { exact: true });
  fireEvent.change(attack, { target: { value: "112" } });
  vi.mocked(window.confirm).mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "불러오기" }));
  expect(attack).toHaveValue(112);
  expect(leaveIsBlocked()).toBe(true);
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "불러오기" }));
  expect(screen.getByLabelText("일괄 입력 무기 공격력", { exact: true })).toHaveValue(100);
  expect(leaveIsBlocked()).toBe(false);
});

it("restores multiple deleted candidates in their original order with edited prices and options", async () => {
  await openCalculator();
  addManualCandidate("3"); addManualCandidate("4"); addManualCandidate("5");
  fireEvent.click(screen.getByRole("button", { name: "후보 2 상세 보기" }));
  fireEvent.change(screen.getByLabelText("후보 2 공격력", { exact: true }), { target: { value: "125" } });
  fireEvent.click(screen.getByRole("button", { name: "후보 2 상세 닫기" }));
  fireEvent.click(screen.getByRole("button", { name: "후보 1 삭제" }));
  expect(screen.getByRole("button", { name: "후보 1 삭제 취소" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "후보 2 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "후보 1 삭제 취소" }));
  fireEvent.click(screen.getByRole("button", { name: "후보 2 삭제 취소" }));
  expect(screen.getAllByRole("article").map(card => card.getAttribute("aria-label"))).toEqual([
    "후보 1 비교 결과", "후보 2 비교 결과", "후보 3 비교 결과",
  ]);
  const restored = screen.getByRole("article", { name: "후보 2 비교 결과" });
  expect(restored).toHaveFocus();
  expect(within(restored).getByLabelText("후보 2 구매 가격")).toHaveValue(4);
  fireEvent.click(within(restored).getByRole("button", { name: "후보 2 상세 보기" }));
  expect(screen.getByLabelText("후보 2 공격력", { exact: true })).toHaveValue(125);
});

it("guards temporary candidates even after saving gear, until deleted data is explicitly dismissed", async () => {
  await openCalculator();
  addManualCandidate();
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(leaveIsBlocked()).toBe(true);
  vi.mocked(window.confirm).mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "불러오기" }));
  expect(screen.getByRole("article")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "후보 1 삭제" }));
  expect(leaveIsBlocked()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "삭제 알림 닫기" }));
  expect(leaveIsBlocked()).toBe(false);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).input.candidates).toBeUndefined();
});

it("connects candidate price errors and honors reduced motion on card addition", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  await openCalculator();
  addManualCandidate();
  expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "nearest", inline: "nearest" });
  const price = screen.getByLabelText("후보 1 구매 가격");
  fireEvent.change(price, { target: { value: "0" } });
  expect(price).toHaveAttribute("aria-invalid", "true");
  expect(price).toHaveAccessibleDescription("0보다 큰 가격을 입력하세요.");
  fireEvent.change(price, { target: { value: "2" } });
  expect(price).not.toHaveAttribute("aria-invalid");
  expect(price).not.toHaveAttribute("aria-describedby");
});

it("skips toolbar controls and gives numeric fields meaningful names without blocking input", async () => {
  await openCalculator();
  fireEvent.click(screen.getByRole("link", { name: "장비 입력으로 바로가기" }));
  expect(document.getElementById("equipment-editor-area")).toHaveFocus();
  for (const input of document.querySelectorAll('input[type="number"]')) {
    expect(input.getAttribute("name")).toBeTruthy();
    expect(input).toHaveAttribute("autocomplete", "off");
  }
});
