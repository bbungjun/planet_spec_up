import { expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChaosWeaponEfficiencyPanel } from "@/features/calculator/components/ChaosWeaponEfficiencyPanel";

it("starts folded and preserves comparison controls when folded again", async () => {
  const user = userEvent.setup();
  const view = render(<ChaosWeaponEfficiencyPanel />);
  const panel = view.container.querySelector("details")!;
  const toggle = panel.querySelector("summary")!;
  expect(panel.open).toBe(false);
  expect(screen.getByRole("table")).not.toBeVisible();
  await user.click(toggle);
  expect(panel.open).toBe(true);
  expect(screen.getByRole("table")).toBeVisible();
  await user.selectOptions(screen.getByLabelText("비교 기준 잠재"), "blank");
  await user.click(screen.getByRole("button", { name: "카오스 자쿰 60%" }));
  await user.click(screen.getByRole("button", { name: "전체 19개 보기" }));
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(20);
  await user.click(toggle);
  expect(panel.open).toBe(false);
  await user.click(toggle);
  expect(screen.getByLabelText("비교 기준 잠재")).toHaveValue("blank");
  expect(screen.getByRole("button", { name: "카오스 자쿰 60%" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("카오스 자쿰 최고 효율 상승률")).toHaveTextContent("+157.14%");
  expect(screen.getByLabelText("카오스 혼테일 최고 효율 상승률")).toHaveTextContent("+285.71%");
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(20);
});

it("identifies the fixed reference and shows selected defense saturation without saving", async () => {
  const user = userEvent.setup();
  localStorage.setItem("chaos-reference-sentinel", "unchanged");
  const before = { ...localStorage };
  const view = render(<ChaosWeaponEfficiencyPanel />);
  await user.click(view.container.querySelector("summary")!);
  expect(screen.getByText("120레벨 유니크 · 길드 방무 10% · 보공 5%")).toBeVisible();
  expect(screen.getByText(/호밍 미적용/)).toBeVisible();
  expect(screen.getByLabelText("카오스 혼테일 최고 효율 상승률")).toHaveTextContent("+107.69%");
  await user.click(screen.getByRole("button", { name: "방무30 · 방무30 · 방무30 방어율 상세" }));
  const defense = screen.getByRole("status", { name: "선택 조합 방어율" });
  expect(defense).toHaveTextContent("합산 방무 100%");
  expect(defense).toHaveTextContent("초과 방무 40%p");
  expect(defense).toHaveTextContent("초과 방무 20%p");
  expect({ ...localStorage }).toEqual(before);
});
