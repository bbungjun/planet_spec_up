import {
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import Page from "@/app/page";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { deserializeSetup, STORAGE_KEY } from "@/features/calculator/storage";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("shares raw string values between card and bulk modes in both directions", async () => {
  const user = userEvent.setup();
  render(<Page />);

  await user.click(screen.getByRole("button", { name: "장갑 편집" }));
  const cardAttackPercent = screen.getByLabelText("장갑 공격력%") as HTMLInputElement;
  await user.type(cardAttackPercent, "22.5");
  expect(cardAttackPercent.value).toBe("22.5");

  await user.click(screen.getByRole("button", { name: "일괄 입력 보기" }));
  const bulkAttackPercent = screen.getByLabelText(
    "일괄 입력 장갑 공격력%",
  ) as HTMLInputElement;
  expect(bulkAttackPercent.value).toBe("22.5");

  await user.clear(bulkAttackPercent);
  await user.type(bulkAttackPercent, "31.25");
  await user.click(screen.getByRole("button", { name: "카드 입력 보기" }));

  expect((screen.getByLabelText("장갑 공격력%") as HTMLInputElement).value)
    .toBe("31.25");
});

it("renders only the current job slots and stat columns", async () => {
  const user = userEvent.setup();
  render(<Page />);

  await user.click(screen.getByRole("button", { name: "일괄 입력 보기" }));
  expect(screen.getByLabelText("일괄 입력 한벌옷 DEX")).toBeInTheDocument();
  expect(screen.queryByLabelText("일괄 입력 상의 DEX")).not.toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("직업"), "marksman");
  expect(screen.getByLabelText("일괄 입력 상의 DEX")).toBeInTheDocument();
  expect(screen.getByLabelText("일괄 입력 하의 STR")).toBeInTheDocument();
  expect(screen.queryByLabelText("일괄 입력 한벌옷 DEX")).not.toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("직업"), "night_lord");
  expect(screen.getByLabelText("일괄 입력 펜던트 1 LUK")).toBeInTheDocument();
  expect(screen.getByLabelText("일괄 입력 펜던트 1 DEX")).toBeInTheDocument();
  expect(screen.queryByLabelText("일괄 입력 펜던트 1 STR")).not.toBeInTheDocument();
});

it("overwrites one saved slot, loads it, and restores it on a fresh mount", async () => {
  const savedAt = "2026-07-27T12:34:56.789Z";
  vi.spyOn(Date.prototype, "toISOString").mockReturnValue(savedAt);
  const user = userEvent.setup();
  const firstRender = render(<Page />);
  const necklace = screen.getByLabelText("펜던트 1 DEX");

  await user.type(necklace, "11");
  await user.click(screen.getByRole("button", { name: "저장" }));
  expect(screen.getByRole("status", { name: "저장 상태" }).querySelector("time")).toHaveAttribute("datetime", savedAt);

  await user.clear(necklace);
  await user.type(necklace, "22");
  await user.click(screen.getByRole("button", { name: "저장" }));

  expect(window.localStorage).toHaveLength(1);
  const raw = window.localStorage.getItem(STORAGE_KEY);
  expect(raw).not.toBeNull();
  expect(deserializeSetup(raw!)).toMatchObject({
    ok: true,
    value: {
      savedAt,
      input: { equipment: { necklace: { mainFlat: "22" } } },
    },
  });

  await user.clear(necklace);
  await user.type(necklace, "33");
  await user.click(screen.getByRole("button", { name: "불러오기" }));
  expect(screen.getByLabelText("펜던트 1 DEX")).toHaveValue(22);

  firstRender.unmount();
  render(<Page />);
  await waitFor(() => {
    expect(screen.getByLabelText("펜던트 1 DEX")).toHaveValue(22);
  });
  expect(screen.getByRole("status", { name: "저장 상태" }).querySelector("time")).toHaveAttribute("datetime", savedAt);
});

it("reports corrupt storage once without changing the current input", async () => {
  const user = userEvent.setup();
  render(<Page />);
  const necklace = screen.getByLabelText("펜던트 1 DEX");
  await user.type(necklace, "44");
  window.localStorage.setItem(STORAGE_KEY, "{bad");

  await user.click(screen.getByRole("button", { name: "불러오기" }));

  expect(necklace).toHaveValue(44);
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.getByRole("alert")).toHaveTextContent("불러올 수 없습니다");

  await user.type(necklace, "5");
  expect(necklace).toHaveValue(445);
});

it("rejects an incomplete saved setup without replacing the Page state", async () => {
  const user = userEvent.setup();
  render(<Page />);
  await user.type(screen.getByLabelText("펜던트 1 DEX"), "44");
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    schemaVersion: 1,
    savedAt: "2026-07-27T00:00:00.000Z",
    input: {
      ...createDefaultInput("corsair"),
      equipment: {},
    },
  }));

  await user.click(screen.getByRole("button", { name: "불러오기" }));

  expect(screen.getByLabelText("펜던트 1 DEX")).toHaveValue(44);
  expect(screen.getByRole("alert")).toHaveTextContent("불러올 수 없습니다");
});

it("requires confirmation before reset and clears the persisted slot only when confirmed", async () => {
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<Page />);
  const necklace = screen.getByLabelText("펜던트 1 DEX");
  await user.type(necklace, "22");
  await user.click(screen.getByRole("button", { name: "저장" }));

  await user.click(screen.getByRole("button", { name: "초기화" }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(necklace).toHaveValue(22);
  expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

  confirm.mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "초기화" }));
  expect(necklace).toHaveValue(null);
  expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
});
