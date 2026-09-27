import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { STORAGE_KEY, serializeSetup } from "@/features/calculator/storage";
import * as recognition from "@/features/calculator/ocr/recognizeTooltip.client";

const recognize = vi.fn<recognition.TooltipRecognizer["recognize"]>();
const photo = (name: string) => new File([name], `${name}.png`, { type: "image/png" });
const tooltip = (name: string) => `${name}\n(유니크 아이템)\n장비분류: 펜던트\nREQ LEV: 0\nREQ STR: 0\nDEX +20\n공격력 +3`;
beforeEach(() => {
  localStorage.clear(); recognize.mockReset();
  vi.spyOn(recognition, "createBrowserTooltipRecognizer").mockImplementation(() => ({ recognize, terminate: vi.fn().mockResolvedValue(undefined) }));
});

it("shares pendant identity with bulk input, shows duplicate warnings, and restores both identities", async () => {
  const user = userEvent.setup();
  const view = render(<CalculatorApp />);
  await waitFor(() => expect(screen.getByLabelText("펜던트 1 종류")).toBeEnabled());
  await user.selectOptions(screen.getByLabelText("펜던트 1 종류"), "horntail");
  await user.click(screen.getByRole("button", { name: "펜던트 2 편집" }));
  await user.selectOptions(screen.getByLabelText("펜던트 2 종류"), "horntail");
  expect(screen.getAllByText(/혼테일의 목걸이 중복 착용 불가/).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "펜던트 2 편집" })).toHaveTextContent("착용 불가");
  await user.click(screen.getByRole("button", { name: "일괄 입력 보기" }));
  await user.selectOptions(screen.getByLabelText("일괄 입력 펜던트 2 종류"), "chaos_horntail");
  expect(screen.queryByText(/중복 착용 불가/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "저장" }));
  view.unmount(); render(<CalculatorApp />);
  await waitFor(() => expect(screen.getByLabelText("펜던트 1 종류")).toHaveValue("horntail"));
  await user.click(screen.getByRole("button", { name: "펜던트 2 편집" }));
  expect(screen.getByLabelText("펜던트 2 종류")).toHaveValue("chaos_horntail");
  await user.type(screen.getByLabelText("새 장비 부위"), "목걸이");
  await user.click(screen.getByRole("button", { name: "장비 추가" }));
  expect(screen.getByRole("alert")).toHaveTextContent("펜던트는 최대 2개");
});

it("assigns different pendant kinds in selection order and asks where to put a third photo", async () => {
  recognize.mockResolvedValueOnce(tooltip("혼테일의 목걸이")).mockResolvedValueOnce(tooltip("카오스 혼테일의 목걸이")).mockResolvedValueOnce(tooltip("요괴 대사의 염주"));
  const user = userEvent.setup(); render(<CalculatorApp />);
  await waitFor(() => expect(screen.getByLabelText("장비 스크린샷 파일")).toBeEnabled());
  await user.upload(screen.getByLabelText("장비 스크린샷 파일"), [photo("first"), photo("second"), photo("third")]);
  await screen.findByText("3/3장 인식 완료");
  expect(screen.getByLabelText("1번 적용 위치")).toHaveValue("necklace");
  expect(screen.getByLabelText("2번 적용 위치")).toHaveValue("pendant_2");
  expect(screen.getByLabelText("1번 펜던트 종류")).toHaveValue("horntail");
  expect(screen.getByLabelText("2번 펜던트 종류")).toHaveValue("chaos_horntail");
  expect(screen.getByLabelText("3번 적용 위치")).toHaveValue("");
  expect(within(screen.getByLabelText("3번 적용 위치")).queryByRole("option", { name: "새 장비 부위로 추가" })).not.toBeInTheDocument();
  await user.click(screen.getByLabelText("3번 적용에 포함"));
  await user.click(screen.getByRole("button", { name: "검토한 2개 장비 적용" }));
  expect(screen.getByLabelText("펜던트 1 종류")).toHaveValue("horntail");
  await user.click(screen.getByRole("button", { name: "펜던트 2 편집" }));
  expect(screen.getByLabelText("펜던트 2 종류")).toHaveValue("chaos_horntail");
  expect(screen.getByLabelText("펜던트 2 DEX")).toHaveValue(20);
});

it("requires a pendant destination for single OCR and applies the reviewed kind to that card", async () => {
  recognize.mockResolvedValue(tooltip("고든의 마법 인두"));
  const user = userEvent.setup(); render(<CalculatorApp />);
  await waitFor(() => expect(screen.getByLabelText("장비 스크린샷 파일")).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "망토 편집" }));
  await user.upload(screen.getByLabelText("장비 스크린샷 파일"), photo("gordon"));
  await screen.findByLabelText("OCR 펜던트 종류");
  expect(screen.getByRole("button", { name: "인식값 적용" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "펜던트 새 장비로 추가" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "펜던트 1 편집" }));
  await user.upload(screen.getByLabelText("장비 스크린샷 파일"), photo("gordon"));
  await waitFor(() => expect(screen.getByLabelText("OCR 펜던트 종류")).toHaveValue("gordon"));
  await user.click(screen.getByRole("button", { name: "인식값 적용" }));
  expect(screen.getByLabelText("펜던트 1 종류")).toHaveValue("gordon");
  expect(screen.getByLabelText("펜던트 1 DEX")).toHaveValue(20);
});

it("blocks a candidate that duplicates the retained pendant, then compares after choosing the other slot", async () => {
  const input = createDefaultInput("corsair");
  Object.assign(input.character, { pureMain: "600", pureSub: "100" });
  input.equipment.weapon!.attackFlat = "100";
  Object.assign(input.equipment.necklace!, { pendantId: "horntail", mainFlat: "10" });
  Object.assign(input.equipment.pendant_2!, { pendantId: "yokai", mainFlat: "10" });
  const saved = serializeSetup(input); localStorage.setItem(STORAGE_KEY, saved);
  recognize.mockResolvedValue(tooltip("요괴 대사의 염주"));
  const user = userEvent.setup(); render(<CalculatorApp />);
  await waitFor(() => expect(screen.getByLabelText("펜던트 1 종류")).toHaveValue("horntail"));
  await user.click(screen.getByRole("button", { name: "비교 카드 추가" }));
  const dialog = within(screen.getByRole("dialog", { name: "비교할 장비 추가" }));
  await user.upload(dialog.getByLabelText("비교 후보 스크린샷"), photo("candidate"));
  await waitFor(() => expect(dialog.getByLabelText("OCR 펜던트 종류")).toHaveValue("yokai"));
  await user.selectOptions(dialog.getByLabelText("교체할 장비 부위"), "necklace");
  await user.click(dialog.getByLabelText("원본의 모든 옵션을 확인했습니다"));
  await user.click(dialog.getByRole("button", { name: "후보로 비교" }));
  const card = screen.getByRole("article", { name: "요괴 대사의 염주 비교 결과" });
  expect(card).toHaveTextContent("중복 착용 불가");
  await user.click(screen.getByRole("button", { name: "요괴 대사의 염주 상세 보기" }));
  await user.selectOptions(screen.getByLabelText("후보 비교 부위 수정"), "pendant_2");
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(card).not.toHaveTextContent("비교 불가");
  expect(card).toHaveTextContent("펜던트 2 교체 후");
  expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
});
