import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { serializeSetup, STORAGE_KEY } from "@/features/calculator/storage";
beforeEach(()=>localStorage.clear());
afterEach(()=>vi.restoreAllMocks());
it("shows level/STR deficits on the slot and editor, preserves gear and marks results hypothetical",async()=>{
  const input=createDefaultInput("corsair");Object.assign(input.character,{level:"120",pureMain:"600",pureSub:"22",mapleWarrior:0});
  Object.assign(input.equipment.weapon!,{requiredLevel:"130",requiredSub:"50",subFlat:"100",subPercent:"100",attackFlat:"100"});
  const original=serializeSetup(input);localStorage.setItem(STORAGE_KEY,original);
  render(<CalculatorApp/>);const user=userEvent.setup();await waitFor(()=>expect(screen.getByLabelText("레벨",{exact:true})).toHaveValue(120));
  await user.click(screen.getByRole("button",{name:"무기 편집"}));
  const editor=screen.getByRole("region",{name:"무기 옵션"});
  expect(within(editor).getByText(/레벨 10 부족/)).toBeVisible();
  expect(screen.getByRole("button",{name:"무기 편집"})).toHaveTextContent("착용 불가");
  fireEvent.change(screen.getByLabelText("레벨",{exact:true}),{target:{value:"130"}});
  expect(within(editor).getByText(/28 부족/)).toBeVisible();
  expect(screen.getByRole("complementary",{name:"계산 결과"})).toHaveTextContent("가정값");
  expect(screen.getByLabelText("무기 STR",{exact:true})).toHaveValue(100);
  expect(localStorage.getItem(STORAGE_KEY)).toBe(original);
  await user.click(screen.getByRole("button",{name:"펜던트 1 편집"}));
  for(const [label,value] of [["펜던트 1 요구 레벨","0"],["펜던트 1 요구 STR","0"],["펜던트 1 STR","28"]])fireEvent.change(screen.getByLabelText(label,{exact:true}),{target:{value}});
  expect(screen.getByRole("button",{name:"무기 편집"})).not.toHaveTextContent("착용 불가");
});

it("keeps unrecognized conditions quiet and only flags the actual failing gear",async()=>{
  const input=createDefaultInput("corsair");Object.assign(input.character,{level:"120",pureMain:"600",pureSub:"22",mapleWarrior:0});
  Object.assign(input.equipment.hat!,{subFlat:"28"});Object.assign(input.equipment.weapon!,{attackFlat:"100",requiredSub:"50"});
  localStorage.setItem(STORAGE_KEY,serializeSetup(input));render(<CalculatorApp/>);
  await waitFor(()=>expect(screen.getByLabelText("레벨",{exact:true})).toHaveValue(120));
  expect(screen.queryByText(/착용 조건 확인 필요/)).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"모자 편집"})).toHaveTextContent("입력 완료");expect(screen.getByRole("button",{name:"무기 편집"})).toHaveTextContent("입력 완료");
  await userEvent.click(screen.getByRole("button",{name:"모자 편집"}));fireEvent.change(screen.getByLabelText("모자 STR",{exact:true}),{target:{value:"10"}});
  expect(screen.getByRole("button",{name:"무기 편집"})).toHaveTextContent("착용 불가");expect(screen.getByRole("button",{name:"모자 편집"})).not.toHaveTextContent("착용 불가");
  await userEvent.click(screen.getByRole("button",{name:"무기 편집"}));expect(screen.getByRole("region",{name:"무기 옵션"})).toHaveTextContent("18 부족");
});

it("uses OCR REQ STR automatically and warns only when the supporting STR falls short",async()=>{
  const recognition=await import("@/features/calculator/ocr/recognizeTooltip.client");
  vi.spyOn(recognition,"createBrowserTooltipRecognizer").mockImplementation(()=>({recognize:vi.fn().mockResolvedValue("REQ LEU : 120\nREQ STR : 50\nSTR +100\n공격력 +100"),terminate:vi.fn().mockResolvedValue(undefined)}));
  const input=createDefaultInput("corsair");Object.assign(input.character,{level:"120",pureMain:"600",pureSub:"22",mapleWarrior:0});input.equipment.hat!.subFlat="28";
  localStorage.setItem(STORAGE_KEY,serializeSetup(input));render(<CalculatorApp/>);const user=userEvent.setup();
  await waitFor(()=>expect(screen.getByLabelText("레벨",{exact:true})).toHaveValue(120));await user.click(screen.getByRole("button",{name:"무기 편집"}));
  await user.upload(screen.getByLabelText("장비 스크린샷 파일"),new File(["mock"],"weapon.png",{type:"image/png"}));
  expect(await screen.findByLabelText("OCR 요구 STR")).toHaveValue(50);expect(screen.getByLabelText("OCR 요구 레벨")).toHaveValue(120);
  await user.click(screen.getByRole("button",{name:"인식값 적용"}));
  expect(screen.getByLabelText("무기 요구 STR")).toHaveValue(50);expect(screen.getByRole("button",{name:"무기 편집"})).not.toHaveTextContent("착용 불가");
  await user.click(screen.getByRole("button",{name:"모자 편집"}));fireEvent.change(screen.getByLabelText("모자 STR"),{target:{value:"27"}});
  await user.click(screen.getByRole("button",{name:"무기 편집"}));expect(screen.getByRole("region",{name:"무기 옵션"})).toHaveTextContent("1 부족");
});
