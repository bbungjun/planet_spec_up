import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { StatSimulator } from "@/features/calculator/components/StatSimulator";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { STORAGE_KEY, serializeSetup } from "@/features/calculator/storage";

function fixture() {
  const input = createDefaultInput("corsair");
  Object.assign(input.character, { level: "120", pureMain: "600", pureSub: "22", mapleWarrior: 0,
    guildAttackFlat: "0", guildBossPercent: "0", guildIgnorePercent: "0" });
  input.equipment.projectile!.attackFlat = "0";
  Object.assign(input.equipment.weapon!, { attackFlat: "100", totalDamagePercent: "21", requiredLevel: "0", requiredSub: "0" });
  return input;
}
beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("supports buttons, signed inputs, reset, and live recalculation after baseline changes", async () => {
  const input = fixture(), user = userEvent.setup();
  const view = render(<StatSimulator input={input}/>);
  await user.click(screen.getByRole("button", { name: "장비 공격력 1 증가" }));
  expect(screen.getByLabelText("추가 장비 공격력")).toHaveValue(1);
  expect(screen.getByLabelText("시뮬레이션 스탯 공격력 결과")).toHaveTextContent("2,203");
  fireEvent.change(screen.getByLabelText("추가 총데미지%"), { target: { value: "-12" } });
  expect(screen.getByLabelText("시뮬레이션 환산 공격력 결과")).toHaveTextContent("2,841");
  const next = structuredClone(input); next.equipment.buff!.attackFlat = "10";
  view.rerender(<StatSimulator input={next}/>);
  expect(screen.getByLabelText("추가 장비 공격력")).toHaveValue(1);
  expect(screen.getByLabelText("시뮬레이션 스탯 공격력 결과")).toHaveTextContent("2,422");
  await user.click(screen.getByRole("button", { name: "추가 수치 초기화" }));
  expect(screen.getByLabelText("추가 총데미지%")).toHaveValue(0);
  expect(screen.getByLabelText("추가 장비 공격력")).toHaveValue(0);
});

it("keeps manual simulations out of the original stats and browser save", async () => {
  const input = fixture(); localStorage.setItem(STORAGE_KEY, serializeSetup(input));
  const view = render(<CalculatorApp/>);
  await waitFor(() => expect(screen.getByLabelText("순수 DEX")).toHaveValue(600));
  const baseline = within(screen.getByRole("table", {name:"전체 적용 결과"})).getByRole("row", {name:/최대 스탯공/});
  const original = within(baseline).getAllByRole("cell")[0].textContent;
  fireEvent.change(screen.getByLabelText("추가 장비 공격력"), { target: { value: "30" } });
  fireEvent.change(screen.getByLabelText("추가 총데미지%"), { target: { value: "-12" } });
  expect(within(baseline).getAllByRole("cell")[0]).toHaveTextContent(original!);
  expect(screen.getByLabelText("시뮬레이션 스탯 공격력 결과")).not.toHaveTextContent(original!);
  await userEvent.click(screen.getByRole("button", { name: "저장" }));
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
  expect(saved.input.equipment.weapon.attackFlat).toBe("100");
  expect(saved.input.equipment.weapon.totalDamagePercent).toBe("21");
  expect(saved.input).not.toHaveProperty("simulation");
  view.unmount(); render(<CalculatorApp/>);
  await waitFor(() => expect(screen.getByLabelText("순수 DEX")).toHaveValue(600));
  expect(screen.getByLabelText("추가 장비 공격력")).toHaveValue(0);
});

it("withholds invalid predictions, exposes field errors and returns after correction", () => {
  render(<StatSimulator input={fixture()}/>);
  fireEvent.change(screen.getByLabelText("추가 장비 공격력"), { target: { value: "-101" } });
  expect(screen.getByLabelText("추가 장비 공격력")).toHaveAttribute("aria-invalid", "true");
  expect(screen.queryByRole("region", { name: "적용 후 스탯창" })).not.toBeInTheDocument();
  expect(screen.getByText("현재 옵션 합계보다 많이 줄일 수 없습니다.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("추가 장비 공격력"), { target: { value: "0" } });
  expect(within(screen.getByRole("region", { name: "적용 후 옵션 효율" })).getByText("기준")).toBeInTheDocument();
});

it("keeps a scenario across combat presets but clears it on loading the saved setup", async () => {
  const input = fixture();
  input.weaponPresets = { active: "boss", entries: { hunting: { weapon: { ...input.equipment.weapon! }, monsterDefense: "0" } } };
  localStorage.setItem(STORAGE_KEY, serializeSetup(input));
  render(<CalculatorApp/>);
  await waitFor(() => expect(screen.getByLabelText("순수 DEX")).toHaveValue(600));
  fireEvent.change(screen.getByLabelText("추가 보공%"), { target: { value: "30" } });
  const sim = within(screen.getByRole("region", { name: "추가 스탯 시뮬레이터" }));
  expect(sim.getByLabelText("보공% 단독 환산공 변화")).not.toHaveTextContent(/^0%$/);
  await userEvent.selectOptions(screen.getByLabelText("비교 전투 프리셋"), "hunting");
  expect(screen.getByLabelText("추가 보공%")).toHaveValue(30);
  expect(sim.getByLabelText("보공% 단독 환산공 변화")).toHaveTextContent(/^0%$/);
  await userEvent.click(screen.getByRole("button", { name: "불러오기" }));
  expect(screen.getByLabelText("추가 보공%")).toHaveValue(0);
});
