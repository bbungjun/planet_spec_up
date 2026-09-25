import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { calculateDamageResult } from "@/features/calculator/domain/calculate";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { addEquipmentSlot, getEquipmentSlotLabel, getVisibleEquipmentSlots, removeEquipmentSlot } from "@/features/calculator/domain/slots";
import { deserializeSetup, serializeSetup } from "@/features/calculator/storage";

const recognize = vi.hoisted(() => vi.fn());
vi.mock("@/features/calculator/ocr/recognizeTooltip.client", async importOriginal => {
  const actual = await importOriginal<typeof import("@/features/calculator/ocr/recognizeTooltip.client")>();
  return {
    ...actual,
    createBrowserTooltipRecognizer: () => ({ recognize, terminate: vi.fn().mockResolvedValue(undefined) }),
  };
});

beforeEach(() => {
  localStorage.clear();
  recognize.mockReset().mockResolvedValue("장비분류 : 어깨장식\n공격력 +5\nSTR +2");
});

it("counts independent unknown and repeated gear slots and persists them without rejecting old setups", () => {
  let input = createDefaultInput("corsair");
  const legacy = deserializeSetup(serializeSetup(input));
  expect(legacy).toMatchObject({ ok: true });

  const shoulder = addEquipmentSlot(input, "어깨장식")!;
  input = shoulder.input;
  input.equipment[shoulder.slot]!.attackFlat = "5";
  const secondShoulder = addEquipmentSlot(input, "어깨장식")!;
  input = secondShoulder.input;
  input.equipment[secondShoulder.slot]!.attackFlat = "7";
  const secondNecklace = addEquipmentSlot(input, "목걸이")!;
  input = secondNecklace.input;
  input.equipment[secondNecklace.slot]!.mainFlat = "21";

  expect(getEquipmentSlotLabel(input, shoulder.slot)).toBe("어깨장식");
  expect(getEquipmentSlotLabel(input, secondShoulder.slot)).toBe("어깨장식 2");
  expect(getEquipmentSlotLabel(input, secondNecklace.slot)).toBe("목걸이 2");
  expect(getVisibleEquipmentSlots(input)).toContain(secondNecklace.slot);
  expect(calculateDamageResult(input)).toMatchObject({totalAttack: 12});
  expect(deserializeSetup(serializeSetup(input))).toMatchObject({
    ok: true,
    value: {input: {equipment: {[shoulder.slot]: {attackFlat: "5"}, [secondNecklace.slot]: {mainFlat: "21"}}}},
  });
  expect(calculateDamageResult(removeEquipmentSlot(input, shoulder.slot)).totalAttack).toBe(7);
});

it("adds a named gear slot to the card, bulk editor and the saved setup", async () => {
  const user = userEvent.setup();
  const view = render(<CalculatorApp />);
  await user.click(screen.getByRole("button", {name: "무기 편집"}));
  await user.type(screen.getByLabelText("무기 공격력", {exact: true}), "100");
  const before = screen.getByLabelText("스탯 공격력 결과").textContent;

  await user.type(screen.getByLabelText("새 장비 부위"), "어깨장식");
  await user.click(screen.getByRole("button", {name: "장비 추가"}));
  expect(screen.getByRole("heading", {name: "어깨장식 옵션"})).toBeInTheDocument();
  await user.type(screen.getByLabelText("어깨장식 공격력", {exact: true}), "5");
  expect(screen.getByLabelText("스탯 공격력 결과").textContent).not.toBe(before);

  await user.click(screen.getByRole("button", {name: "일괄 입력 보기"}));
  expect(screen.getByLabelText("일괄 입력 어깨장식 공격력", {exact: true})).toHaveValue(5);
  await user.click(screen.getByRole("button", {name: /^저장$/}));
  view.unmount();
  render(<CalculatorApp />);
  await waitFor(() => expect(screen.getByRole("button", {name: "어깨장식 편집"})).toBeInTheDocument());
  await user.click(screen.getByRole("button", {name: "어깨장식 편집"}));
  expect(screen.getByLabelText("어깨장식 공격력", {exact: true})).toHaveValue(5);
});

it("creates an extra slot from a reviewed OCR category without overwriting the selected card", async () => {
  const user = userEvent.setup();
  render(<CalculatorApp />);
  await user.upload(screen.getByLabelText("장비 스크린샷 파일"), new File(["image"], "shoulder.png", {type: "image/png"}));
  expect(await screen.findByRole("button", {name: "어깨장식 새 장비로 추가"})).toBeInTheDocument();
  await user.click(screen.getByRole("button", {name: "어깨장식 새 장비로 추가"}));
  expect(screen.getByRole("heading", {name: "어깨장식 옵션"})).toBeInTheDocument();
  expect(screen.getByLabelText("어깨장식 공격력", {exact: true})).toHaveValue(5);
  expect(screen.getByLabelText("어깨장식 STR", {exact: true})).toHaveValue(2);
  await user.click(screen.getByRole("button", {name: "목걸이 편집"}));
  expect(screen.getByLabelText("목걸이 공격력", {exact: true})).toHaveValue(null);
});

it("imports a multi-image batch into a new slot and an empty existing slot in one update", async () => {
  recognize.mockReset()
    .mockResolvedValueOnce("장비분류: 어깨장식\n공격력 +5")
    .mockResolvedValueOnce("장비분류: 망토\nDEX +8");
  const user = userEvent.setup();
  render(<CalculatorApp />);
  await user.upload(screen.getByLabelText("장비 스크린샷 파일"), [
    new File(["shoulder"], "shoulder.png", {type: "image/png"}),
    new File(["cape"], "cape.png", {type: "image/png"}),
  ]);
  await screen.findByText("2/2장 인식 완료");
  await user.click(screen.getByRole("button", {name: "검토한 2개 장비 적용"}));
  await user.click(screen.getByRole("button", {name: "어깨장식 편집"}));
  expect(screen.getByLabelText("어깨장식 공격력", {exact: true})).toHaveValue(5);
  await user.click(screen.getByRole("button", {name: "망토 편집"}));
  expect(screen.getByLabelText("망토 DEX", {exact: true})).toHaveValue(8);
  expect(screen.getAllByText("적용 완료")).toHaveLength(2);
});
