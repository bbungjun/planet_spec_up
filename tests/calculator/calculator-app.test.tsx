import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within, waitFor } from "@testing-library/react";
import RootLayout from "@/app/layout";
import { PRODUCT_METADATA } from "@/features/site/metadata";
import Page from "@/app/page";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import type { EquipmentOcrPanelProps } from "@/features/calculator/components/EquipmentOcrPanel";
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

const mockedTooltipRecognizer = vi.hoisted(() => ({
  recognize: vi.fn(),
  terminate: vi.fn().mockResolvedValue(undefined),
}));
const mockedApplyStatReplacement = vi.hoisted(() => vi.fn());

vi.mock("@/features/calculator/ocr/recognizeTooltip.client", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/features/calculator/ocr/recognizeTooltip.client")
  >();
  return {
    ...actual,
    createBrowserTooltipRecognizer: () => mockedTooltipRecognizer,
  };
});

vi.mock("@/features/calculator/components/EquipmentOcrPanel", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/features/calculator/components/EquipmentOcrPanel")
  >();
  const ActualPanel = actual.EquipmentOcrPanel;
  return {
    ...actual,
    EquipmentOcrPanel: (props: EquipmentOcrPanelProps) => (
      <>
        <ActualPanel {...props} />
        <button
          type="button"
          onClick={() => props.onApply(
            { job: "night_lord", slot: "necklace" },
            {
              mainFlat: "999",
              subFlat: "999",
              mainPercent: "99",
              subPercent: "99",
            },
          )}
        >
          Test stale OCR job
        </button>
        <button
          type="button"
          onClick={() => props.onApply(
            { job: "corsair", slot: "top" },
            {
              mainFlat: "888",
              subFlat: "888",
              mainPercent: "88",
              subPercent: "88",
            },
          )}
        >
          Test absent OCR slot
        </button>
      </>
    ),
  };
});

vi.mock("@/features/calculator/ocr/applyStatReplacement", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/features/calculator/ocr/applyStatReplacement")
  >();
  return {
    ...actual,
    applyStatReplacement: (
      equipment: Parameters<typeof actual.applyStatReplacement>[0],
      replacement: Parameters<typeof actual.applyStatReplacement>[1],
    ) => {
      mockedApplyStatReplacement(equipment, replacement);
      return actual.applyStatReplacement(equipment, replacement);
    },
  };
});

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

function captureCalculatorInput(): Array<{ id: string; value: string }> {
  return Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      ".calculator-shell input, .calculator-shell select",
    ),
  ).map((element) => ({ id: element.id, value: element.value }));
}

describe("calculator app", () => {
  it("applies the reviewed OCR replacement only to the captured equipment card", async () => {
    const user = userEvent.setup();
    const attachedTooltipText = [
      "STR +10",
      "DEX +21",
      "HP +15",
      "DEX +9%",
      "DEX +6%",
      "DEX +6%",
    ].join("\n");
    mockedTooltipRecognizer.recognize.mockResolvedValue(attachedTooltipText);
    render(<Page />);
    await waitFor(() => expect(screen.getByLabelText("레벨")).toBeEnabled());

    await user.clear(screen.getByLabelText("레벨"));
    await user.type(screen.getByLabelText("레벨"), "180");
    await user.clear(screen.getByLabelText("타격당 평균 데미지 비율"));
    await user.type(screen.getByLabelText("타격당 평균 데미지 비율"), "420");
    await user.clear(screen.getByLabelText("펜던트 1 DEX"));
    await user.type(screen.getByLabelText("펜던트 1 DEX"), "77");
    await user.type(screen.getByLabelText("펜던트 1 STR"), "12");
    await user.type(screen.getByLabelText("펜던트 1 DEX%"), "13");
    await user.type(screen.getByLabelText("펜던트 1 STR%"), "14");
    await user.click(screen.getByRole("button", { name: "일괄 입력 보기" }));
    await user.type(screen.getByLabelText("일괄 입력 펜던트 1 공격력"), "15");
    await user.type(screen.getByLabelText("일괄 입력 펜던트 1 공격력%"), "16");
    await user.type(screen.getByLabelText("일괄 입력 한벌옷 공격력"), "123");
    await user.type(screen.getByLabelText("일괄 입력 한벌옷 공격력%"), "9");
    await user.click(screen.getByRole("button", { name: "카드 입력 보기" }));
    await user.type(screen.getByLabelText("펜던트 1 요구 STR"), "17");
    await user.click(screen.getByRole("button", { name: "한벌옷 편집" }));

    await user.clear(screen.getByLabelText("한벌옷 DEX"));
    await user.type(screen.getByLabelText("한벌옷 DEX"), "99");
    await user.clear(screen.getByLabelText("한벌옷 STR%"));
    await user.type(screen.getByLabelText("한벌옷 STR%"), "88");
    await user.clear(screen.getByLabelText("한벌옷 요구 STR"));
    await user.type(screen.getByLabelText("한벌옷 요구 STR"), "45");

    await user.upload(
      screen.getByLabelText("장비 스크린샷 파일"),
      new File(["screenshot"], "overall.png", { type: "image/png" }),
    );
    await screen.findByLabelText("인식 DEX");

    expect(screen.getByLabelText("한벌옷 DEX")).toHaveValue(99);
    expect(screen.getByLabelText("한벌옷 STR")).toHaveValue(null);
    expect(screen.getByLabelText("한벌옷 DEX%")).toHaveValue(null);
    expect(screen.getByLabelText("한벌옷 STR%"))
      .toHaveValue(88);
    expect(screen.getByLabelText("한벌옷 공격력")).toHaveValue(123);
    expect(screen.getByLabelText("한벌옷 공격력%")).toHaveValue(9);
    expect(screen.getByLabelText("한벌옷 요구 STR")).toHaveValue(45);

    await user.click(screen.getByRole("button", { name: "인식값 적용" }));

    expect(screen.getByLabelText("한벌옷 DEX")).toHaveValue(21);
    expect(screen.getByLabelText("한벌옷 STR")).toHaveValue(10);
    expect(screen.getByLabelText("한벌옷 DEX%")).toHaveValue(21);
    expect(screen.getByLabelText("한벌옷 STR%")).toHaveValue(null);
    expect(screen.getByLabelText("한벌옷 공격력")).toHaveValue(123);
    expect(screen.getByLabelText("한벌옷 공격력%")).toHaveValue(9);
    expect(screen.getByLabelText("한벌옷 요구 STR")).toHaveValue(45);
    expect(screen.getByLabelText("레벨")).toHaveValue(180);
    expect(screen.getByLabelText("타격당 평균 데미지 비율")).toHaveValue(420);

    await user.click(screen.getByRole("button", { name: "일괄 입력 보기" }));
    expect(screen.getByLabelText("일괄 입력 한벌옷 DEX")).toHaveValue(21);
    expect(screen.getByLabelText("일괄 입력 한벌옷 STR")).toHaveValue(10);
    expect(screen.getByLabelText("일괄 입력 한벌옷 DEX%")).toHaveValue(21);
    expect(screen.getByLabelText("일괄 입력 한벌옷 STR%")).toHaveValue(null);
    expect(screen.getByLabelText("일괄 입력 한벌옷 공격력")).toHaveValue(123);
    expect(screen.getByLabelText("일괄 입력 한벌옷 공격력%")).toHaveValue(9);
    expect(screen.getByLabelText("일괄 입력 펜던트 1 공격력")).toHaveValue(15);
    expect(screen.getByLabelText("일괄 입력 펜던트 1 공격력%")).toHaveValue(16);

    await user.click(screen.getByRole("button", { name: "카드 입력 보기" }));

    await user.click(screen.getByRole("button", { name: "펜던트 1 편집" }));
    expect(screen.getByLabelText("펜던트 1 DEX")).toHaveValue(77);
    expect(screen.getByLabelText("펜던트 1 STR")).toHaveValue(12);
    expect(screen.getByLabelText("펜던트 1 DEX%")).toHaveValue(13);
    expect(screen.getByLabelText("펜던트 1 STR%")).toHaveValue(14);
    expect(screen.getByLabelText("펜던트 1 공격력")).toHaveValue(15);
    expect(screen.getByLabelText("펜던트 1 공격력%")).toHaveValue(16);
    expect(screen.getByLabelText("펜던트 1 요구 STR")).toHaveValue(17);
    expect(screen.getByRole("button", { name: "펜던트 1 편집" })).toHaveClass("is-complete");
  }, 30000); // Full card → OCR → bulk flow performs dozens of user interactions.

  it("ignores a captured OCR target from a different job", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await waitFor(() => expect(screen.getByLabelText("레벨")).toBeEnabled());

    await user.clear(screen.getByLabelText("레벨"));
    await user.type(screen.getByLabelText("레벨"), "180");
    await user.type(screen.getByLabelText("펜던트 1 DEX"), "44");
    const before = captureCalculatorInput();
    const applyCallsBefore = mockedApplyStatReplacement.mock.calls.length;

    await user.click(within(screen.getByRole("region", { name: "펜던트 1 옵션" })).getByRole("button", { name: "Test stale OCR job" }));

    expect(captureCalculatorInput()).toEqual(before);
    expect(mockedApplyStatReplacement).toHaveBeenCalledTimes(applyCallsBefore);
  });

  it("ignores a captured OCR target whose slot is absent for the current job", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await waitFor(() => expect(screen.getByLabelText("레벨")).toBeEnabled());

    await user.clear(screen.getByLabelText("레벨"));
    await user.type(screen.getByLabelText("레벨"), "175");
    await user.type(screen.getByLabelText("펜던트 1 DEX"), "55");
    const before = captureCalculatorInput();
    const applyCallsBefore = mockedApplyStatReplacement.mock.calls.length;

    await user.click(within(screen.getByRole("region", { name: "펜던트 1 옵션" })).getByRole("button", { name: "Test absent OCR slot" }));

    expect(captureCalculatorInput()).toEqual(before);
    expect(mockedApplyStatReplacement).toHaveBeenCalledTimes(applyCallsBefore);
  });

  it("publishes the Korean product metadata and document language", () => {
    expect(PRODUCT_METADATA).toMatchObject({
      title: "메이플 플래닛 계산기 | 스공 비교",
      description:
        "메이플 플래닛 장비 스크린샷으로 최대 스탯공·환산공과 구매 후보의 가격 대비 효율을 비교합니다. 현재 베타는 캡틴만 지원합니다.",
    });

    const layout = RootLayout({ children: <main>계산기</main> });
    expect(layout.type).toBe("html");
    expect(layout.props.lang).toBe("ko");
    expect(JSON.stringify(PRODUCT_METADATA)).not.toContain("codex-preview");
  });

  it("uses 44px controls and tabular numerals for editable and result values", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "무기 편집" }));
    await user.type(screen.getByLabelText("무기 공격력"), "100");

    const level = screen.getByLabelText("레벨");
    const reset = screen.getByRole("button", { name: "초기화" });
    const result = screen.getByLabelText("시뮬레이션 환산 공격력 결과");

    expect(window.getComputedStyle(level).minHeight).toBe("44px");
    expect(window.getComputedStyle(reset).minHeight).toBe("44px");
    expect(window.getComputedStyle(level).fontVariantNumeric)
      .toContain("tabular-nums");
    expect(window.getComputedStyle(result).fontVariantNumeric)
      .toContain("tabular-nums");
  });

  it("opens all equipment options from the slot list without losing card values", async () => {
    const user = userEvent.setup();
    render(<Page />);
    expect(screen.queryByRole("complementary", { name: "계산 결과" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("펜던트 1 DEX"), "25");
    const allOptions = screen.getByRole("button", { name: "전체 장비 옵션" });
    expect(allOptions).toHaveAttribute("aria-pressed", "false");
    await user.click(allOptions);
    expect(allOptions).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "전체 장비 옵션" })).toBeInTheDocument();
    expect(screen.getByLabelText("일괄 입력 펜던트 1 DEX")).toHaveValue(25);
    await user.click(screen.getByRole("button", { name: "카드 입력 보기" }));
    expect(screen.getByLabelText("펜던트 1 DEX")).toHaveValue(25);
  });

  it("pairs invalid-field text with a visible icon", async () => {
    const user = userEvent.setup();
    render(<Page />);

    const field = screen.getByLabelText("펜던트 1 DEX");
    await user.type(field, "-1");

    const errorId = field.getAttribute("aria-describedby");
    expect(errorId).not.toBeNull();
    const error = document.getElementById(errorId!);
    expect(error).toHaveTextContent("Enter a value from 0 to 9999.");
    expect(error?.querySelector(".field-error-icon")).toHaveTextContent("!");
    expect(error?.querySelector(".field-error-icon"))
      .toHaveAttribute("aria-hidden", "true");
  });

  it("keeps light calculator surfaces readable with a light page foreground", () => {
    document.body.style.color = "rgb(237, 237, 237)";
    render(<Page />);

    const surfaces = [
      screen.getByRole("region", { name: "공격력 버프" }),
      screen.getByRole("button", { name: "펜던트 1 편집" }),
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
      screen.getByRole("heading", { name: "나의 장비 작업실" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "무기 편집" }));

    expect(screen.queryByLabelText("시뮬레이션 스탯 공격력 결과")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("무기 공격력"), "100");

    const statAttack = screen.getByLabelText("시뮬레이션 스탯 공격력 결과");
    const convertedAttack = screen.getByLabelText("시뮬레이션 환산 공격력 결과");
    expect(statAttack).toHaveTextContent(/^4,050$/);
    expect(convertedAttack).toHaveTextContent(/^5,062$/);
  });

  it("shows a level error and zero attacks when level zero is invalid", async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.type(screen.getByLabelText("펜던트 1 DEX"), "100");
    await user.type(screen.getByLabelText("펜던트 1 STR"), "50");
    await user.click(screen.getByRole("button", { name: "무기 편집" }));
    await user.type(screen.getByLabelText("무기 공격력"), "100");

    const statAttack = screen.getByLabelText("시뮬레이션 스탯 공격력 결과");
    const convertedAttack = screen.getByLabelText("시뮬레이션 환산 공격력 결과");
    expect(statAttack).not.toHaveTextContent(/^0$/);
    expect(convertedAttack).not.toHaveTextContent(/^0$/);

    const level = screen.getByLabelText("레벨");
    await user.clear(level);
    await user.type(level, "0");

    expect(level).toHaveAttribute("aria-invalid", "true");
    const errorId = level.getAttribute("aria-describedby");
    expect(errorId).not.toBeNull();
    expect(document.getElementById(errorId!))
      .toHaveTextContent("Enter a value from 1 to 220.");
    expect(screen.queryByLabelText("시뮬레이션 스탯 공격력 결과")).not.toBeInTheDocument();
    expect(convertedAttack).not.toBeInTheDocument();
  });

  it("offers only Captain on the public beta page", () => {
    render(<Page />);

    const job = screen.getByLabelText("직업");
    expect(within(job).getAllByRole("option")).toHaveLength(1);
    expect(job).toHaveTextContent("캡틴");
    expect(job).toBeDisabled();
    expect(screen.getByText("BETA", { exact: true })).toBeVisible();
    expect(screen.queryByText("캡틴 전용 베타")).not.toBeInTheDocument();
  });

  it("exposes every character setting and keeps level editable from 1 to 220", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<CalculatorApp />);
    await waitFor(() => expect(screen.getByLabelText("레벨")).toBeEnabled());

    const level = screen.getByLabelText("레벨");
    expect(level).toHaveAttribute("min", "1");
    expect(level).toHaveAttribute("max", "220");
    await user.clear(level);
    await user.type(level, "70");
    expect(level).toHaveValue(70);
    expect(screen.getByLabelText("순수 STR")).toHaveAttribute(
      "max",
      "367",
    );

    [
      "메이플 용사",
      "타격당 평균 데미지 비율",
      "샤프 아이즈",
      "몬스터 방어율",
      "기타 보스공격력%",
      "기타 총데미지%",
      "방어율 무시",
      "추가 크리티컬 확률",
      "순수 DEX",
      "순수 STR",
      "길드 보스 공격력 (%)",
      "길드 방어율 무시 (%)",
      "길드 공격력",
      "길드 액티브 보스 스킬 적용 (+10%)",
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
      "펜던트 1",
      "펜던트 2",
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
      "한벌옷",
    ].forEach((slot) => {
      expect(
        screen.getByRole("button", { name: `${slot} 편집` }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "상의 편집" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "표창·불릿 편집" })).not.toBeInTheDocument();
    for (const source of ["정령의 축복", "여제의 축복", "버프"]) {
      expect(screen.queryByRole("button", { name: `${source} 편집` })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "하의 편집" })).not.toBeInTheDocument();
  });

  it("asks before changing jobs when equipment contains a value", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<CalculatorApp />);

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

    await user.type(screen.getByLabelText("펜던트 1 DEX"), "22");
    await user.click(screen.getByRole("button", { name: "초기화" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("펜던트 1 DEX")).toHaveValue(22);

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "초기화" }));

    expect(screen.getByLabelText("펜던트 1 DEX")).toHaveValue(null);
  });

  it("shows text and styling when an equipment slot is complete", async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.type(screen.getByLabelText("펜던트 1 DEX"), "22");

    const necklace = screen.getByRole("button", { name: "펜던트 1 편집" });
    expect(necklace).toHaveClass("is-complete");
    expect(within(necklace).queryByText("착용 조건 확인 필요")).not.toBeInTheDocument();
    expect(within(necklace).getByText("✓ 입력 완료")).toBeVisible();
    await user.type(screen.getByLabelText("펜던트 1 요구 레벨"), "0");
    await user.type(screen.getByLabelText("펜던트 1 요구 STR"), "0");
    expect(within(necklace).getByText("✓ 입력 완료")).toBeVisible();
  });

  it("shows the effective boss and total damage factor used by the formula", async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.click(screen.getByRole("button", { name: "무기 편집" }));
    await user.type(screen.getByLabelText("무기 공격력"), "100");

    await user.type(screen.getByLabelText("기타 보스공격력%"), "20");
    await user.clear(screen.getByLabelText("길드 보스 공격력 (%)"));
    await user.type(screen.getByLabelText("길드 보스 공격력 (%)"), "3");
    await user.click(screen.getByLabelText("길드 액티브 보스 스킬 적용 (+10%)"));

    const results = screen.getByRole("region", { name: "적용 후 스탯창" });
    const label = within(results).getByText("보공·총뎀 적용값");
    const evidenceRow = label.closest("div");
    expect(evidenceRow).not.toBeNull();
    expect(within(evidenceRow!).getByText("33%")).toBeInTheDocument();
  });

  it("preserves meaningful decimals in the boss and total damage evidence", async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.click(screen.getByRole("button", { name: "무기 편집" }));
    await user.type(screen.getByLabelText("무기 공격력"), "100");

    await user.type(screen.getByLabelText("기타 보스공격력%"), "20.5");
    await user.clear(screen.getByLabelText("길드 보스 공격력 (%)"));
    await user.type(screen.getByLabelText("길드 보스 공격력 (%)"), "3");
    await user.click(screen.getByLabelText("길드 액티브 보스 스킬 적용 (+10%)"));

    const results = screen.getByRole("region", { name: "적용 후 스탯창" });
    const label = within(results).getByText("보공·총뎀 적용값");
    const evidenceRow = label.closest("div");
    expect(evidenceRow).not.toBeNull();
    expect(within(evidenceRow!).getByText("33.5%")).toBeInTheDocument();
    expect(within(evidenceRow!).queryByText("34%")).not.toBeInTheDocument();
  });

  it("renders formula inputs and navigates an issue to its equipment card", async () => {
    const user = userEvent.setup();
    render(<Page />);

    expect(screen.getByText("비교 계산 기준")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "확인할 항목" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "모자 편집" }));
    await user.type(screen.getByLabelText("모자 DEX"), "-1");
    await user.click(screen.getByRole("button", { name: "펜던트 1 편집" }));
    await user.click(
      screen.getByRole("button", { name: /Enter a value from 0 to 9999/ }),
    );

    expect(screen.getByRole("heading", { name: "모자 옵션" })).toBeInTheDocument();
    expect(screen.getByLabelText("모자 DEX")).toHaveValue(-1);
    expect(screen.getByLabelText("모자 DEX")).toHaveAttribute("aria-invalid", "true");
  });
});
