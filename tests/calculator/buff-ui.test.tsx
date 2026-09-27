import { beforeEach, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { serializeSetup, STORAGE_KEY } from "@/features/calculator/storage";

beforeEach(() => localStorage.clear());

it("applies the result-panel preview to the main result and all presets without stacking", async () => {
  const input = createDefaultInput("corsair");
  Object.assign(input.character, { guildBossPercent: "0", guildIgnorePercent: "0", guildAttackFlat: "0" });
  Object.assign(input.equipment.necklace!, { mainFlat: "251", subFlat: "115", mainPercent: "215", subPercent: "24" });
  Object.assign(input.equipment.weapon!, { attackFlat: "127", bossDamagePercent: "60" });
  input.weaponPresets = { active: "boss", entries: {
    boss: { weapon: { ...input.equipment.weapon! }, monsterDefense: "0" },
    chaos: { weapon: { ...input.equipment.weapon! }, monsterDefense: "0" },
    hunting: { weapon: { ...input.equipment.weapon! }, monsterDefense: "0" },
  } };
  const original = serializeSetup(input);
  localStorage.setItem(STORAGE_KEY, original);
  const user = userEvent.setup();
  const view = render(<CalculatorApp />);
  expect(await screen.findByDisplayValue("251")).toBeInTheDocument();
  expect(screen.getByLabelText("스탯 공격력 결과")).toHaveTextContent("15,950");
  expect(screen.getByLabelText("현재 적용 버프")).toHaveTextContent("공격력 버프 없음");

  const selectPinkBean = screen.getByRole("button", { name: "핑크빈 버프 적용" });
  await user.click(selectPinkBean);
  await user.click(selectPinkBean);
  expect(screen.getByLabelText("스탯 공격력 결과")).toHaveTextContent("20,346");
  expect(screen.getByLabelText("환산 공격력 결과")).toHaveTextContent("32,553");
  expect(screen.getByLabelText("현재 적용 버프")).toHaveTextContent("핑크빈 +35 적용");
  expect(selectPinkBean).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "핑크빈 +35" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("공격력 버프 직접 입력")).toHaveValue(35);
  for (const card of view.container.querySelectorAll<HTMLElement>(".weapon-preset-card")) {
    expect(within(card).getByText("최대 스탯공").nextElementSibling).toHaveTextContent("20,346");
  }
  expect(localStorage.getItem(STORAGE_KEY)).toBe(original);

  await user.click(screen.getByRole("button", { name: "사냥용 프리셋 선택" }));
  expect(screen.getByLabelText("스탯 공격력 결과")).toHaveTextContent("20,346");
  expect(screen.getByLabelText("환산 공격력 결과")).toHaveTextContent("20,346");
  await user.click(screen.getByRole("button", { name: /^저장$/ }));
  view.unmount();
  render(<CalculatorApp />);
  expect(await screen.findByDisplayValue("35")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "핑크빈 버프 적용" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("스탯 공격력 결과")).toHaveTextContent("20,346");

  await user.click(screen.getByRole("button", { name: "혼테일 +30" }));
  expect(screen.getByRole("button", { name: "혼테일 버프 적용" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("스탯 공격력 결과")).toHaveTextContent("19,718");
  await user.click(screen.getByRole("button", { name: "없음 버프 적용" }));
  expect(screen.getByLabelText("스탯 공격력 결과")).toHaveTextContent("15,950");
  expect(screen.getByLabelText("공격력 버프 직접 입력")).toHaveValue(0);
});

it("switches cider exclusively while stacking, removing, and restoring sprinkling and rage", async () => {
  const input = createDefaultInput("corsair");
  input.equipment.weapon!.attackFlat = "100";
  localStorage.setItem(STORAGE_KEY, serializeSetup(input));
  const user = userEvent.setup();
  const view = render(<CalculatorApp />);
  const panel = await screen.findByRole("region", { name: "공격력 버프" });
  const buffInput = screen.getByLabelText("공격력 버프 직접 입력");
  await user.click(within(panel).getByRole("button", { name: "사이다 +10" }));
  await user.click(within(panel).getByRole("button", { name: "뿌리기 +20" }));
  await user.click(within(panel).getByRole("button", { name: "분노 +12" }));
  expect(buffInput).toHaveValue(10);
  expect(screen.getByLabelText("현재 적용 버프")).toHaveTextContent("사이다 +10 · 뿌리기 +20 · 분노 +12 적용");
  const ciderAttack = screen.getByLabelText("사이다 예상 스탯공").textContent;
  expect(screen.getByLabelText("스탯 공격력 결과")).toHaveTextContent(ciderAttack!);
  await user.click(screen.getByRole("button", { name: "핑크빈 버프 적용" }));
  expect(buffInput).toHaveValue(35);
  expect(within(panel).getByRole("button", { name: "사이다 +10" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByLabelText("현재 적용 버프")).toHaveTextContent("핑크빈 +35 · 뿌리기 +20 · 분노 +12 적용");
  await user.click(within(panel).getByRole("button", { name: "혼테일 +30" }));
  expect(buffInput).toHaveValue(30);
  await user.click(screen.getByRole("button", { name: "사이다 버프 적용" }));
  expect(screen.getByLabelText("스탯 공격력 결과")).toHaveTextContent(ciderAttack!);
  await user.click(within(panel).getByRole("button", { name: "요괴대사 +40" }));
  expect(buffInput).toHaveValue(40);
  expect(screen.getByLabelText("현재 적용 버프")).toHaveTextContent("요괴대사 +40 · 뿌리기 +20 · 분노 +12 적용");
  const yokaiAttack = screen.getByLabelText("요괴대사 예상 스탯공").textContent;
  expect(screen.getByLabelText("스탯 공격력 결과")).toHaveTextContent(yokaiAttack!);
  expect(screen.getByRole("button", { name: "요괴대사 버프 적용" })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: /^저장$/ }));
  view.unmount();
  render(<CalculatorApp />);
  expect(await screen.findByRole("button", { name: "뿌리기 +20", pressed: true })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "분노 +12" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("스탯 공격력 결과")).toHaveTextContent(yokaiAttack!);
  expect(screen.getByRole("button", { name: "요괴대사 +40" })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "없음 +0" }));
  expect(screen.getByLabelText("현재 적용 버프")).toHaveTextContent("뿌리기 +20 · 분노 +12 적용");
  await user.click(screen.getByRole("button", { name: "뿌리기 +20" }));
  expect(screen.getByLabelText("현재 적용 버프")).toHaveTextContent("분노 +12 적용");
  await user.click(screen.getByRole("button", { name: "분노 +12" }));
  expect(screen.getByLabelText("현재 적용 버프")).toHaveTextContent("공격력 버프 없음");
});

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
