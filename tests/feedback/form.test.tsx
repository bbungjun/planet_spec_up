import { afterEach, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedbackForm } from "@/features/feedback/FeedbackForm";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("preserves a failed submission and reuses the receipt id for a safe retry", async () => {
  const fetch = vi.fn()
    .mockRejectedValueOnce(new Error("network"))
    .mockImplementationOnce((_url, init) => Promise.resolve(Response.json({ id: JSON.parse(init.body).id }, { status: 201 })));
  vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup(); render(<FeedbackForm />);
  await user.type(screen.getByLabelText("제목"), "장갑 공격력 누락");
  await user.type(screen.getByLabelText(/오류 내용/), "장갑 사진을 넣으면 공격력이 빈칸으로 표시됩니다.");
  await user.click(screen.getByRole("button", { name: "제보 보내기" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("입력 내용은 유지");
  expect(screen.getByLabelText("제목")).toHaveValue("장갑 공격력 누락");
  await user.click(screen.getByRole("button", { name: "제보 보내기" }));
  expect(await screen.findByRole("heading", { name: "제보가 접수되었습니다" })).toBeInTheDocument();
  expect(JSON.parse(fetch.mock.calls[0][1].body).id).toBe(JSON.parse(fetch.mock.calls[1][1].body).id);
  expect(screen.queryByText("제보 관리")).not.toBeInTheDocument();
});
