import { expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { OptionEfficiencyPanel } from "@/features/calculator/components/OptionEfficiencyPanel";
import { createDefaultInput } from "@/features/calculator/domain/defaults";

it("shows current option gains, zero effects, main-stat units and live updates", () => {
  const input = createDefaultInput("corsair");
  Object.assign(input.character, { pureMain: "700", pureSub: "4" });
  input.equipment.weapon!.attackFlat = "100";
  const { rerender } = render(<OptionEfficiencyPanel input={input} />);
  const panel = screen.getByRole("region", { name: "옵션 효율" });
  expect(within(panel).getByLabelText("DEX(장비) +1 주스탯 환산")).toHaveTextContent("기준");
  expect(within(panel).getByLabelText("방무 +1% 주스탯 환산")).toHaveTextContent("0 DEX");
  const before = within(panel).getByLabelText("공격력(장비) +1 주스탯 환산").textContent;
  rerender(<OptionEfficiencyPanel input={{ ...input, equipment: { ...input.equipment, weapon: { ...input.equipment.weapon!, mainPercent: "100" } } }} />);
  expect(within(panel).getByLabelText("공격력(장비) +1 주스탯 환산").textContent).not.toBe(before);
  expect(panel).not.toHaveTextContent("추정");
});

it("labels Night Lord's LUK and unregistered pure stats as estimates", () => {
  const input = createDefaultInput("night_lord");
  input.equipment.weapon!.attackFlat = "100";
  render(<OptionEfficiencyPanel input={input} />);
  expect(screen.getByText("LUK 환산 · 추정")).toBeInTheDocument();
  expect(screen.getByLabelText("LUK(장비) +1 주스탯 환산")).toHaveTextContent("기준");
});

it("explains unavailable calculations instead of showing misleading zeros or infinities", () => {
  const input = createDefaultInput("corsair");
  const { rerender } = render(<OptionEfficiencyPanel input={input} />);
  expect(screen.getByRole("status")).toHaveTextContent("무기 공격력");
  expect(screen.queryByLabelText("공격력(장비) +1 주스탯 환산")).not.toBeInTheDocument();
  rerender(<OptionEfficiencyPanel input={{ ...input, character: { ...input.character, pureMain: "700", pureSub: "4", mapleWarrior: 0 }, equipment: { ...input.equipment, weapon: { ...input.equipment.weapon!, attackFlat: "1" } } }} />);
  expect(screen.getByLabelText("공격력(장비) +1 주스탯 환산")).toHaveTextContent("—");
  expect(screen.getByText(/DEX \+1의 상승량이 0/)).toBeInTheDocument();
});
