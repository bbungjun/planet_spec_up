import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { STORAGE_KEY, serializeSetup } from "@/features/calculator/storage";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import type { StatRecognition } from "@/features/calculator/ocr/parseStatWindow";
const recognize=vi.hoisted(()=>vi.fn());
vi.mock("@/features/calculator/ocr/recognizeStatWindow.client",()=>({recognizeStatWindow:recognize}));
const recognized:StatRecognition={draft:{job:"corsair",level:200,pure:{DEX:1000,STR:22,INT:4,LUK:4},total:{DEX:2306,STR:83,INT:7,LUK:7},maxAttack:15000,bossDamagePercent:5},warnings:[],automatic:true};
beforeEach(()=>{localStorage.clear();recognize.mockReset();vi.stubGlobal("URL",Object.assign(URL,{createObjectURL:vi.fn(()=>"blob:test"),revokeObjectURL:vi.fn()}));});
async function upload(){const control=screen.getByLabelText("능력창 사진 선택");await waitFor(()=>expect(control).toBeEnabled());fireEvent.change(control,{target:{files:[new File(["pixels"],"stats.png",{type:"image/png"})]}});}
it("automatically persists verified base stats, preserves equipment, and displays mismatches",async()=>{
  const input=createDefaultInput("corsair");input.equipment.weapon!.attackFlat="100";input.character.guildBossPercent="5";
  localStorage.setItem(STORAGE_KEY,serializeSetup(input));recognize.mockResolvedValue(recognized);
  render(<CalculatorApp/>);await upload();
  await waitFor(()=>expect(screen.getByLabelText("능력창 인식 상태")).toHaveTextContent("저장했습니다"));
  const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)!);
  expect(saved.input.character).toMatchObject({pureMain:"1000",pureSub:"22",level:"200",guildBossPercent:"5"});
  expect(saved.input.equipment.weapon.attackFlat).toBe("100");
  expect(saved.input.character.bossDamagePercent).toBeUndefined();
  expect(screen.getByRole("table",{name:"능력창과 현재 계산 비교"})).toHaveTextContent("차이");
});
it("requires review for uncertain numbers and keeps review and prior state on save failure",async()=>{
  const input=createDefaultInput("corsair");const original=serializeSetup(input);localStorage.setItem(STORAGE_KEY,original);
  recognize.mockResolvedValue({...recognized,automatic:false,warnings:["원본 확인 필요"]});render(<CalculatorApp/>);await upload();
  const button=await screen.findByRole("button",{name:"확인하고 능력창 저장"});
  expect(localStorage.getItem(STORAGE_KEY)).toBe(original);
  const fail=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("quota");});
  await userEvent.click(button);
  expect(screen.getByLabelText("능력창 인식 상태")).toHaveTextContent("저장하지 못했습니다");
  expect(screen.getByLabelText("레벨",{exact:true})).toHaveValue(160);
  expect(button).toBeInTheDocument();fail.mockRestore();
  await userEvent.click(button);
  expect(screen.getByLabelText("레벨",{exact:true})).toHaveValue(200);
});
it("ignores late OCR after cancellation",async()=>{
  let finish!:(r:StatRecognition)=>void;
  recognize.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<CalculatorApp/>);await upload();
  await userEvent.click(screen.getByRole("button",{name:"능력창 인식 취소"}));finish(recognized);
  await waitFor(()=>expect(screen.getByLabelText("능력창 인식 상태")).toHaveTextContent("취소"));
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();expect(screen.getByLabelText("레벨",{exact:true})).toHaveValue(160);
});
it("validates direct guild ranges in the upper panel",async()=>{
  render(<CalculatorApp/>);await waitFor(()=>expect(screen.getByLabelText("길드 공격력")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("길드 공격력"),{target:{value:"6"}});
  expect(screen.getByLabelText("길드 공격력")).toHaveAttribute("aria-invalid","true");
  fireEvent.change(screen.getByLabelText("레벨",{exact:true}),{target:{value:"220"}});
  expect(screen.getByLabelText("레벨 달성 버프")).toHaveTextContent("+10");
  expect(screen.getByLabelText("레벨 달성 버프")).toHaveTextContent("+15");
});

const statImage=(name="stats.png",type="image/png")=>new File([name],name,{type});
const pasteImages=(target:Element,files=[statImage()])=>fireEvent.paste(target,{clipboardData:{items:[],files}});
it("pastes a stat image into its focused area without starting equipment OCR",async()=>{
  recognize.mockResolvedValue(recognized);render(<CalculatorApp/>);
  await waitFor(()=>expect(screen.getByLabelText("능력창 사진 선택")).toBeEnabled());
  const file=statImage();
  fireEvent.paste(screen.getByRole("group",{name:"능력창 사진 붙여넣기"}),{clipboardData:{items:[{kind:"file",getAsFile:()=>file}],files:[]}});
  await waitFor(()=>expect(screen.getByLabelText("능력창 인식 상태")).toHaveTextContent("저장했습니다"));
  expect(recognize).toHaveBeenCalledTimes(1);expect(recognize.mock.calls[0][0]).toBe(file);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).input.character.pureMain).toBe("1000");
  expect(screen.queryByRole("region",{name:"여러 장비 인식 목록"})).not.toBeInTheDocument();
});

it("preserves a review on multiple or unsupported image paste and leaves text paste native",async()=>{
  recognize.mockResolvedValue({...recognized,automatic:false});render(<CalculatorApp/>);await upload();
  const pure=await screen.findByLabelText("DEX 순수");fireEvent.change(pure,{target:{value:"1001"}});
  const zone=screen.getByRole("group",{name:"능력창 사진 붙여넣기"});
  pasteImages(zone,[statImage("a.png"),statImage("b.png")]);
  expect(screen.getByLabelText("능력창 인식 상태")).toHaveTextContent("한 장씩");
  pasteImages(zone,[statImage("bad.gif","image/gif")]);
  expect(screen.getByLabelText("능력창 인식 상태")).toHaveTextContent("PNG/JPG/WebP");
  expect(pure).toHaveValue(1001);expect(recognize).toHaveBeenCalledTimes(1);
  expect(fireEvent.paste(pure,{clipboardData:{items:[],files:[],getData:()=>"1002"}})).toBe(true);
  expect(recognize).toHaveBeenCalledTimes(1);expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});

it("does not duplicate a busy paste and drops cancelled results after a newer paste",async()=>{
  let finish!:(value:StatRecognition)=>void;
  recognize.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce(recognized);
  render(<CalculatorApp/>);await waitFor(()=>expect(screen.getByLabelText("능력창 사진 선택")).toBeEnabled());
  const zone=screen.getByRole("group",{name:"능력창 사진 붙여넣기"});
  pasteImages(zone);pasteImages(zone,[statImage("second.png")]);
  expect(recognize).toHaveBeenCalledTimes(1);expect(recognize.mock.calls[0][1].aborted).toBe(false);
  expect(screen.queryByRole("region",{name:"여러 장비 인식 목록"})).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button",{name:"능력창 인식 취소"}));
  pasteImages(zone,[statImage("latest.png")]);
  await waitFor(()=>expect(screen.getByLabelText("능력창 인식 상태")).toHaveTextContent("저장했습니다"));
  finish({...recognized,draft:{...recognized.draft,pure:{...recognized.draft.pure,DEX:900}}});
  await Promise.resolve();
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).input.character.pureMain).toBe("1000");
});
