import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EquipmentOcrPanel } from "@/features/calculator/components/EquipmentOcrPanel";
import { EquipmentOcrBatchPanel } from "@/features/calculator/components/EquipmentOcrBatchPanel";
import { emptyEquipment } from "@/features/calculator/domain/defaults";
import * as reviewModule from "@/features/calculator/ocr/reviewRecognition";
import { locateRequirementVerification } from "@/features/calculator/ocr/retryRequirements";
import type { TooltipRecognizer } from "@/features/calculator/ocr/recognizeTooltip.client";
import type { OcrReading, OcrReview, RequirementObservation } from "@/features/calculator/ocr/types";

afterEach(() => vi.restoreAllMocks());
function verifiedReview(): OcrReview {
  const identity = { sourceId: "source", operationId: "operation" };
  const raw: OcrReading[] = ["REQ LEV:80", "REQ STR:17", "장비분류:망토", "공격력:+5"].flatMap((text, index) => [0, 1].map(pass => ({
    text, pass, bounds: { x: .2, y: .2 + index * .1, width: .4, height: .03 },
    provenance: { ...identity, role: "discovery" as const, viewId: `discovery-${pass}`, readingId: `${index}-${pass}` },
  })));
  let review = reviewModule.buildOcrReview(raw);
  const targets = locateRequirementVerification(review, identity, { width: 1000, height: 1000 });
  for (const target of targets) {
    const observations: RequirementObservation[] = (["color", "luma"] as const).flatMap(mode => ([2, 3] as const).map(scale => {
      const viewId = `${target.rowId}-${mode}-${scale}`;
      return { ...identity, field: target.field, rowId: target.rowId, viewId, mode, scale, crop: target.crop,
        readings: [{ text: `REQ ${target.field}:${target.field === "LEV" ? 80 : 17}`, pass: scale + 30, bounds: target.rowBounds,
          provenance: { ...identity, role: "verification" as const, field: target.field, rowId: target.rowId, viewId, readingId: viewId } }] };
    }));
    review = reviewModule.applyRequirementRecovery(review, target, observations);
  }
  return review;
}
function recognizer(review: OcrReview): TooltipRecognizer {
  return { recognize: vi.fn(async (_file, options) => { options.onReview?.(review); return reviewModule.reviewText(review); }), terminate: vi.fn(async () => undefined) };
}
function suspectedReview(): OcrReview {
  return reviewModule.buildOcrReview(["FIEQ STR : Q", "장비분류: 망토", "공격력:+5"].flatMap((text, index) => [0, 1].map(pass => ({
    text, pass, bounds: { x: .2, y: .2 + index * .15, width: .4, height: .03 },
  }))));
}

it("keeps a newly discovered requirement blocked until its single-image numeric field is explicitly corrected", async () => {
  const original = suspectedReview(), apply = vi.fn(), user = userEvent.setup();
  render(<EquipmentOcrPanel target={{ job: "corsair", slot: "cape" }} onApply={apply} createRecognizer={() => recognizer(original)} />);
  await user.upload(screen.getByLabelText("장비 스크린샷 파일"), new File(["photo"], "photo.png", { type: "image/png" }));
  await screen.findByLabelText("인식 요구 STR");
  expect(screen.getByRole("button", { name: "인식값 적용" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("인식 요구 STR"), { target: { value: "40" } });
  await user.click(screen.getByRole("button", { name: "인식값 적용" }));
  expect(apply.mock.calls[0][1]).toMatchObject({ requiredSub: "40", attackFlat: "5" });
  expect(original.lines[0].suspectedRequirement).toBeDefined();
});

it("uses the same suspected-requirement correction contract in batch application", async () => {
  const original = suspectedReview(), apply = vi.fn().mockReturnValue(null), user = userEvent.setup();
  render(<EquipmentOcrBatchPanel files={[new File(["batch-photo"], "batch.png", { type: "image/png" })]} job="corsair"
    choices={[{ slot: "cape", label: "망토", equipment: emptyEquipment() }]} onApply={apply} onClose={vi.fn()} createRecognizer={() => recognizer(original)} />);
  await screen.findByLabelText("1번 인식 요구 STR");
  expect(screen.getByRole("button", { name: "검토한 1개 장비 적용" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("1번 인식 요구 STR"), { target: { value: "40" } });
  await user.click(screen.getByRole("button", { name: "검토한 1개 장비 적용" }));
  expect(apply.mock.calls[0][1][0].replacement).toMatchObject({ requiredSub: "40", attackFlat: "5" });
});
function checkEditedProof(review: OcrReview) {
  expect(review.lines.find(line => line.text === "REQ STR : 60")).toMatchObject({ status: "confirmed", recovery: undefined });
  expect(review.lines.find(line => line.recovery?.target.field === "LEV")?.recovery?.status).toBe("verified");
  expect(reviewModule.mapReviewedStats(review, "corsair")).toEqual({ requiredLevel: "80", requiredSub: "60", attackFlat: "5" });
}

it("invalidates only the edited requirement proof through the single-image numeric proposal field", async () => {
  const original = verifiedReview(), worker = recognizer(original), apply = vi.fn();
  const edit = vi.spyOn(reviewModule, "overrideReviewRequirement");
  const user = userEvent.setup();
  render(<EquipmentOcrPanel target={{ job: "corsair", slot: "cape" }} onApply={apply} createRecognizer={() => worker} />);
  await user.upload(screen.getByLabelText("장비 스크린샷 파일"), new File(["photo"], "photo.png", { type: "image/png" }));
  expect(await screen.findByLabelText("인식 요구 STR")).toHaveValue(17);
  fireEvent.change(screen.getByLabelText("인식 요구 STR"), { target: { value: "60" } });
  expect(edit).toHaveBeenCalled();
  checkEditedProof(edit.mock.results.at(-1)!.value);
  await user.click(screen.getByRole("button", { name: "인식값 적용" }));
  expect(apply.mock.calls[0][1]).toMatchObject({ requiredLevel: "80", requiredSub: "60", attackFlat: "5" });
  expect(original.lines.find(line => line.recovery?.target.field === "STR")?.recovery?.status).toBe("verified");
});

it("invalidates only the edited requirement proof through the batch numeric override field", async () => {
  const original = verifiedReview(), apply = vi.fn().mockReturnValue(null), worker = recognizer(original);
  const edit = vi.spyOn(reviewModule, "overrideReviewRequirement");
  const user = userEvent.setup();
  render(<EquipmentOcrBatchPanel files={[new File(["batch-photo"], "batch.png", { type: "image/png" })]} job="corsair"
    choices={[{ slot: "cape", label: "망토", equipment: emptyEquipment() }]} onApply={apply} onClose={vi.fn()} createRecognizer={() => worker} />);
  expect(await screen.findByLabelText("1번 인식 요구 STR")).toHaveValue(17);
  fireEvent.change(screen.getByLabelText("1번 인식 요구 STR"), { target: { value: "60" } });
  checkEditedProof(edit.mock.results.at(-1)!.value);
  await user.click(screen.getByRole("button", { name: "검토한 1개 장비 적용" }));
  expect(apply.mock.calls[0][1][0].replacement).toMatchObject({ requiredLevel: "80", requiredSub: "60", attackFlat: "5" });
});
