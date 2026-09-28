import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedbackAdmin } from "@/features/feedback/FeedbackAdmin";
import type { FeedbackReport } from "@/features/feedback/types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const report: FeedbackReport = {
  id: "98a7d65e-d51a-4e92-90c5-721eb363a91e", sequence: 1,
  category: "recognition", title: "운영자만 볼 수 있는 제보", description: "공개되지 않아야 하는 오류 재현 내용입니다.", environment: "PC",
  status: "received", adminNote: "", createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z",
};

it("removes private report contents when the session expires", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ reports: [report], nextCursor: null }))
    .mockResolvedValueOnce(Response.json({ error: "운영자 로그인이 필요합니다." }, { status: 401 })));
  const user = userEvent.setup(); render(<FeedbackAdmin />);
  expect(await screen.findByRole("heading", { name: report.title })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "새로고침" }));
  expect(await screen.findByRole("heading", { name: "운영자 로그인" })).toBeInTheDocument();
  expect(screen.queryByText(report.description)).not.toBeInTheDocument();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
});

it("preserves a draft and its original version when a refresh discovers another edit", async () => {
  const newer = { ...report, status: "investigating", adminNote: "다른 탭에서 저장한 메모", updatedAt: "2026-09-29T00:01:00.000Z" };
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ reports: [report], nextCursor: null }))
    .mockResolvedValueOnce(Response.json({ reports: [newer], nextCursor: null }))
    .mockResolvedValueOnce(Response.json({ error: "제보가 변경됐습니다." }, { status: 409 }));
  vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup(); render(<FeedbackAdmin />);
  const article = await screen.findByRole("article");
  await user.click(within(article).getByText("처리 상태·운영자 메모"));
  await user.type(within(article).getByLabelText("운영자 메모"), "작성 중이던 내 메모");
  await user.click(screen.getByRole("button", { name: "새로고침" }));
  expect(await within(article).findByRole("button", { name: "최신 내용 불러오기" })).toBeInTheDocument();
  expect(within(article).getByLabelText("운영자 메모")).toHaveValue("작성 중이던 내 메모");
  await user.click(within(article).getByRole("button", { name: "변경 저장" }));
  expect(JSON.parse(fetch.mock.calls[2][1].body).updatedAt).toBe(report.updatedAt);
  await user.click(within(article).getByRole("button", { name: "최신 내용 불러오기" }));
  expect(within(article).getByLabelText("운영자 메모")).toHaveValue(newer.adminNote);
});
