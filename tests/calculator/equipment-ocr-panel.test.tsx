import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EquipmentOcrPanel } from "@/features/calculator/components/EquipmentOcrPanel";
import type { TooltipRecognizer } from "@/features/calculator/ocr/recognizeTooltip.client";
import type { OcrTarget } from "@/features/calculator/ocr/types";

const target: OcrTarget = { job: "corsair", slot: "overall" };
const attachedTooltipText = [
  "STR +10",
  "DEX +21",
  "HP +15",
  "DEX +9%",
  "DEX +6%",
  "DEX +6%",
].join("\n");

function createRecognizer(
  recognize: TooltipRecognizer["recognize"] = vi
    .fn()
    .mockResolvedValue(attachedTooltipText),
): TooltipRecognizer & {
  recognize: ReturnType<typeof vi.fn<TooltipRecognizer["recognize"]>>;
  terminate: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  return {
    recognize: recognize as ReturnType<
      typeof vi.fn<TooltipRecognizer["recognize"]>
    >,
    terminate: vi.fn().mockResolvedValue(undefined),
  };
}

function renderPanel(
  recognizer: TooltipRecognizer,
  onApply = vi.fn(),
  panelTarget = target,
) {
  return render(
    <EquipmentOcrPanel
      target={panelTarget}
      onApply={onApply}
      createRecognizer={() => recognizer}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EquipmentOcrPanel", () => {
  it("recognizes a selected screenshot and shows the editable stat proposal", async () => {
    const user = userEvent.setup();
    const recognizer = createRecognizer();
    renderPanel(recognizer);

    const file = new File(["screenshot"], "overall.png", {
      type: "image/png",
    });
    await user.upload(screen.getByLabelText("장비 스크린샷 파일"), file);

    await waitFor(() => {
      expect(recognizer.recognize).toHaveBeenCalledWith(
        file,
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          onProgress: expect.any(Function),
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByLabelText("OCR DEX")).toHaveValue(21);
      expect(screen.getByLabelText("OCR STR")).toHaveValue(10);
      expect(screen.getByLabelText("OCR DEX%")).toHaveValue(21);
      expect(screen.getByLabelText("OCR STR%")).toHaveValue(null);
    });
  });

  it("keeps the proposal review-only until Apply passes its target and replacement", async () => {
    const user = userEvent.setup();
    const recognizer = createRecognizer();
    const onApply = vi.fn();
    renderPanel(recognizer, onApply);

    await user.upload(
      screen.getByLabelText("장비 스크린샷 파일"),
      new File(["screenshot"], "overall.png", { type: "image/png" }),
    );
    await screen.findByLabelText("OCR DEX");
    expect(onApply).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "인식값 적용" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(target, {
      mainFlat: "21",
      subFlat: "10",
      mainPercent: "21",
      subPercent: "",
    });
  });

  it("claims image paste but leaves text-only paste alone", async () => {
    const recognizer = createRecognizer();
    renderPanel(recognizer);
    const pasteZone = screen.getByLabelText("장비 스크린샷 붙여넣기");

    const image = new File(["screenshot"], "clipboard.png", {
      type: "image/png",
    });
    const imageItem = {
      kind: "file",
      type: "image/png",
      getAsFile: () => image,
    } as DataTransferItem;
    const imagePaste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(imagePaste, "clipboardData", {
      value: { items: [imageItem], files: [image] },
    });
    const imagePreventDefault = vi.spyOn(imagePaste, "preventDefault");
    pasteZone.dispatchEvent(imagePaste);

    await waitFor(() => expect(recognizer.recognize).toHaveBeenCalledTimes(1));
    expect(imagePreventDefault).toHaveBeenCalledTimes(1);

    const textPaste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(textPaste, "clipboardData", {
      value: {
        items: [{ kind: "string", type: "text/plain" }],
        files: [],
      },
    });
    const textPreventDefault = vi.spyOn(textPaste, "preventDefault");
    pasteZone.dispatchEvent(textPaste);

    expect(recognizer.recognize).toHaveBeenCalledTimes(1);
    expect(textPreventDefault).not.toHaveBeenCalled();
  });

  it("aborts cancellation and ignores a stale recognition result", async () => {
    const user = userEvent.setup();
    const pending: Array<{
      file: File;
      signal: AbortSignal;
      resolve: (text: string) => void;
    }> = [];
    const recognizer = createRecognizer(
      vi.fn((file, { signal }) => new Promise<string>((resolve) => {
        pending.push({ file, signal, resolve });
      })),
    );
    renderPanel(recognizer);
    const fileInput = screen.getByLabelText("장비 스크린샷 파일");

    const firstFile = new File(["first"], "first.png", { type: "image/png" });
    await user.upload(fileInput, firstFile);
    await waitFor(() => expect(pending).toHaveLength(1));
    const firstSignal = pending[0].signal;

    await user.click(screen.getByRole("button", { name: "OCR 취소" }));
    expect(firstSignal.aborted).toBe(true);
    expect(screen.queryByLabelText("OCR DEX")).not.toBeInTheDocument();

    const secondFile = new File(["second"], "second.png", {
      type: "image/png",
    });
    await user.upload(fileInput, secondFile);
    await waitFor(() => expect(pending).toHaveLength(2));

    pending[0].resolve(attachedTooltipText);
    await Promise.resolve();
    expect(screen.queryByLabelText("OCR DEX")).not.toBeInTheDocument();

    pending[1].resolve(
      ["STR +4", "DEX +30", "DEX +12%"].join("\n"),
    );
    await waitFor(() => expect(screen.getByLabelText("OCR DEX")).toHaveValue(30));
    expect(screen.getByLabelText("OCR STR")).toHaveValue(4);
    expect(screen.getByLabelText("OCR DEX%")).toHaveValue(12);
  });

  it("supersedes a pending job when a second image is selected and only applies the second result", async () => {
    const user = userEvent.setup();
    const pending: Array<{
      file: File;
      signal: AbortSignal;
      resolve: (text: string) => void;
    }> = [];
    const recognizer = createRecognizer(
      vi.fn((file, { signal }) => new Promise<string>((resolve) => {
        pending.push({ file, signal, resolve });
      })),
    );
    const onApply = vi.fn();
    renderPanel(recognizer, onApply);
    const fileInput = screen.getByLabelText("장비 스크린샷 파일");
    const firstFile = new File(["first"], "first.png", { type: "image/png" });
    const secondFile = new File(["second"], "second.png", { type: "image/png" });

    await user.upload(fileInput, firstFile);
    await waitFor(() => expect(pending).toHaveLength(1));
    await user.upload(fileInput, secondFile);
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0].signal.aborted).toBe(true);

    pending[0].resolve(attachedTooltipText);
    await Promise.resolve();
    expect(screen.queryByLabelText("OCR DEX")).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();

    pending[1].resolve(["STR +4", "DEX +30", "DEX +12%"].join("\n"));
    await waitFor(() => expect(screen.getByLabelText("OCR DEX")).toHaveValue(30));
    await user.click(screen.getByRole("button", { name: "인식값 적용" }));

    expect(onApply).toHaveBeenCalledWith(target, {
      mainFlat: "30",
      subFlat: "4",
      mainPercent: "12",
      subPercent: "",
    });
  });

  it("cancels without applying a pending proposal", async () => {
    const user = userEvent.setup();
    let resolveRecognition: ((text: string) => void) | undefined;
    const recognizer = createRecognizer(
      vi.fn((file, { signal }) => new Promise<string>((resolve) => {
        resolveRecognition = resolve;
        signal.addEventListener("abort", () => undefined, { once: true });
      })),
    );
    const onApply = vi.fn();
    renderPanel(recognizer, onApply);

    await user.upload(
      screen.getByLabelText("장비 스크린샷 파일"),
      new File(["pending"], "pending.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "OCR 취소" }));
    resolveRecognition?.(attachedTooltipText);
    await Promise.resolve();

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("OCR DEX")).not.toBeInTheDocument();
  });

  it("resets the file input so selecting the same screenshot starts a second job", async () => {
    const user = userEvent.setup();
    const recognizer = createRecognizer();
    renderPanel(recognizer);
    const fileInput = screen.getByLabelText("장비 스크린샷 파일") as HTMLInputElement;
    const file = new File(["same"], "same.png", { type: "image/png" });

    await user.upload(fileInput, file);
    expect(fileInput.value).toBe("");
    await waitFor(() => expect(recognizer.recognize).toHaveBeenCalledTimes(1));
    await user.upload(fileInput, file);
    await waitFor(() => expect(recognizer.recognize).toHaveBeenCalledTimes(2));
  });

  it("revokes the preview URL once when recognition completes and when the panel unmounts", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:equipment-ocr");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const recognizer = createRecognizer();
    const view = renderPanel(recognizer);

    await user.upload(
      screen.getByLabelText("장비 스크린샷 파일"),
      new File(["preview"], "preview.png", { type: "image/png" }),
    );
    await screen.findByLabelText("OCR DEX");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:equipment-ocr");
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("revokes a pending preview URL when the panel unmounts", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pending-ocr");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const recognizer = createRecognizer(
      vi.fn(() => new Promise<string>(() => undefined)),
    );
    const view = renderPanel(recognizer);

    await user.upload(
      screen.getByLabelText("장비 스크린샷 파일"),
      new File(["pending-preview"], "pending-preview.png", { type: "image/png" }),
    );
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    view.unmount();

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:pending-ocr");
  });

  it("retries a retryable recognition failure and shows the successful proposal", async () => {
    const user = userEvent.setup();
    const recognizer = createRecognizer(
      vi.fn()
        .mockRejectedValueOnce(new Error("temporary OCR failure"))
        .mockResolvedValueOnce(attachedTooltipText),
    );
    renderPanel(recognizer);
    const file = new File(["retry"], "retry.png", { type: "image/png" });

    await user.upload(screen.getByLabelText("장비 스크린샷 파일"), file);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("읽지 못했습니다"));
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.getByLabelText("OCR DEX")).toHaveValue(21));
    expect(recognizer.recognize).toHaveBeenCalledTimes(2);
  });

  it("passes edited proposal values to Apply", async () => {
    const user = userEvent.setup();
    const recognizer = createRecognizer();
    const onApply = vi.fn();
    renderPanel(recognizer, onApply);

    await user.upload(
      screen.getByLabelText("장비 스크린샷 파일"),
      new File(["edit"], "edit.png", { type: "image/png" }),
    );
    await screen.findByLabelText("OCR DEX");
    await user.clear(screen.getByLabelText("OCR DEX"));
    await user.type(screen.getByLabelText("OCR DEX"), "99");
    await user.clear(screen.getByLabelText("OCR STR%"));
    await user.type(screen.getByLabelText("OCR STR%"), "7.5");
    await user.click(screen.getByRole("button", { name: "인식값 적용" }));

    expect(onApply).toHaveBeenCalledWith(target, {
      mainFlat: "99",
      subFlat: "10",
      mainPercent: "21",
      subPercent: "7.5",
    });
  });

  it("invalidates a pending result when the target job or slot changes", async () => {
    const pending: Array<{
      signal: AbortSignal;
      resolve: (text: string) => void;
    }> = [];
    const recognizer = createRecognizer(
      vi.fn((_file, { signal }) => new Promise<string>((resolve) => {
        pending.push({ signal, resolve });
      })),
    );
    const onApply = vi.fn();
    const view = renderPanel(recognizer, onApply, target);
    await userEvent.setup().upload(
      screen.getByLabelText("장비 스크린샷 파일"),
      new File(["target-change"], "target-change.png", { type: "image/png" }),
    );
    await waitFor(() => expect(pending).toHaveLength(1));

    const nextTarget: OcrTarget = { job: "night_lord", slot: "hat" };
    view.rerender(
      <EquipmentOcrPanel
        target={nextTarget}
        onApply={onApply}
        createRecognizer={() => recognizer}
      />,
    );
    expect(pending[0].signal.aborted).toBe(true);
    pending[0].resolve(attachedTooltipText);
    await Promise.resolve();

    expect(screen.queryByLabelText("OCR LUK")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("OCR DEX")).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("keeps the exact 12 MiB image and rejects one byte over", async () => {
    const user = userEvent.setup();
    const recognizer = createRecognizer();
    const view = renderPanel(recognizer);
    const exactBoundary = new File(
      [new Uint8Array(12 * 1024 * 1024)],
      "exact.png",
      { type: "image/png" },
    );
    await user.upload(screen.getByLabelText("장비 스크린샷 파일"), exactBoundary);
    await waitFor(() => expect(recognizer.recognize).toHaveBeenCalledTimes(1));

    view.unmount();
    renderPanel(recognizer);
    const overBoundary = new File(
      [new Uint8Array(12 * 1024 * 1024 + 1)],
      "over.png",
      { type: "image/png" },
    );
    await user.upload(screen.getByLabelText("장비 스크린샷 파일"), overBoundary);
    expect(screen.getByRole("alert")).toHaveTextContent("이미지가 너무 큽니다");
    expect(recognizer.recognize).toHaveBeenCalledTimes(1);
  });

  it("keeps the clipped native file input out of the tab order", () => {
    const recognizer = createRecognizer();
    renderPanel(recognizer);

    expect(screen.getByLabelText("장비 스크린샷 파일")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "스크린샷 선택" })).not.toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("announces unsupported and oversized image errors without recognition", async () => {
    const user = userEvent.setup();
    const recognizer = createRecognizer();
    const { unmount } = renderPanel(recognizer);
    const fileInput = screen.getByLabelText("장비 스크린샷 파일");

    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["not an image"], "overall.gif", { type: "image/gif" }),
        ],
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("지원되지 않는 이미지 형식");
    expect(recognizer.recognize).not.toHaveBeenCalled();

    unmount();
    renderPanel(recognizer);
    await user.upload(
      screen.getByLabelText("장비 스크린샷 파일"),
      new File([new Uint8Array(12 * 1024 * 1024 + 1)], "large.png", {
        type: "image/png",
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("이미지가 너무 큽니다");
    expect(recognizer.recognize).not.toHaveBeenCalled();
  });

  it("does not claim a paste when clipboardData has no image file", () => {
    const recognizer = createRecognizer();
    renderPanel(recognizer);
    const pasteZone = screen.getByLabelText("장비 스크린샷 붙여넣기");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        items: [],
        files: [new File(["text"], "notes.txt", { type: "text/plain" })],
      },
    });
    const preventDefault = vi.spyOn(paste, "preventDefault");

    fireEvent(pasteZone, paste);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(recognizer.recognize).not.toHaveBeenCalled();
  });
});
