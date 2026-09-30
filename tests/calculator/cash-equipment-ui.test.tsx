import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { deserializeSetup, serializeSetup, STORAGE_KEY } from "@/features/calculator/storage";

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it("places the cash panel below guild skills, updates set bonuses, and saves/restores independently of normal rings", async () => {
  const input = createDefaultInput("corsair"); input.equipment.buff!.attackFlat = "0"; // Fixed no-buff reference.
  Object.assign(input.character, { pureMain: "600", pureSub: "22" });
  Object.assign(input.equipment.weapon!, { attackFlat: "101", attackPercent: "21" });
  for (const slot of ["ring_1", "ring_2", "ring_3", "ring_4"] as const) input.equipment[slot]!.mainFlat = "10";
  localStorage.setItem(STORAGE_KEY, serializeSetup(input));
  const user = userEvent.setup(), view = render(<CalculatorApp />);
  const count = screen.getByLabelText("오로라 반지 개수");
  await waitFor(() => expect(screen.getByLabelText("직업")).toBeEnabled());
  expect(count).toBeDisabled();
  const guild = screen.getByRole("heading", { name: "길드 스킬" }).closest("section")!;
  expect(guild.nextElementSibling).toBe(screen.getByRole("heading", { name: "캐시 장비" }).closest("section"));
  await user.click(screen.getByRole("checkbox", { name: /^오로라 반지/ }));
  fireEvent.change(count, { target: { value: "4" } });
  await user.click(screen.getByRole("checkbox", { name: /^결혼 반지/ }));
  await user.click(screen.getByRole("checkbox", { name: /^성주의 모자/ }));
  expect(screen.getByLabelText("캐시 장비 적용 합계")).toHaveTextContent("올스탯 +12");
  await user.click(screen.getByRole("checkbox", { name: /^성주의 신발/ }));
  expect(screen.getByLabelText("캐시 장비 적용 합계")).toHaveTextContent("올스탯 +22");
  expect(screen.getByLabelText("캐시 장비 적용 합계")).toHaveTextContent("공격력 +0");
  await user.click(screen.getByRole("checkbox", { name: /^성주의 한벌옷/ }));
  expect(screen.getByLabelText("캐시 장비 적용 합계")).toHaveTextContent("올스탯 +27공격력 +5");
  expect(within(screen.getByRole("region", {name:"적용 후 스탯창"})).getByText("공격력").nextElementSibling).toHaveTextContent("153");
  await user.click(screen.getByRole("button", { name: "사냥용 프리셋 선택" }));
  expect(count).toHaveValue(4);
  await user.click(screen.getByRole("button", { name: /^저장$/ }));
  const loaded = deserializeSetup(localStorage.getItem(STORAGE_KEY)!);
  if (!loaded.ok) throw new Error(loaded.message);
  expect(loaded.value.input.cashEquipment).toMatchObject({ auroraRing: true, auroraRingCount: "4", weddingRing: true, lordHat: true, lordShoes: true, lordOverall: true });
  for (const slot of ["ring_1", "ring_2", "ring_3", "ring_4"] as const) expect(loaded.value.input.equipment[slot]).toEqual(input.equipment[slot]);
  view.unmount(); render(<CalculatorApp />);
  await waitFor(() => expect(screen.getByLabelText("오로라 반지 개수")).toHaveValue(4));
  expect(screen.getByLabelText("캐시 장비 적용 합계")).toHaveTextContent("올스탯 +27공격력 +5");
});

it("blocks saving invalid counts, focuses the field, and retains the count when unchecked", async () => {
  const user = userEvent.setup(); render(<CalculatorApp />);
  await waitFor(() => expect(screen.getByLabelText("직업")).toBeEnabled());
  const ring = screen.getByRole("checkbox", { name: /^오로라 반지/ }), count = screen.getByLabelText("오로라 반지 개수");
  await user.click(ring);
  fireEvent.change(count, { target: { value: "5" } });
  expect(count).toHaveAttribute("aria-invalid", "true");
  await user.click(screen.getByRole("button", { name: /^저장$/ }));
  expect(count).toHaveFocus(); expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  fireEvent.change(count, { target: { value: "" } });
  expect(screen.getByLabelText("캐시 장비 적용 합계")).toHaveTextContent("확인해주세요");
  fireEvent.change(count, { target: { value: "4" } });
  await user.click(ring);
  expect(count).toBeDisabled(); expect(count).toHaveValue(4);
  expect(screen.getByLabelText("캐시 장비 적용 합계")).toHaveTextContent("올스탯 +0공격력 +0");
  await user.click(ring);
  expect(screen.getByLabelText("캐시 장비 적용 합계")).toHaveTextContent("올스탯 +4공격력 +0");
});
