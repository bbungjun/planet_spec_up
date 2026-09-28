import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OcrReviewIssues } from "@/features/calculator/components/OcrReviewIssues";
import { buildOcrReview, mapReviewedStats, reviewBlocked } from "@/features/calculator/ocr/reviewRecognition";

it("selects a suggestion without applying it until the user confirms against the original", async () => {
  const user = userEvent.setup();
  const review = buildOcrReview([{ text: "홀스탯 +6%", pass: 0 }, { text: "몰스탯 +6%", pass: 1 }]);
  const onChange = vi.fn();
  render(<OcrReviewIssues review={{ ...review, lines: review.lines.slice(0, 1) }} job="corsair"
    image={new File(["private image"], "item.png", { type: "image/png" })} onChange={onChange} />);
  expect(screen.getByRole("button", { name: "이 옵션 확인" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "후보 선택: 올스탯 +6%" }));
  expect(screen.getByLabelText("원본에 보이는 옵션")).toHaveValue("올스탯 +6%");
  expect(onChange).not.toHaveBeenCalled();
  expect(reviewBlocked(review, "corsair")).toBe(true);
  await user.click(screen.getByRole("button", { name: "이 옵션 확인" }));
  const confirmed = onChange.mock.calls[0][0];
  expect(reviewBlocked(confirmed, "corsair")).toBe(false);
  expect(mapReviewedStats(confirmed, "corsair")).toEqual({ mainPercent: "6", subPercent: "6" });
});

it("shows normalized numeric requirement choices while keeping raw letters only in the source details", async () => {
  const user = userEvent.setup(), onChange = vi.fn();
  const review = buildOcrReview([
    { text: "REQ STR : O", pass: 0, bounds: { x: .4, y: .2, width: .3, height: .03 } },
    { text: "REQ STR : 1", pass: 1, bounds: { x: .4, y: .2, width: .3, height: .03 } },
  ]);
  render(<OcrReviewIssues review={review} job="corsair" image={new File(["image"], "item.png", { type: "image/png" })} onChange={onChange} />);
  expect(screen.getByLabelText("원본에 보이는 옵션")).toHaveValue("REQ STR : 0");
  expect(screen.getByRole("button", { name: "후보 선택: REQ STR : 0" })).toBeVisible();
  expect(screen.getByRole("button", { name: "후보 선택: REQ STR : 1" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /STR : O/ })).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText("원본에 보이는 옵션"));
  await user.type(screen.getByLabelText("원본에 보이는 옵션"), "REQ STR : O");
  expect(screen.getByRole("button", { name: "이 옵션 확인" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "후보 선택: REQ STR : 0" }));
  expect(onChange).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "이 옵션 확인" }));
  expect(mapReviewedStats(onChange.mock.calls[0][0], "corsair")).toEqual({ requiredSub: "0" });
  expect(onChange.mock.calls[0][0].lines[0].readings[0].text).toBe("REQ STR : O");
});

it("leaves an unread numeric value empty instead of prefilling an alphabetic token", () => {
  const review = buildOcrReview([{ text: "REQ STR : IJ", pass: 0 }]);
  render(<OcrReviewIssues review={review} job="corsair" image={new File(["image"], "item.png", { type: "image/png" })} onChange={vi.fn()} />);
  expect(screen.getByLabelText("원본에 보이는 옵션")).toHaveValue("REQ STR : ");
  expect(screen.getByRole("button", { name: "이 옵션 확인" })).toBeDisabled();
  expect(screen.getByText("인식 원문")).toBeInTheDocument();
});
