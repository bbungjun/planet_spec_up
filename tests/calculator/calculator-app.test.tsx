import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import Page from "@/app/page";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

let stylesheet: HTMLStyleElement;
const calculatorStyles = readFileSync(
  resolve(process.cwd(), "app/globals.css"),
  "utf8",
);

beforeAll(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = calculatorStyles
    .replace(/^@import\s+[^;]+;\s*/m, "")
    .replace(/@theme\s+inline\s*\{[^}]*\}\s*/m, "");
  document.head.append(stylesheet);
});

afterAll(() => {
  stylesheet.remove();
});

function relativeLuminance(color: string): number {
  const variable = color.match(/^var\((--[^,)]+)(?:,[^)]+)?\)$/);
  const resolvedColor = variable === null
    ? color
    : window.getComputedStyle(document.documentElement)
      .getPropertyValue(variable[1])
      .trim();
  const hex = resolvedColor.match(/^#([0-9a-f]{6})$/i)?.[1];
  const channels = hex === undefined
    ? resolvedColor.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number)
    : [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  if (channels === undefined || channels.length !== 3) {
    throw new Error(`Unsupported computed color: ${resolvedColor || color}`);
  }

  const [red, green, blue] = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(element: Element): number {
  const style = window.getComputedStyle(element);
  const foreground = relativeLuminance(style.color);
  const background = relativeLuminance(
    style.backgroundColor === "rgba(0, 0, 0, 0)" && style.background.startsWith("var(")
      ? style.background
      : style.backgroundColor,
  );
  const lighter = Math.max(foreground, background);
  const darker = Math.min(foreground, background);
  return (lighter + 0.05) / (darker + 0.05);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.style.removeProperty("color");
});

describe("calculator app", () => {
  it("keeps light calculator surfaces readable with a light page foreground", () => {
    document.body.style.color = "rgb(237, 237, 237)";
    render(<Page />);

    const surfaces = [
      screen.getByRole("complementary", { name: "계산 결과" }),
      screen.getByRole("button", { name: "목걸이 편집" }),
      screen.getByRole("button", { name: "초기화" }),
    ];
    surfaces.forEach((surface) => {
      const name = surface.getAttribute("aria-label") ?? surface.textContent;
      const style = window.getComputedStyle(surface);
      expect(
        contrastRatio(surface),
        `${name ?? "surface"}: ${style.color} on ${style.backgroundColor}; background=${style.background}`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  });

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

  it("shows the effective boss and total damage factor used by the formula", async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.type(screen.getByLabelText("보스 공격력 및 총데미지"), "20");
    await user.selectOptions(
      screen.getByLabelText("길드 보스 데미지 스킬 레벨"),
      "3",
    );
    await user.click(screen.getByLabelText("길드 액티브 보스 스킬 적용"));

    const results = screen.getByRole("complementary", { name: "계산 결과" });
    const label = within(results).getByText("보공·총뎀 적용값");
    const evidenceRow = label.closest("div");
    expect(evidenceRow).not.toBeNull();
    expect(within(evidenceRow!).getByText("33%")).toBeInTheDocument();
  });

  it("preserves meaningful decimals in the boss and total damage evidence", async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.type(screen.getByLabelText("보스 공격력 및 총데미지"), "20.5");
    await user.selectOptions(
      screen.getByLabelText("길드 보스 데미지 스킬 레벨"),
      "3",
    );
    await user.click(screen.getByLabelText("길드 액티브 보스 스킬 적용"));

    const results = screen.getByRole("complementary", { name: "계산 결과" });
    const label = within(results).getByText("보공·총뎀 적용값");
    const evidenceRow = label.closest("div");
    expect(evidenceRow).not.toBeNull();
    expect(within(evidenceRow!).getByText("33.5%")).toBeInTheDocument();
    expect(within(evidenceRow!).queryByText("34%")).not.toBeInTheDocument();
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
