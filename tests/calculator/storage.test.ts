import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { deserializeSetup, serializeSetup } from "@/features/calculator/storage";
import { useSavedSetup } from "@/features/calculator/hooks/useSavedSetup";

it("round-trips schema version one", () => {
  const input = createDefaultInput("marksman");
  const encoded = serializeSetup(input, "2026-07-27T00:00:00.000Z");

  expect(deserializeSetup(encoded)).toMatchObject({
    ok: true,
    value: { schemaVersion: 1, savedAt: "2026-07-27T00:00:00.000Z", input },
  });
});

it("rejects corrupt, unsupported, and partial data without merging", () => {
  const input = createDefaultInput("corsair");
  const partialInput = {
    ...input,
    character: { ...input.character },
  };
  delete (partialInput.character as Partial<typeof input.character>).level;

  expect(deserializeSetup("{bad")).toMatchObject({ ok: false });
  expect(deserializeSetup(JSON.stringify({ schemaVersion: 2 }))).toMatchObject({ ok: false });
  expect(deserializeSetup(JSON.stringify({
    schemaVersion: 1,
    savedAt: "2026-07-27T00:00:00.000Z",
    input: partialInput,
  }))).toMatchObject({ ok: false });
});

it("saves, loads, and clears its one storage slot through callbacks", () => {
  window.localStorage.clear();
  const input = createDefaultInput("night_lord");
  const { result } = renderHook(() => useSavedSetup());

  expect(result.current.load()).toEqual({ ok: false, message: "empty" });

  act(() => result.current.save(input));
  expect(result.current.load()).toMatchObject({ ok: true, value: { input } });

  act(() => result.current.clear());
  expect(result.current.load()).toEqual({ ok: false, message: "empty" });
});
