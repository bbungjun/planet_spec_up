import { render, screen, within } from "@testing-library/react";
import Page from "@/app/page";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("calculator app", () => {
  it("updates live results when a card equipment value changes", async () => {
    const user = userEvent.setup();
    render(<Page />);

    expect(
      screen.getByRole("heading", { name: "플래닛 데미지 계산기" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "무기 편집" }));

    const statAttack = screen.getByLabelText("스탯 공격력 결과");
    const convertedAttack = screen.getByLabelText("환산 공격력 결과");
    expect(statAttack).toHaveTextContent(/^0$/);
    expect(convertedAttack).toHaveTextContent(/^0$/);

    await user.type(screen.getByLabelText("무기 공격력"), "100");

    expect(statAttack).not.toHaveTextContent(/^0$/);
    expect(convertedAttack).not.toHaveTextContent(/^0$/);
  });

  it("offers only the three MVP jobs", () => {
    render(<Page />);

    const job = screen.getByLabelText("직업");
    expect(within(job).getAllByRole("option")).toHaveLength(3);
    expect(job).toHaveTextContent("신궁");
    expect(job).toHaveTextContent("캡틴");
    expect(job).toHaveTextContent("나이트로드");
  });

  it("exposes every character setting and keeps level editable from 1 to 200", async () => {
    const user = userEvent.setup();
    render(<Page />);

    const level = screen.getByLabelText("레벨");
    expect(level).toHaveAttribute("min", "1");
    expect(level).toHaveAttribute("max", "200");
    await user.clear(level);
    await user.type(level, "70");
    expect(level).toHaveValue(70);
    expect(screen.getByLabelText("순수 부스탯 수동값")).toHaveAttribute(
      "max",
      "367",
    );

    [
      "메이플 용사",
      "타격당 평균 데미지 비율",
      "샤프 아이즈",
      "몬스터 방어율",
      "보스 공격력 및 총데미지",
      "방어율 무시",
      "추가 크리티컬 확률",
      "순수 부스탯 수동값",
      "길드 보스 데미지 스킬 레벨",
      "길드 방어율 무시 스킬 레벨",
      "길드 공격력 스킬 레벨",
      "길드 액티브 보스 스킬 적용",
    ].forEach((label) => {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("나이트로드 스탯창 STR")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("직업"), "night_lord");

    expect(screen.getByLabelText("나이트로드 스탯창 STR")).toBeInTheDocument();
    expect(screen.getByLabelText("타격당 평균 데미지 비율")).toHaveValue(150);
  });

  it("renders every Corsair equipment slot as an accessible edit button", () => {
    render(<Page />);

    [
      "목걸이",
      "망토",
      "귀고리",
      "눈장식",
      "얼굴장식",
      "모자",
      "신발",
      "장갑",
      "무기",
      "훈장",
      "반지 1",
      "반지 2",
      "반지 3",
      "반지 4",
      "표창·불릿",
      "축복 1",
      "축복 2",
      "버프",
      "한벌옷",
    ].forEach((slot) => {
      expect(
        screen.getByRole("button", { name: `${slot} 편집` }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "상의 편집" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "하의 편집" })).not.toBeInTheDocument();
  });

  it("asks before changing jobs when equipment contains a value", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page />);

    await user.click(screen.getByRole("button", { name: "무기 편집" }));
    await user.type(screen.getByLabelText("무기 공격력"), "100");
    await user.selectOptions(screen.getByLabelText("직업"), "marksman");

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("직업")).toHaveValue("corsair");
    expect(screen.getByLabelText("무기 공격력")).toHaveValue(100);

    confirm.mockReturnValue(true);
    await user.selectOptions(screen.getByLabelText("직업"), "night_lord");
    await user.click(screen.getByRole("button", { name: "무기 편집" }));

    expect(screen.getByLabelText("직업")).toHaveValue("night_lord");
    expect(screen.getByLabelText("무기 공격력")).toHaveValue(null);
  });

  it("asks before resetting when equipment contains a value", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page />);

    await user.type(screen.getByLabelText("목걸이 DEX"), "22");
    await user.click(screen.getByRole("button", { name: "초기화" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("목걸이 DEX")).toHaveValue(22);

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "초기화" }));

    expect(screen.getByLabelText("목걸이 DEX")).toHaveValue(null);
  });

  it("shows text and styling when an equipment slot is complete", async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.type(screen.getByLabelText("목걸이 DEX"), "22");

    const necklace = screen.getByRole("button", { name: "목걸이 편집" });
    expect(necklace).toHaveClass("is-complete");
    expect(within(necklace).getByText("✓ 입력 완료")).toBeVisible();
  });

  it("renders formula inputs and navigates an issue to its equipment card", async () => {
    const user = userEvent.setup();
    render(<Page />);

    const results = screen.getByRole("complementary", { name: "계산 결과" });
    expect(within(results).getByText("계산 근거")).toBeInTheDocument();
    [
      "최종 주스탯",
      "최종 부스탯",
      "최종 공격력",
      "순수 주스탯",
      "순수 부스탯",
      "방어율 배율",
      "크리 배율",
    ].forEach((label) => {
      expect(within(results).getByText(label)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "모자 편집" }));
    await user.type(screen.getByLabelText("모자 DEX"), "-1");
    await user.click(screen.getByRole("button", { name: "목걸이 편집" }));
    await user.click(
      screen.getByRole("button", { name: /Enter a value from 0 to 9999/ }),
    );

    expect(screen.getByRole("heading", { name: "모자 옵션" })).toBeInTheDocument();
    expect(screen.getByLabelText("모자 DEX")).toHaveValue(-1);
    expect(screen.getByLabelText("모자 DEX")).toHaveAttribute("aria-invalid", "true");
  });
});
