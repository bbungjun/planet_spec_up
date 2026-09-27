import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EquipmentOcrBatchPanel } from "@/features/calculator/components/EquipmentOcrBatchPanel";
import { emptyEquipment } from "@/features/calculator/domain/defaults";
import { buildOcrReview } from "@/features/calculator/ocr/reviewRecognition";
import type { TooltipRecognizer } from "@/features/calculator/ocr/recognizeTooltip.client";

afterEach(() => vi.restoreAllMocks());
const file = (name: string) => new File([name], name, { type: "image/png" });
const choices = [{ slot: "cape" as const, label: "망토", equipment: emptyEquipment() }, { slot: "hat" as const, label: "모자", equipment: emptyEquipment() }];

it("blocks applying conflicting evidence until the user corrects the source line", async () => {
  const review = buildOcrReview([
    { text: "장비분류: 망토", pass: 0 },
    { text: "DEX +604", pass: 0, bounds: { x: .1, y: .5, width: .5, height: .03 } },
    { text: "DEX +6%", pass: 1, bounds: { x: .1, y: .501, width: .5, height: .03 } },
  ]);
  const recognize = vi.fn<TooltipRecognizer["recognize"]>().mockImplementation(async (_file, options) => { options.onReview?.(review); return "장비분류: 망토\nDEX +604"; });
  const apply = vi.fn().mockReturnValue(null), user = userEvent.setup();
  render(<EquipmentOcrBatchPanel files={[file("cape.png")]} job="corsair" choices={choices} onApply={apply} onClose={vi.fn()}
    createRecognizer={() => ({ recognize, terminate: vi.fn().mockResolvedValue(undefined) })} />);
  await screen.findByText("1/1장 인식 완료");
  expect(screen.getByRole("button", { name: "검토한 1개 장비 적용" })).toBeDisabled();
  await user.clear(screen.getByLabelText("원본에 보이는 옵션"));
  await user.type(screen.getByLabelText("원본에 보이는 옵션"), "DEX +6%");
  await user.click(screen.getByRole("button", { name: "이 옵션 확인" }));
  await user.click(screen.getByRole("button", { name: "검토한 1개 장비 적용" }));
  expect(apply.mock.calls[0][1][0].replacement).toEqual({ mainPercent: "6" });
});

it("retries only a selected failure and preserves edits in completed photos", async () => {
  const recognize = vi.fn<TooltipRecognizer["recognize"]>().mockImplementation(async image => image.name === "failed.png" ? Promise.reject(new Error("decode")) : "장비분류: 망토\nDEX +8");
  const user = userEvent.setup();
  render(<EquipmentOcrBatchPanel files={[file("cape.png"), file("failed.png")]} job="corsair" choices={choices} onApply={vi.fn()} onClose={vi.fn()}
    createRecognizer={() => ({ recognize, terminate: vi.fn().mockResolvedValue(undefined) })} />);
  await screen.findByText("2/2장 인식 완료");
  await user.click(screen.getByText("1번 이미지·인식값 확인 및 수정"));
  await user.clear(screen.getByLabelText("1번 OCR DEX", { exact: true }));
  await user.type(screen.getByLabelText("1번 OCR DEX", { exact: true }), "17");
  recognize.mockResolvedValue("장비분류: 모자\nDEX +4");
  await user.click(screen.getByRole("button", { name: "2번 영역 직접 선택" }));
  await user.click(screen.getByText("키보드로 영역 조정"));
  for (const [label, value] of [["왼쪽 위치 (%)", "10"], ["위쪽 위치 (%)", "20"], ["영역 너비 (%)", "30"], ["영역 높이 (%)", "40"]]) {
    const input = screen.getByLabelText(label); await user.clear(input); await user.type(input, value);
  }
  await user.click(screen.getByRole("button", { name: "선택 영역 다시 읽기" }));
  await waitFor(() => expect(recognize).toHaveBeenCalledTimes(3));
  expect(recognize.mock.calls[2][0].name).toBe("failed.png");
  expect(recognize.mock.calls[2][1].region).toEqual({ x: .1, y: .2, width: .3, height: .4 });
  expect(screen.getByLabelText("1번 OCR DEX", { exact: true })).toHaveValue(17);
  expect(screen.getByLabelText("2번 적용 위치")).toHaveValue("hat");
});

it("cancels pending photos while preserving already completed photos and rejecting late results", async () => {
  let finish: (text: string) => void = () => {};
  const recognize = vi.fn<TooltipRecognizer["recognize"]>().mockImplementation(image => image.name === "done.png" ? Promise.resolve("장비분류: 망토\nDEX +8") : new Promise(resolve => { finish = resolve; }));
  const user = userEvent.setup();
  render(<EquipmentOcrBatchPanel files={[file("done.png"), file("pending.png")]} job="corsair" choices={choices} onApply={vi.fn()} onClose={vi.fn()}
    createRecognizer={() => ({ recognize, terminate: vi.fn().mockResolvedValue(undefined) })} />);
  await screen.findByText("1/2장 인식 완료");
  await user.click(screen.getByRole("button", { name: "전체 인식 취소" }));
  expect(screen.getByLabelText("1번 적용 위치")).toHaveValue("cape");
  finish("장비분류: 모자\nDEX +999");
  await Promise.resolve();
  const rows = screen.getAllByRole("listitem");
  expect(within(rows[1]).getByRole("alert")).toHaveTextContent("취소");
  expect(screen.getByRole("button", { name: "검토한 1개 장비 적용" })).toBeEnabled();
});
