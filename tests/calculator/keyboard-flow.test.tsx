import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import Page from "@/app/page";

beforeEach(() => {
  window.localStorage.clear();
});

it("moves through visible fields and equipment slots in deterministic order", async () => {
  const user = userEvent.setup();
  render(<Page />);

  await user.click(screen.getByRole("button", { name: "목걸이 편집" }));
  const main = screen.getByLabelText("목걸이 DEX");
  main.focus();

  expect(fireEvent.keyDown(main, { key: "ArrowDown" })).toBe(true);
  expect(main).toHaveFocus();

  await user.keyboard("{Enter}");
  expect(screen.getByLabelText("목걸이 STR")).toHaveFocus();

  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(screen.getByRole("heading", { name: "망토 옵션" })).toBeInTheDocument();
  expect(screen.getByLabelText("망토 DEX")).toHaveFocus();
});

it("moves from the penultimate slot to the final slot before wrapping", async () => {
  const user = userEvent.setup();
  render(<Page />);

  await user.click(screen.getByRole("button", { name: "버프 편집" }));
  screen.getByLabelText("버프 DEX").focus();

  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(screen.getByRole("heading", { name: "한벌옷 옵션" })).toBeInTheDocument();
  expect(screen.getByLabelText("한벌옷 DEX")).toHaveFocus();

  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(screen.getByRole("heading", { name: "목걸이 옵션" })).toBeInTheDocument();
  expect(screen.getByLabelText("목걸이 DEX")).toHaveFocus();
});

it("opens the referenced card and focuses its invalid field from bulk mode", async () => {
  const user = userEvent.setup();
  render(<Page />);

  await user.click(screen.getByRole("button", { name: "무기 편집" }));
  const cardAttack = screen.getByLabelText("무기 공격력");
  await user.type(cardAttack, "100");
  expect(screen.getByLabelText("스탯 공격력 결과")).not.toHaveTextContent(/^0$/);

  await user.click(screen.getByRole("button", { name: "일괄 입력 보기" }));
  const bulkAttack = screen.getByLabelText("일괄 입력 무기 공격력");
  await user.clear(bulkAttack);
  await user.type(bulkAttack, "-1");
  expect((bulkAttack as HTMLInputElement).value).toBe("-1");
  expect(screen.getByLabelText("스탯 공격력 결과")).toHaveTextContent(/^0$/);
  await user.click(screen.getByRole("button", {
    name: "오류 Enter a value from 0 to 9999.",
  }));

  expect(screen.getByRole("button", { name: "일괄 입력 보기" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "무기 옵션" })).toBeInTheDocument();
  const focusedAttack = screen.getByLabelText("무기 공격력");
  expect(focusedAttack).toHaveValue(-1);
  expect(focusedAttack).toHaveAttribute("aria-invalid", "true");
  expect(focusedAttack).toHaveFocus();
});
