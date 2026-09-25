import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EquipmentOcrPanel } from "@/features/calculator/components/EquipmentOcrPanel";
import { emptyEquipment } from "@/features/calculator/domain/defaults";
import type { TooltipRecognizer } from "@/features/calculator/ocr/recognizeTooltip.client";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());
const ringA = "연금술사의 반지\n(유니크 아이템)\n장비분류: 반지\nDEX +1\nDEX +3%";
const ringB = ringA.replace("DEX +1", "DEX +4");
const file = (name: string, body = name, type = "image/png") => new File([body], name, {type});

it("recognizes a multi-file selection, excludes both image and semantic duplicates, and allows genuine twin gear", async () => {
  const recognize = vi.fn<TooltipRecognizer["recognize"]>().mockImplementation(async image => image.name === "b.png" ? ringB : ringA);
  const apply = vi.fn().mockReturnValue(null);
  const user = userEvent.setup();
  render(<EquipmentOcrPanel target={{job: "corsair", slot: "necklace"}} onApply={vi.fn()} onApplyBatch={apply}
    slotChoices={[{slot: "ring_1", label: "반지 1", equipment: emptyEquipment()}, {slot: "ring_2", label: "반지 2", equipment: emptyEquipment()}]}
    createRecognizer={() => ({recognize, terminate: vi.fn().mockResolvedValue(undefined)})} />);
  await user.upload(screen.getByLabelText("장비 스크린샷 파일"), [file("a.png"), file("b.png"), file("copy.png", "a.png"), file("recapture.png")]);
  await screen.findByText("4/4장 인식 완료");
  expect(recognize).toHaveBeenCalledTimes(3);
  expect(screen.getByText(/a.png와 동일한 이미지/)).toBeInTheDocument();
  expect(screen.getByText(/a.png와 이름·옵션이 같은/)).toBeInTheDocument();
  expect(screen.getByLabelText("3번 별도 장비로 포함")).not.toBeChecked();
  expect(screen.getByLabelText("4번 별도 장비로 포함")).not.toBeChecked();
  expect(screen.getByLabelText("1번 적용 위치")).toHaveValue("ring_1");
  expect(screen.getByLabelText("2번 적용 위치")).toHaveValue("ring_2");
  expect(apply).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText("4번 별도 장비로 포함"));
  await user.click(screen.getByRole("button", {name: "검토한 3개 장비 적용"}));
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls[0][1]).toHaveLength(3);
  expect(screen.getAllByText("적용 완료")).toHaveLength(3);
  expect(screen.getByRole("button", {name: "검토한 0개 장비 적용"})).toBeDisabled();
});

it("continues after a bad file and lets the remaining results be applied", async () => {
  const recognize = vi.fn<TooltipRecognizer["recognize"]>().mockRejectedValueOnce(new Error("decode")).mockResolvedValueOnce(ringB);
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
  let resolve: ((value: string) => void) | undefined;
  const recognize = vi.fn<TooltipRecognizer["recognize"]>().mockImplementation(() => new Promise(done => {resolve = done;}));
  const user = userEvent.setup();
  render(<EquipmentOcrPanel target={{job: "corsair", slot: "weapon"}} onApply={vi.fn()} onApplyBatch={vi.fn().mockReturnValue(null)}
    createRecognizer={() => ({recognize, terminate: vi.fn().mockResolvedValue(undefined)})} />);
  await user.upload(screen.getByLabelText("장비 스크린샷 파일"), [file("a.png"), file("b.png")]);
  await waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole("button", {name: "전체 인식 취소"}));
  expect(recognize.mock.calls[0][1].signal.aborted).toBe(true);
  resolve?.(ringA);
  await Promise.resolve();
  expect(screen.queryByRole("region", {name: "여러 장비 인식 목록"})).not.toBeInTheDocument();
  expect(recognize).toHaveBeenCalledTimes(1);
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
