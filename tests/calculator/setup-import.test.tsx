import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { deserializeSetup, serializeSetup, STORAGE_KEY } from "@/features/calculator/storage";
import * as recognition from "@/features/calculator/ocr/recognizeTooltip.client";

const recognize = vi.fn<recognition.TooltipRecognizer["recognize"]>();
const image = (name: string) => new File([name], `${name}.png`, { type: "image/png" });
const saveButton = () => screen.getByRole("button", { name: /확인하고 프리셋 저장/ });
const ready = () => waitFor(() => expect(screen.getByLabelText("프리셋 등록 스크린샷")).toBeEnabled());

beforeEach(() => {
  localStorage.clear();
  recognize.mockReset().mockResolvedValue("장비분류: 망토\nDEX +18");
  vi.spyOn(recognition, "createBrowserTooltipRecognizer").mockImplementation(() => ({ recognize, terminate: vi.fn().mockResolvedValue(undefined) }));
});
afterEach(() => vi.restoreAllMocks());

it("reviews common armor and three weapons, then saves and restores them with one action", async () => {
  recognize.mockReset()
    .mockResolvedValueOnce("장비분류: 망토\nDEX +18")
    .mockResolvedValueOnce("장비분류: 건\n공격력 +100\n방어율 무시 +60%")
    .mockResolvedValueOnce("장비분류: 건\n공격력 +110\n보스공격력 +60%")
    .mockResolvedValueOnce("장비분류: 건\n공격력 +120\n총데미지 +21%");
  const user = userEvent.setup();
  const view = render(<CalculatorApp />);
  await ready();
  await user.clear(screen.getByLabelText("레벨"));
  await user.type(screen.getByLabelText("레벨"), "199");
  await user.upload(screen.getByLabelText("프리셋 등록 스크린샷"), ["cape", "chaos", "boss", "hunting"].map(image));
  await screen.findByText("4/4장 인식 완료");
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(screen.getByLabelText("1번 적용 위치")).toHaveValue("cape");
  expect(screen.getByLabelText("2번 적용 위치")).toHaveValue("preset:chaos");
  expect(screen.getByLabelText("3번 적용 위치")).toHaveValue("preset:boss");
  expect(screen.getByLabelText("4번 적용 위치")).toHaveValue("preset:hunting");
  await user.click(saveButton());
  expect(screen.getByText("4개 장비와 프리셋 저장 완료")).toBeVisible();
  expect(deserializeSetup(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({ ok: true, value: { input: {
    character: { level: "199" }, equipment: { cape: { mainFlat: "18" } },
    weaponPresets: { entries: {
      chaos: { weapon: { attackFlat: "100", ignoreDefensePercent: "60" } },
      boss: { weapon: { attackFlat: "110", bossDamagePercent: "60" } },
      hunting: { weapon: { attackFlat: "120", totalDamagePercent: "21" } },
    } },
  } } });
  view.unmount();
  render(<CalculatorApp />);
  await ready();
  expect(screen.getByLabelText("레벨")).toHaveValue(199);
  await user.click(screen.getByRole("button", { name: "사냥용 프리셋 선택" }));
  expect(screen.getByLabelText("무기 공격력", { exact: true })).toHaveValue(120);
});

it("keeps the previous setup and the reviewed batch when browser saving fails, and supports retry", async () => {
  const previous = createDefaultInput("corsair");
  previous.equipment.necklace!.mainFlat = "30";
  const raw = serializeSetup(previous);
  localStorage.setItem(STORAGE_KEY, raw);
  const user = userEvent.setup();
  render(<CalculatorApp />);
  await ready();
  await user.upload(screen.getByLabelText("프리셋 등록 스크린샷"), image("cape"));
  await screen.findByText("1/1장 인식 완료");
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new DOMException("Full", "QuotaExceededError"); });
  await user.click(saveButton());
  expect(screen.getByRole("alert")).toHaveTextContent("브라우저에 저장하지 못했습니다");
  expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  await user.click(screen.getByRole("button", { name: "망토 편집" }));
  expect(screen.getByLabelText("망토 DEX", { exact: true })).toHaveValue(null);
  expect(saveButton()).toBeEnabled();
  await user.click(saveButton());
  expect(write).toHaveBeenCalledTimes(2);
  expect(deserializeSetup(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({ ok: true, value: { input: {
    equipment: { necklace: { mainFlat: "30" }, cape: { mainFlat: "18" } },
  } } });
});

it("routes one pasted image to registration in bulk mode and preserves a pending review on another paste", async () => {
  const user = userEvent.setup();
  render(<CalculatorApp />);
  await ready();
  await user.click(screen.getByRole("button", { name: "일괄 입력 보기" }));
  fireEvent.paste(document, { clipboardData: { files: [image("cape")], items: [] } });
  await screen.findByText("1/1장 인식 완료");
  fireEvent.paste(document, { clipboardData: { files: [image("second")], items: [] } });
  expect(screen.getByRole("alert")).toHaveTextContent("현재 인식 목록을 저장하거나 닫은 뒤");
  expect(recognize).toHaveBeenCalledTimes(1);
  await user.click(saveButton());
  expect(screen.getByLabelText("일괄 입력 망토 DEX", { exact: true })).toHaveValue(18);
  expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
});

it("accepts dropped files and rejects conflicting destinations without partially saving", async () => {
  recognize.mockResolvedValueOnce("장비분류: 건\n공격력 +100\n보스공격력 +30%")
    .mockResolvedValueOnce("장비분류: 건\n공격력 +110\n보스공격력 +60%");
  const user = userEvent.setup();
  render(<CalculatorApp />);
  await ready();
  const dropzone = screen.getByRole("button", { name: "장비 스크린샷 한 번에 선택" }).parentElement!;
  fireEvent.drop(dropzone, { dataTransfer: { files: [image("a"), image("b")] } });
  await screen.findByText("2/2장 인식 완료");
  await user.click(saveButton());
  expect(screen.getByRole("alert")).toHaveTextContent("적용 위치가 같습니다");
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  await user.selectOptions(screen.getByLabelText("2번 적용 위치"), "preset:chaos");
  await user.click(saveButton());
  expect(screen.getByText("2개 장비와 프리셋 저장 완료")).toBeVisible();
});

it("ignores pending recognition after changing the job", async () => {
  let finish: (text: string) => void = () => {};
  recognize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const user = userEvent.setup();
  render(<CalculatorApp />);
  await ready();
  await user.upload(screen.getByLabelText("프리셋 등록 스크린샷"), image("pending"));
  await waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
  await user.selectOptions(screen.getByLabelText("직업"), "night_lord");
  expect(recognize.mock.calls[0][1].signal.aborted).toBe(true);
  finish("장비분류: 건\n공격력 +200");
  await Promise.resolve();
  const registration = screen.getByRole("region", { name: /장비 스크린샷을/ });
  expect(within(registration).queryByRole("region", { name: "여러 장비 인식 목록" })).not.toBeInTheDocument();
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});

it("requires a destination when OCR cannot read the equipment category", async () => {
  recognize.mockResolvedValue("DEX +18");
  const user = userEvent.setup();
  render(<CalculatorApp />);
  await ready();
  await user.upload(screen.getByLabelText("프리셋 등록 스크린샷"), image("unclassified"));
  await screen.findByText("1/1장 인식 완료");
  expect(saveButton()).toBeDisabled();
  expect(screen.getByText("부위 확인 필요")).toBeVisible();
  await user.selectOptions(screen.getByLabelText("1번 적용 위치"), "preset:boss");
  await user.click(screen.getByText("1번 이미지·인식값 확인 및 수정"));
  await user.type(screen.getByLabelText("1번 OCR 공격력", { exact: true }), "100");
  await user.click(saveButton());
  expect(deserializeSetup(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({ ok: true, value: { input: { equipment: { weapon: { mainFlat: "18", attackFlat: "100" } } } } });
});

it("keeps the review until an invalid character level is corrected", async () => {
  const user = userEvent.setup();
  render(<CalculatorApp />);
  await ready();
  await user.upload(screen.getByLabelText("프리셋 등록 스크린샷"), image("cape"));
  await screen.findByText("1/1장 인식 완료");
  fireEvent.change(screen.getByLabelText("레벨"), { target: { value: "221" } });
  await user.click(saveButton());
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent("캐릭터 설정에 잘못된 값");
  expect(screen.getByLabelText("레벨")).toHaveFocus();
  fireEvent.change(screen.getByLabelText("레벨"), { target: { value: "199" } });
  await user.click(saveButton());
  expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
});
