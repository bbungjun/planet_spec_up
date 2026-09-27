import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { calculateDamageResult } from "@/features/calculator/domain/calculate";
import { serializeSetup, STORAGE_KEY } from "@/features/calculator/storage";
import { getVisibleEquipmentSlots } from "@/features/calculator/domain/slots";

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it("defaults projectile attack to 20 while excluding it from all equipment destinations", async () => {
  for (const job of ["corsair", "night_lord", "marksman"] as const) {
    const input = createDefaultInput(job);
    expect(input.equipment.projectile?.attackFlat).toBe("20");
    expect(getVisibleEquipmentSlots(input)).not.toContain("projectile");
    expect(calculateDamageResult(input).totalAttack).toBe(25);
  }
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  render(<CalculatorApp />);
  await waitFor(() => expect(screen.getByLabelText("직업")).toBeEnabled());
  expect(screen.queryByRole("button", { name: "표창·불릿 편집" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("직업"), "night_lord");
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByLabelText("직업")).toHaveValue("night_lord");
  expect(screen.getByLabelText("불릿·표창 공격력")).toHaveValue(20);
  await user.click(screen.getByRole("button", { name: "일괄 입력 보기" }));
  expect(screen.queryByLabelText("일괄 입력 표창·불릿 공격력", { exact: true })).not.toBeInTheDocument();
});

it("uses the direct value once outside attack percent and preserves it through save and reload", async () => {
  const input = createDefaultInput("corsair");
  Object.assign(input.equipment.weapon!, { attackFlat: "100", attackPercent: "100" });
  localStorage.setItem(STORAGE_KEY, serializeSetup(input));
  const user = userEvent.setup();
  const view = render(<CalculatorApp />);
  const direct = screen.getByLabelText("불릿·표창 공격력");
  await waitFor(() => expect(direct).toBeEnabled());
  fireEvent.change(direct, { target: { value: "27" } });
  expect(screen.getByText("공격력 합산 내역").querySelector("strong")).toHaveTextContent("232");
  await user.click(screen.getByRole("button", { name: "사냥용 프리셋 선택" }));
  expect(direct).toHaveValue(27);
  await user.click(screen.getByRole("button", { name: /^저장$/ }));
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).input.equipment.projectile.attackFlat).toBe("27");
  view.unmount(); render(<CalculatorApp />);
  await waitFor(() => expect(screen.getByLabelText("불릿·표창 공격력")).toHaveValue(27));
});

it.each(["0", "", "30"])("preserves a legacy saved projectile value %j instead of inserting 20", async value => {
  const input = createDefaultInput("corsair");
  input.equipment.projectile!.attackFlat = value;
  const saved = serializeSetup(input);
  localStorage.setItem(STORAGE_KEY, saved);
  render(<CalculatorApp />);
  await waitFor(() => expect(screen.getByLabelText("불릿·표창 공격력")).toHaveValue(value === "" ? null : Number(value)));
  expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
});

it("opens attack settings when navigating a projectile validation error", async () => {
  const user = userEvent.setup(); render(<CalculatorApp />);
  const direct = screen.getByLabelText("불릿·표창 공격력");
  await waitFor(() => expect(direct).toBeEnabled());
  fireEvent.change(direct, { target: { value: "-1" } });
  await user.click(screen.getByRole("button", { name: /^오류 표창·불릿 공격력:/ }));
  expect(direct).toHaveFocus();
  expect(document.getElementById("character-settings")).toHaveAttribute("open");
  expect(screen.queryByRole("heading", { name: "표창·불릿 옵션" })).not.toBeInTheDocument();
});
