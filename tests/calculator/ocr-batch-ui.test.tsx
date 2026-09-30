import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EquipmentOcrPanel } from "@/features/calculator/components/EquipmentOcrPanel";
import { EquipmentOcrBatchPanel } from "@/features/calculator/components/EquipmentOcrBatchPanel";
import { emptyEquipment } from "@/features/calculator/domain/defaults";
import { RING_SLOTS } from "@/features/calculator/domain/slots";
import type { TooltipRecognizer } from "@/features/calculator/ocr/recognizeTooltip.client";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const ringA = "연금술사의 반지\n(유니크 아이템)\n장비분류: 반지\nDEX +1\nDEX +3%";
const ringB = ringA.replace("DEX +1", "DEX +4");
const file = (name: string, body = name, type = "image/png") => new File([body], name, {type});
const ringChoices = () => RING_SLOTS.map((slot, index) => ({ slot, label: `반지 ${index + 1}`, equipment: emptyEquipment() }));

it("excludes unnamed identical clipboard images initially and after retry", async () => {
  const user = userEvent.setup();
  render(<EquipmentOcrBatchPanel files={[file("", "same bytes"), file("", "same bytes")]} job="corsair" choices={ringChoices()}
    onApply={vi.fn()} onClose={vi.fn()} createRecognizer={() => ({ recognize: vi.fn().mockResolvedValue(ringA), terminate: vi.fn() })} />);
  await screen.findByText("2/2장 인식 완료");
  expect(screen.getByLabelText("2번 별도 장비로 포함")).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "2번 대비 보정 후 다시 읽기" }));
  await screen.findByText("와 동일한 이미지입니다.");
  expect(screen.getByLabelText("2번 별도 장비로 포함")).not.toBeChecked();
});

it("includes equal-option rings by default while excluding identical image copies", async () => {
  const recognize = vi.fn<TooltipRecognizer["recognize"]>().mockImplementation(async image => image.name === "b.png" ? ringB : ringA);
  const apply = vi.fn().mockReturnValue(null);
  const user = userEvent.setup();
  render(<EquipmentOcrPanel target={{job: "corsair", slot: "necklace"}} onApply={vi.fn()} onApplyBatch={apply}
    slotChoices={ringChoices()}
    createRecognizer={() => ({recognize, terminate: vi.fn().mockResolvedValue(undefined)})} />);
  await user.upload(screen.getByLabelText("장비 스크린샷 파일"), [file("a.png"), file("b.png"), file("copy.png", "a.png"), file("recapture.png")]);
  await screen.findByText("4/4장 인식 완료");
  expect(recognize).toHaveBeenCalledTimes(3);
  expect(screen.getByText(/a.png와 동일한 이미지/)).toBeInTheDocument();
  expect(screen.queryByText(/이름·옵션이 같은/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("3번 별도 장비로 포함")).not.toBeChecked();
  expect(screen.getByLabelText("4번 적용에 포함")).toBeChecked();
  expect(screen.getByLabelText("1번 적용 위치")).toHaveValue("ring_1");
  expect(screen.getByLabelText("2번 적용 위치")).toHaveValue("ring_2");
  expect(screen.getByLabelText("4번 적용 위치")).toHaveValue("ring_3");
  expect(apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", {name: "검토한 3개 장비 적용"}));
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls[0][1]).toHaveLength(3);
  expect(screen.getAllByText("적용 완료")).toHaveLength(3);
  expect(screen.getByRole("button", {name: "검토한 0개 장비 적용"})).toBeDisabled();
});

it("continues after a bad file and lets the remaining results be applied", async () => {
  const recognize = vi.fn<TooltipRecognizer["recognize"]>().mockRejectedValueOnce(new Error("decode")).mockResolvedValueOnce("장비분류: 망토\nDEX +4");
  const user = userEvent.setup({applyAccept: false});
  render(<EquipmentOcrPanel target={{job: "corsair", slot: "weapon"}} onApply={vi.fn()} onApplyBatch={vi.fn().mockReturnValue(null)}
    createRecognizer={() => ({recognize, terminate: vi.fn().mockResolvedValue(undefined)})} />);
  await user.upload(screen.getByLabelText("장비 스크린샷 파일"), [file("bad.png"), file("good.png"), file("bad.gif", "gif", "image/gif")]);
  await screen.findByText("3/3장 인식 완료");
  expect(screen.getAllByText("실패")).toHaveLength(2);
  expect(recognize).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", {name: "검토한 1개 장비 적용"})).toBeEnabled();
});

it("cancels pending recognition and ignores late results", async () => {
  vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(8);
  let resolve: ((value: string) => void) | undefined;
  const recognize = vi.fn<TooltipRecognizer["recognize"]>().mockImplementation(() => new Promise(done => {resolve = done;}));
  const user = userEvent.setup();
  render(<EquipmentOcrPanel target={{job: "corsair", slot: "weapon"}} onApply={vi.fn()} onApplyBatch={vi.fn().mockReturnValue(null)}
    createRecognizer={() => ({recognize, terminate: vi.fn().mockResolvedValue(undefined)})} />);
  await user.upload(screen.getByLabelText("장비 스크린샷 파일"), [file("a.png"), file("b.png")]);
  await waitFor(() => expect(recognize).toHaveBeenCalledTimes(2));
  await user.click(screen.getByRole("button", {name: "전체 인식 취소"}));
  expect(recognize.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
  resolve?.(ringA);
  await Promise.resolve();
  expect(screen.getByRole("region", {name: "여러 장비 인식 목록"})).toBeInTheDocument();
  expect(screen.getAllByText("인식을 취소했습니다.")).toHaveLength(2);
  expect(screen.getByRole("button", {name: "검토한 0개 장비 적용"})).toBeDisabled();
  expect(recognize).toHaveBeenCalledTimes(2);
});

it("preserves ring and duplicate order when OCR finishes in reverse order", async () => {
  vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(8);
  const finish = new Map<string, (text: string) => void>();
  const recognize = vi.fn<TooltipRecognizer["recognize"]>().mockImplementation(image => new Promise(resolve => finish.set(image.name, resolve)));
  const apply = vi.fn().mockReturnValue(null);
  const user = userEvent.setup();
  render(<EquipmentOcrPanel target={{job: "corsair", slot: "necklace"}} onApply={vi.fn()} onApplyBatch={apply}
    slotChoices={ringChoices()}
    createRecognizer={() => ({recognize, terminate: vi.fn().mockResolvedValue(undefined)})} />);
  await user.upload(screen.getByLabelText("장비 스크린샷 파일"), [file("a.png"), file("b.png"), file("twin.png")]);
  await waitFor(() => expect(recognize).toHaveBeenCalledTimes(3));
  finish.get("twin.png")!(ringA);
  finish.get("b.png")!(ringB);
  await screen.findByText("2/3장 인식 완료");
  expect(screen.getByRole("button", { name: "검토한 0개 장비 적용" })).toBeDisabled();
  finish.get("a.png")!(ringA);
  await screen.findByText("3/3장 인식 완료");
  expect(screen.getByLabelText("1번 적용 위치")).toHaveValue("ring_1");
  expect(screen.getByLabelText("2번 적용 위치")).toHaveValue("ring_2");
  expect(screen.getByLabelText("3번 적용에 포함")).toBeChecked();
  expect(screen.getByLabelText("3번 적용 위치")).toHaveValue("ring_3");
  expect(screen.queryByText(/이름·옵션이 같은/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "검토한 3개 장비 적용" }));
  expect(apply.mock.calls[0][1].map((entry: { destination: string }) => entry.destination)).toEqual(["ring_1", "ring_2", "ring_3"]);
});

it("warns about a single screenshot that matches already entered gear", async () => {
  const gear = {...emptyEquipment(), attackFlat: "100"};
  const user = userEvent.setup();
  const apply = vi.fn();
  render(<EquipmentOcrPanel target={{job: "corsair", slot: "weapon"}} onApply={apply}
    slotChoices={[{slot: "weapon", label: "무기", equipment: gear}]}
    createRecognizer={() => ({recognize: vi.fn().mockResolvedValue("장비분류: 건\n공격력 +100"), terminate: vi.fn().mockResolvedValue(undefined)})} />);
  await user.upload(screen.getByLabelText("장비 스크린샷 파일"), file("weapon.png"));
  expect(await screen.findByRole("alert")).toHaveTextContent("이미 입력된 무기");
  expect(screen.getByRole("button", {name: "인식값 적용"})).toBeDisabled();
  await user.click(screen.getByLabelText("중복 확인 후 적용 허용"));
  await user.click(screen.getByRole("button", {name: "인식값 적용"}));
  expect(apply).toHaveBeenCalledTimes(1);
});

it("assigns four identical-option rings and requires an explicit destination for a fifth", async () => {
  const user = userEvent.setup(), apply = vi.fn().mockReturnValue(null);
  render(<EquipmentOcrBatchPanel files={[1, 2, 3, 4, 5].map(n => file(`${n}.png`))} job="corsair" choices={ringChoices()}
    onApply={apply} onClose={vi.fn()} createRecognizer={() => ({ recognize: vi.fn().mockResolvedValue(ringA), terminate: vi.fn() })} />);
  await screen.findByText("5/5장 인식 완료");
  for (let i = 1; i <= 4; i++) {
    expect(screen.getByLabelText(`${i}번 적용 위치`)).toHaveValue(`ring_${i}`);
    expect(screen.getByLabelText(`${i}번 적용에 포함`)).toBeChecked();
  }
  expect(screen.getByLabelText("5번 적용 위치")).toHaveValue("");
  expect(screen.getByText(/반지는 최대 4개입니다/)).toBeVisible();
  expect(screen.getByRole("button", { name: "검토한 5개 장비 적용" })).toBeDisabled();
  expect(screen.queryByRole("option", { name: "새 장비 부위로 추가" })).not.toBeInTheDocument();
  await user.click(screen.getByLabelText("5번 적용에 포함"));
  await user.click(screen.getByRole("button", { name: "검토한 4개 장비 적용" }));
  expect(apply.mock.calls[0][1].map((entry: { destination: string }) => entry.destination)).toEqual(RING_SLOTS);
});

it("preserves ring inclusion and exact-image exclusion after individual retries", async () => {
  const user = userEvent.setup();
  render(<EquipmentOcrBatchPanel files={[file("a.png"), file("twin.png"), file("copy.png", "a.png")]} job="corsair" choices={ringChoices()}
    onApply={vi.fn()} onClose={vi.fn()} createRecognizer={() => ({ recognize: vi.fn().mockResolvedValue(ringA), terminate: vi.fn() })} />);
  await screen.findByText("3/3장 인식 완료");
  await user.click(screen.getByRole("button", { name: "2번 대비 보정 후 다시 읽기" }));
  await waitFor(() => expect(screen.getByLabelText("2번 적용 위치")).toHaveValue("ring_2"));
  expect(screen.getByLabelText("2번 적용에 포함")).toBeChecked();
  await user.click(screen.getByRole("button", { name: "3번 대비 보정 후 다시 읽기" }));
  await screen.findByText(/a.png와 동일한 이미지/);
  expect(screen.getByLabelText("3번 별도 장비로 포함")).not.toBeChecked();
});

it("keeps semantic duplicate protection for non-ring gear", async () => {
  render(<EquipmentOcrBatchPanel files={[file("a.png"), file("b.png")]} job="corsair" choices={[]}
    onApply={vi.fn()} onClose={vi.fn()} createRecognizer={() => ({ recognize: vi.fn().mockResolvedValue("모자\n(유니크 아이템)\n장비분류: 모자\nDEX +4"), terminate: vi.fn() })} />);
  await screen.findByText("2/2장 인식 완료");
  expect(screen.getByText(/a.png와 이름·옵션이 같은/)).toBeVisible();
  expect(screen.getByLabelText("2번 별도 장비로 포함")).not.toBeChecked();
});
