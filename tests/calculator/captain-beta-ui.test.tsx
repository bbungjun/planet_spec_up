import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import Page from "@/app/page";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { CAPTAIN_BETA_STORAGE_KEY, STORAGE_KEY, serializeSetup } from "@/features/calculator/storage";

beforeEach(() => localStorage.clear());

it("keeps another job's save untouched while using and reloading the captain beta", async () => {
  const legacy = serializeSetup(createDefaultInput("night_lord")); localStorage.setItem(STORAGE_KEY, legacy);
  const user = userEvent.setup(); const view = render(<Page />);
  await waitFor(() => expect(screen.getByLabelText("레벨")).toBeEnabled());
  expect(screen.getByText("BETA", { exact: true })).toBeVisible();
  expect(screen.queryByText("캡틴 전용 베타")).not.toBeInTheDocument();
  expect(screen.getByLabelText("직업")).toHaveValue("corsair");
  expect(screen.getByLabelText("직업")).toBeDisabled();
  expect(within(screen.getByLabelText("직업")).getAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("alert")).toHaveTextContent("기존 다른 직업의 저장값은 보존");
  await user.click(screen.getByRole("button", { name: "불러오기" }));
  expect(screen.getByLabelText("직업")).toHaveValue("corsair");
  fireEvent.change(screen.getByLabelText("레벨"), { target: { value: "180" } });
  await user.click(screen.getByRole("button", { name: "저장" }));
  expect(localStorage.getItem(STORAGE_KEY)).toBe(legacy);
  expect(JSON.parse(localStorage.getItem(CAPTAIN_BETA_STORAGE_KEY)!).input.character.job).toBe("corsair");
  view.unmount(); render(<Page />);
  await waitFor(() => expect(screen.getByLabelText("레벨")).toHaveValue(180));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("withholds invalid critical results, blocks saving and recovers after correction", async () => {
  const input = createDefaultInput("corsair");
  Object.assign(input.character, { pureMain: "800", pureSub: "4", sharpEyes: "sharp_30", criticalRate: "100" });
  input.equipment.weapon!.attackFlat = "100";
  const original = serializeSetup(input); localStorage.setItem(STORAGE_KEY, original);
  const user = userEvent.setup(); render(<Page />);
  await waitFor(() => expect(screen.getByLabelText("장비 외 추가 크리티컬 확률")).toHaveValue(100));
  expect(screen.queryByRole("region", {name:"적용 후 스탯창"})).not.toBeInTheDocument();
  expect(screen.getByRole("region", {name:"확인할 항목"})).toHaveTextContent("100% 이하");
  expect(screen.getByLabelText("장비 외 추가 크리티컬 확률")).toHaveAttribute("aria-invalid", "true");
  await user.click(screen.getByRole("button", { name: "저장" }));
  expect(localStorage.getItem(CAPTAIN_BETA_STORAGE_KEY)).toBeNull();
  expect(screen.getByLabelText("장비 외 추가 크리티컬 확률")).toHaveFocus();
  fireEvent.change(screen.getByLabelText("장비 외 추가 크리티컬 확률"), { target: { value: "85" } });
  expect(screen.getByLabelText("장비 외 추가 크리티컬 확률")).not.toHaveAttribute("aria-invalid", "true");
  await user.click(screen.getByRole("button", { name: "저장" }));
  expect(JSON.parse(localStorage.getItem(CAPTAIN_BETA_STORAGE_KEY)!).input.character.criticalRate).toBe("85");
  expect(localStorage.getItem(STORAGE_KEY)).toBe(original);
  const sheet = screen.getByRole("region", {name:"적용 후 스탯창"});
  expect(within(sheet).getByText("100%")).toBeVisible();
  expect(within(sheet).queryByText(/입력 확인 필요/)).not.toBeInTheDocument();
});
