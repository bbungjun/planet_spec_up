import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { CAPTAIN_BETA_STORAGE_KEY, DEVELOPMENT_STORAGE_KEY, serializeSetup } from "@/features/calculator/storage";
import { createDefaultInput } from "@/features/calculator/domain/defaults";

afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });

it("keeps an empty Aran beta clean until the user changes its own input", async () => {
  render(<CalculatorApp aranBeta />);
  await waitFor(() => expect(screen.getByRole("button", { name: "저장" })).toBeEnabled());
  const blocked = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(blocked()).toBe(false);
  fireEvent.change(screen.getByLabelText("순수 STR"), { target: { value: "800" } });
  expect(blocked()).toBe(true);
});

it("switches to Aran, auto derives combo critical and saves to an isolated development key", async () => {
  const captain=serializeSetup(createDefaultInput("corsair"));
  window.localStorage.setItem(CAPTAIN_BETA_STORAGE_KEY,captain);
  vi.spyOn(window,"confirm").mockReturnValue(true);
  render(<CalculatorApp development />);
  const job=screen.getByLabelText("직업"); await waitFor(()=>expect(job).not.toBeDisabled());
  fireEvent.change(job,{target:{value:"aran"}});
  expect(screen.getByLabelText("순수 STR")).toBeInTheDocument();
  expect(screen.queryByLabelText("불릿·표창 공격력")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("순수 STR"),{target:{value:"800"}});
  fireEvent.change(screen.getByLabelText("순수 DEX"),{target:{value:"4"}});
  fireEvent.click(screen.getByRole("button",{name:"무기 편집"}));
  fireEvent.change(screen.getByLabelText("무기 공격력"),{target:{value:"100"}});
  expect(screen.getByLabelText("콤보 크리티컬20 적용")).toBeChecked();
  fireEvent.change(screen.getByLabelText("현재 콤보"),{target:{value:"100"}});
  const criticalLine = () => [...document.querySelectorAll("small")].map(node => node.textContent).find(text => text?.startsWith("기본 ") && text.includes("장비 "));
  expect(criticalLine()).toBe("기본 70 + 장비 0 + 기타 0 + 버프 10");
  fireEvent.click(screen.getByRole("button",{name:"저장"}));
  await waitFor(()=>expect(window.localStorage.getItem(DEVELOPMENT_STORAGE_KEY)).toContain('"aranCombo":"100"'));
  expect(window.localStorage.getItem(CAPTAIN_BETA_STORAGE_KEY)).toBe(captain);
  const saved=window.localStorage.getItem(DEVELOPMENT_STORAGE_KEY);
  const weaponConstant=screen.getByLabelText("폴암 계수 (참고 가정)");
  expect(document.querySelectorAll("#character-aranWeaponConstant")).toHaveLength(1);
  fireEvent.change(weaponConstant,{target:{value:"11"}});
  expect(screen.queryByLabelText("시뮬레이션 스탯 공격력 결과")).not.toBeInTheDocument();
  expect(screen.getByRole("region",{name:"확인할 항목"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"저장"}));
  expect(window.localStorage.getItem(DEVELOPMENT_STORAGE_KEY)).toBe(saved);
  fireEvent.change(weaponConstant,{target:{value:"5"}});
  expect(screen.getByLabelText("시뮬레이션 스탯 공격력 결과")).not.toHaveTextContent("—");
  fireEvent.change(screen.getByLabelText("현재 콤보"),{target:{value:"0"}});
  expect(criticalLine()).toBe("기본 10 + 장비 0 + 기타 0 + 버프 10");
});
