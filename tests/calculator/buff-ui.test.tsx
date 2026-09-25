import { beforeEach, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { serializeSetup, STORAGE_KEY } from "@/features/calculator/storage";

beforeEach(() => localStorage.clear());

it("switches the verified Captain setup between boss buffs without stacking and saves the selected value", async () => {
  const input = createDefaultInput("corsair");
  input.character.level = "199";
  input.character.guildAttackLevel = 5;
  Object.assign(input.equipment.necklace!, {mainFlat: "213", subFlat: "111", mainPercent: "215", subPercent: "24"});
  input.equipment.weapon!.attackFlat = "124";
  input.equipment.projectile!.attackFlat = "20";
  input.equipment.blessing_1!.attackFlat = "15";
  input.equipment.blessing_2!.attackFlat = "12";
  input.equipment.buff!.attackFlat = "30";
  localStorage.setItem(STORAGE_KEY, serializeSetup(input));
  const user = userEvent.setup();
  const view = render(<CalculatorApp />);

  expect(await screen.findByDisplayValue("199")).toBeInTheDocument();
  expect(screen.getByLabelText("스탯 공격력 결과")).toHaveTextContent("29,674");
  expect(screen.getByLabelText("혼테일 예상 스탯공")).toHaveTextContent("29,674");
  expect(screen.getByLabelText("핑크빈 예상 스탯공")).toHaveTextContent("30,394");
  await user.click(screen.getByRole("button", {name: "핑크빈 +35"}));
  await user.click(screen.getByRole("button", {name: "핑크빈 +35"}));
  expect(screen.getByLabelText("공격력 버프 직접 입력")).toHaveValue(35);
  expect(screen.getByLabelText("스탯 공격력 결과")).toHaveTextContent("30,394");
  expect(screen.getByLabelText("정령의 축복", {exact: true})).toHaveValue(15);
  expect(screen.getByLabelText("여제의 축복", {exact: true})).toHaveValue(12);

  await user.click(screen.getByRole("button", {name: "버프 편집"}));
  expect(screen.getByLabelText("버프 공격력", {exact: true})).toHaveValue(35);
  await user.click(screen.getByRole("button", {name: "일괄 입력 보기"}));
  expect(screen.getByLabelText("일괄 입력 버프 공격력", {exact: true})).toHaveValue(35);
  await user.click(screen.getByRole("button", {name: /^저장$/}));
  view.unmount();
  render(<CalculatorApp />);
  expect(await screen.findByDisplayValue("199")).toBeInTheDocument();
  expect(screen.getByRole("button", {name: "핑크빈 +35"})).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("스탯 공격력 결과")).toHaveTextContent("30,394");
  await user.click(screen.getByRole("button", {name: "혼테일 +30"}));
  expect(screen.getByLabelText("스탯 공격력 결과")).toHaveTextContent("29,674");
  await user.clear(screen.getByLabelText("공격력 버프 직접 입력"));
  await user.type(screen.getByLabelText("공격력 버프 직접 입력"), "42");
  expect(within(screen.getByRole("group", {name: "공격력 버프 선택"})).queryAllByRole("button", {pressed: true})).toHaveLength(0);
  await user.click(screen.getByRole("button", {name: "없음 +0"}));
  expect(screen.getByLabelText("공격력 버프 직접 입력")).toHaveValue(0);
  expect(screen.getByLabelText("혼테일 예상 스탯공")).toHaveTextContent("29,674");
});
