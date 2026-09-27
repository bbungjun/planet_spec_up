import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { render,screen,within,waitFor,fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { STORAGE_KEY,serializeSetup } from "@/features/calculator/storage";
import * as recognition from "@/features/calculator/ocr/recognizeTooltip.client";
import type { StatRecognition } from "@/features/calculator/ocr/parseStatWindow";
const recognize=vi.fn<recognition.TooltipRecognizer["recognize"]>();
const image=()=>new File(["fake pixels"],"candidate.png",{type:"image/png"});
function seed(){const input=createDefaultInput("corsair");Object.assign(input.character,{level:"120",pureMain:"600",pureSub:"22",mapleWarrior:0,guildAttackFlat:"0",guildBossPercent:"0",guildIgnorePercent:"0"});Object.assign(input.equipment.weapon!,{attackFlat:"100",requiredLevel:"0",requiredSub:"0",bossDamagePercent:"50"});localStorage.setItem(STORAGE_KEY,serializeSetup(input));return input;}
const panel=()=>screen.getByRole("region",{name:"구매 후보 비교"});
beforeEach(()=>{localStorage.clear();recognize.mockReset().mockResolvedValue("장비분류: 건\nREQ LEV: 0\nREQ STR: 0\n공격력 +110");vi.spyOn(recognition,"createBrowserTooltipRecognizer").mockImplementation(()=>({recognize,terminate:vi.fn().mockResolvedValue(undefined)}));});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
async function add(name="후보 A"){
 const user=userEvent.setup();
 await waitFor(()=>expect(within(panel()).getByRole("button",{name:"비교 카드 추가"})).toBeEnabled());
 await user.click(within(panel()).getByRole("button",{name:"비교 카드 추가"}));
 const area=within(screen.getByRole("dialog",{name:"비교할 장비 추가"}));
 expect(area.queryByLabelText("교체할 장비 부위")).not.toBeInTheDocument();expect(area.queryByLabelText("새 후보 이름")).not.toBeInTheDocument();
 const implementation=recognize.getMockImplementation()!;
 recognize.mockImplementationOnce(async(...args)=>`${name}\n(에픽 아이템)\n${await implementation(...args)}`);
 await user.upload(area.getByLabelText("비교 후보 스크린샷"),image());
 await waitFor(()=>expect(area.getByLabelText("OCR 공격력")).toHaveValue(110));expect(area.getByRole("button",{name:"후보로 비교"})).toBeDisabled();
 await user.click(area.getByLabelText("원본의 모든 옵션을 확인했습니다"));await user.click(area.getByRole("button",{name:"후보로 비교"}));return user;
}
it("OCR review creates temporary before/after comparisons and preserves original gear and saves",async()=>{
 seed();const saved=localStorage.getItem(STORAGE_KEY);render(<CalculatorApp/>);const user=await add();
 const card=screen.getByRole("article",{name:"후보 A 비교 결과"});expect(within(within(card).getByLabelText("선택 프리셋 비교")).getByLabelText("최대 스탯공 비교")).toHaveTextContent("2,182");expect(within(within(card).getByLabelText("선택 프리셋 비교")).getByLabelText("최대 스탯공 비교")).toHaveTextContent("2,400");
 expect(within(within(card).getByLabelText("선택 프리셋 비교")).getByLabelText("환산 공격력 비교")).toHaveTextContent("-873");
 expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
 await user.click(screen.getByRole("button",{name:"무기 편집"}));expect(screen.getByLabelText("무기 공격력",{exact:true})).toHaveValue(100);
 await user.click(screen.getByRole("button",{name:"저장"}));const stored=JSON.parse(localStorage.getItem(STORAGE_KEY)!);expect(stored.input.equipment.weapon.attackFlat).toBe("100");expect(stored.input.candidates).toBeUndefined();
 await user.type(within(card).getByLabelText("후보 A 구매 가격"),"0.3");expect(within(card).getByLabelText("후보 A 구매 가격")).toHaveValue(.3);
 expect(within(card).getByLabelText("후보 A 1억 메소당 환산공 상승률")).toHaveTextContent("-88.91%");
 fireEvent.change(within(card).getByLabelText("후보 A 구매 가격"),{target:{value:"0.6"}});
 expect(within(card).getByLabelText("후보 A 1억 메소당 환산공 상승률")).toHaveTextContent("-44.45%");
 fireEvent.change(within(card).getByLabelText("후보 A 구매 가격"),{target:{value:"0"}});
 expect(within(card).getByLabelText("후보 A 1억 메소당 환산공 상승률")).toHaveTextContent("—");
 await add("후보 B");expect(screen.getAllByRole("article")).toHaveLength(2);
 await user.click(screen.getByRole("button",{name:"후보 A 삭제"}));expect(screen.queryByRole("article",{name:"후보 A 비교 결과"})).not.toBeInTheDocument();
});
it("routes pasted candidate images from the dialog close-button focus without starting original registration",async()=>{
 seed();render(<CalculatorApp/>);await waitFor(()=>expect(within(panel()).getByRole("button",{name:"비교 카드 추가"})).toBeEnabled());
 await userEvent.click(within(panel()).getByRole("button",{name:"비교 카드 추가"}));
 screen.getByRole("button",{name:"비교할 장비 추가 닫기"}).focus();
 const textPaste=new Event("paste",{bubbles:true,cancelable:true});Object.defineProperty(textPaste,"clipboardData",{value:{items:[],files:[]}});fireEvent(document,textPaste);expect(textPaste.defaultPrevented).toBe(false);
 const file=image();fireEvent.paste(document,{clipboardData:{items:[{kind:"file",type:"image/png",getAsFile:()=>file}],files:[file]}});
 await waitFor(()=>expect(recognize).toHaveBeenCalledTimes(1));expect(screen.queryByRole("region",{name:"여러 장비 인식 목록"})).not.toBeInTheDocument();
});
it("ignores late candidate OCR after changing its combat preset",async()=>{
 let finish!:(value:string)=>void;recognize.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));seed();render(<CalculatorApp/>);const user=userEvent.setup();
 await waitFor(()=>expect(within(panel()).getByRole("button",{name:"비교 카드 추가"})).toBeEnabled());
 await user.click(within(panel()).getByRole("button",{name:"비교 카드 추가"}));
 const area=within(screen.getByRole("dialog",{name:"비교할 장비 추가"}));
 await user.upload(area.getByLabelText("비교 후보 스크린샷"),image());await user.selectOptions(screen.getByLabelText("비교 전투 프리셋"),"chaos");finish("DEX +999");
 await waitFor(()=>expect(area.queryByRole("button",{name:"후보로 비교"})).not.toBeInTheDocument());expect(screen.queryByRole("article")).not.toBeInTheDocument();
});
it("adds three independent cards through plus, edits one, removes another, and keeps the baseline",async()=>{
 seed();render(<CalculatorApp/>);const user=await add("비교 A");await add("비교 B");await add("비교 C");
 expect(screen.getAllByRole("article")).toHaveLength(3);
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
 const baseline=screen.getByRole("group",{name:"현재 장비 비교 기준"});expect(baseline).toHaveTextContent("2,182");
 await user.click(screen.getByRole("button",{name:"비교 B 상세 보기"}));
 const editor=screen.getByRole("dialog",{name:"비교 B 상세"});
 fireEvent.change(within(editor).getByLabelText("비교 B 공격력",{exact:true}),{target:{value:"120"}});
 fireEvent(editor,new Event("cancel",{cancelable:true}));
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
 const cardB=screen.getByRole("article",{name:"비교 B 비교 결과"});expect(within(cardB).getByLabelText("최대 스탯공 비교")).toHaveTextContent("2,618");
 expect(within(screen.getByRole("article",{name:"비교 A 비교 결과"})).getByLabelText("최대 스탯공 비교")).toHaveTextContent("2,400");
 await user.click(screen.getByRole("button",{name:"비교 A 삭제"}));expect(screen.getAllByRole("article")).toHaveLength(2);expect(baseline).toHaveTextContent("2,182");
 const source=JSON.parse(localStorage.getItem(STORAGE_KEY)!);expect(source.input.equipment.weapon.attackFlat).toBe("100");
});
it("closes an unfinished import with Escape and ignores its late result",async()=>{
 let finish!:(value:string)=>void;recognize.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));seed();render(<CalculatorApp/>);
 await waitFor(()=>expect(screen.getByRole("button",{name:"비교 후보 추가"})).toBeEnabled());
 const trigger=screen.getByRole("button",{name:"비교 후보 추가"});await userEvent.click(trigger);
 const dialog=screen.getByRole("dialog",{name:"비교할 장비 추가"});await userEvent.upload(within(dialog).getByLabelText("비교 후보 스크린샷"),image());fireEvent(dialog,new Event("cancel",{cancelable:true}));finish("공격력 +999");
 await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());expect(screen.queryByRole("article")).not.toBeInTheDocument();expect(trigger).toHaveFocus();
});

async function statRegistrationCase() {
  const input=seed();delete input.character.pureMain;delete input.character.pureSub;
  localStorage.setItem(STORAGE_KEY,serializeSetup(input));
  const stat=await import("@/features/calculator/ocr/recognizeStatWindow.client");
  vi.spyOn(stat,"recognizeStatWindow").mockResolvedValue({automatic:true,warnings:[],draft:{job:"corsair",level:120,pure:{DEX:600,STR:22,INT:4,LUK:4},total:{DEX:600,STR:22,INT:4,LUK:4},maxAttack:2182}});
  vi.stubGlobal("URL",class extends URL {static createObjectURL=vi.fn(()=>"blob:stat-test");static revokeObjectURL=vi.fn();});
  render(<CalculatorApp/>);const user=await add("대기 후보");const card=screen.getByRole("article",{name:"대기 후보 비교 결과"});
  await user.type(within(card).getByLabelText("대기 후보 구매 가격"),"4.1");
  expect(within(card).getByLabelText("최대 스탯공 비교")).not.toHaveTextContent("확인 필요");
  expect(within(card).getByText("기준 캐릭터의 순수 스탯이 필요합니다.")).toBeInTheDocument();
  expect(within(screen.getByRole("group",{name:"현재 장비 비교 기준"})).getByText("추정 기준")).toBeInTheDocument();
  await user.click(within(card).getByRole("button",{name:"능력창 사진 등록"}));
  return {card,user,dialog:screen.getByRole("dialog",{name:"능력창 등록"})};
}
it("registers the character from the blocked candidate and resumes that same comparison",async()=>{
  const {card,user,dialog}=await statRegistrationCase();
  await user.upload(within(dialog).getByLabelText("능력창 사진 선택"),image());
  await waitFor(()=>expect(screen.queryByRole("dialog",{name:"능력창 등록"})).not.toBeInTheDocument());
  expect(screen.getByRole("article",{name:"대기 후보 비교 결과"})).toBe(card);
  expect(within(card).getByLabelText("최대 스탯공 비교")).toHaveTextContent("2,400");
  expect(within(card).queryByRole("button",{name:"능력창 사진 등록"})).not.toBeInTheDocument();
  expect(within(card).getByLabelText("대기 후보 구매 가격")).toHaveValue(4.1);
  expect(within(card).getByLabelText("대기 후보 1억 메소당 환산공 상승률")).not.toHaveTextContent("—");
  const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)!);expect(saved.input.character).toMatchObject({pureMain:"600",pureSub:"22"});expect(saved.input.equipment.weapon.attackFlat).toBe("100");expect(saved.input.candidates).toBeUndefined();
});
it("keeps the candidate and stat registration review open if saving fails",async()=>{
  const {card,user,dialog}=await statRegistrationCase();const original=localStorage.getItem(STORAGE_KEY);
  const fail=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("quota");});
  await user.upload(within(dialog).getByLabelText("능력창 사진 선택"),image());
  await waitFor(()=>expect(within(dialog).getByLabelText("능력창 인식 상태")).toHaveTextContent("저장하지 못했습니다"));
  expect(localStorage.getItem(STORAGE_KEY)).toBe(original);expect(within(card).getByLabelText("대기 후보 구매 가격")).toHaveValue(4.1);
  fail.mockRestore();await user.click(within(dialog).getByRole("button",{name:"확인하고 능력창 저장"}));
  expect(screen.queryByRole("dialog",{name:"능력창 등록"})).not.toBeInTheDocument();expect(within(card).getByLabelText("최대 스탯공 비교")).toHaveTextContent("2,400");
});

it("pastes into the open stat dialog from its close-button focus and resumes the same candidate",async()=>{
  const {card,dialog}=await statRegistrationCase();
  const stat=await import("@/features/calculator/ocr/recognizeStatWindow.client");
  within(dialog).getByRole("button",{name:"능력창 등록 닫기"}).focus();
  fireEvent.paste(document,{clipboardData:{items:[],files:[image()]}});
  await waitFor(()=>expect(screen.queryByRole("dialog",{name:"능력창 등록"})).not.toBeInTheDocument());
  expect(stat.recognizeStatWindow).toHaveBeenCalledTimes(1);
  expect(recognize).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("region",{name:"여러 장비 인식 목록"})).not.toBeInTheDocument();
  expect(within(card).getByLabelText("최대 스탯공 비교")).toHaveTextContent("2,400");
  expect(within(card).getByLabelText("대기 후보 구매 가격")).toHaveValue(4.1);
});

it("releases the stat paste handler when the dialog closes and ignores its late OCR",async()=>{
  const {card,user,dialog}=await statRegistrationCase();
  const stat=await import("@/features/calculator/ocr/recognizeStatWindow.client");
  let finish!:(value:StatRecognition)=>void;
  vi.mocked(stat.recognizeStatWindow).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const original=localStorage.getItem(STORAGE_KEY);
  fireEvent.paste(document,{clipboardData:{items:[],files:[image()]}});
  const signal=vi.mocked(stat.recognizeStatWindow).mock.calls[0][1];
  await user.click(within(dialog).getByRole("button",{name:"능력창 등록 닫기"}));
  expect(signal.aborted).toBe(true);
  finish({automatic:true,warnings:[],draft:{job:"corsair",level:120,pure:{DEX:600,STR:22},total:{DEX:600,STR:22},maxAttack:2182}});
  await Promise.resolve();expect(localStorage.getItem(STORAGE_KEY)).toBe(original);
  expect(within(card).getByText("기준 캐릭터의 순수 스탯이 필요합니다.")).toBeInTheDocument();
  fireEvent.paste(document,{clipboardData:{items:[],files:[image()]}});
  await screen.findByRole("region",{name:"여러 장비 인식 목록"});
  expect(stat.recognizeStatWindow).toHaveBeenCalledTimes(1);
});

it("shows character main/sub/attack before-after values from the selected preset and candidate edits",async()=>{
  const input=seed();input.weaponPresets={active:"boss",entries:{chaos:{weapon:{...input.equipment.weapon!,attackFlat:"200"},monsterDefense:"80"}}};
  localStorage.setItem(STORAGE_KEY,serializeSetup(input));const saved=localStorage.getItem(STORAGE_KEY);
  recognize.mockResolvedValue("장비분류: 건\nREQ LEV: 0\nREQ STR: 0\n공격력 +110\nDEX +10\nSTR +2");
  render(<CalculatorApp/>);const user=await add("수치 후보");const card=screen.getByRole("article",{name:"수치 후보 비교 결과"});
  const table=within(card).getByRole("table",{name:"캐릭터 스탯 변경 전후"});
  const cells=(label:string)=>within(within(table).getByRole("row",{name:new RegExp(`^${label} `)})).getAllByRole("cell").map(cell=>cell.textContent);
  expect(cells("DEX")).toEqual(["600","610","+10"]);
  expect(cells("STR")).toEqual(["22","24","+2"]);
  expect(cells("공격력")).toEqual(["100","110","+10"]);
  await user.selectOptions(screen.getByLabelText("비교 전투 프리셋"),"chaos");
  expect(cells("공격력")).toEqual(["200","110","-90"]);
  await user.click(within(card).getByRole("button",{name:"수치 후보 상세 보기"}));
  const dialog=screen.getByRole("dialog",{name:"수치 후보 상세"});
  fireEvent.change(within(dialog).getByLabelText("수치 후보 공격력",{exact:true}),{target:{value:"220"}});
  fireEvent(dialog,new Event("cancel",{cancelable:true}));
  expect(cells("공격력")).toEqual(["200","220","+20"]);
  expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
});

it("shows the original on the card and opens a full preview without changing options or price",async()=>{
  vi.stubGlobal("URL",class extends URL {static createObjectURL=vi.fn((file:File)=>file.name==="tooltip.png"?"blob:tooltip-crop":"blob:original-candidate");static revokeObjectURL=vi.fn();});
  recognize.mockImplementation(async(_file,options)=>{options.onPrepared?.(new File(["tooltip pixels"],"tooltip.png",{type:"image/png"}));return "장비분류: 건\nREQ LEV: 0\nREQ STR: 0\n공격력 +110";});
  seed();const saved=localStorage.getItem(STORAGE_KEY);render(<CalculatorApp/>);const user=await add("사진 후보");
  const card=screen.getByRole("article",{name:"사진 후보 비교 결과"});
  expect(within(card).getByRole("img",{name:"사진 후보 원본 이미지"})).toHaveAttribute("src","blob:tooltip-crop");
  await user.type(within(card).getByLabelText("사진 후보 구매 가격"),"4.3");
  const trigger=within(card).getByRole("button",{name:"사진 후보 원본 이미지 확대"});await user.click(trigger);
  const dialog=screen.getByRole("dialog",{name:"사진 후보 원본 이미지"});
  expect(within(dialog).getByRole("img",{name:"사진 후보 원본 장비 이미지"})).toHaveAttribute("src","blob:tooltip-crop");
  expect(within(dialog).getByRole("link",{name:/전체 원본 열기/})).toHaveAttribute("href","blob:original-candidate");
  fireEvent(dialog,new Event("cancel",{cancelable:true}));
  expect(trigger).toHaveFocus();expect(within(card).getByLabelText("사진 후보 구매 가격")).toHaveValue(4.3);
  expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
});

it("keeps before-after character values unavailable for an unwearable candidate",async()=>{
  seed();recognize.mockResolvedValue("장비분류: 건\nREQ LEV: 0\nREQ STR: 9999\n공격력 +110");
  render(<CalculatorApp/>);await add("착용 불가 후보");
  const table=within(screen.getByRole("article",{name:"착용 불가 후보 비교 결과"})).getByRole("table",{name:"캐릭터 스탯 변경 전후"});
  expect(within(table).getAllByRole("cell").map(cell=>cell.textContent)).toEqual(Array(9).fill("—"));
});

async function importPhoto(text:string,price="0.3") {
  const user=userEvent.setup();recognize.mockResolvedValue(text);
  await user.click(await screen.findByRole("button",{name:"비교 후보 추가"}));
  const area=within(screen.getByRole("dialog",{name:"비교할 장비 추가"}));
  expect(area.queryByRole("combobox")).not.toBeInTheDocument();
  expect(area.queryByRole("textbox")).not.toBeInTheDocument();
  await user.type(area.getByLabelText("새 후보 구매 가격"),price);
  await user.upload(area.getByLabelText("비교 후보 스크린샷"),image());
  await waitFor(()=>expect(area.getByLabelText("OCR 공격력")).toHaveValue(110));
  await user.click(area.getByLabelText("원본의 모든 옵션을 확인했습니다"));
  return {user,area};
}
const options="REQ LEV: 0\nREQ STR: 0\n공격력 +110";
it("routes a glove photo to gloves despite the selected weapon, with only a price input and automatic name",async()=>{
  const input=seed();input.equipment.gloves!.attackFlat="5";localStorage.setItem(STORAGE_KEY,serializeSetup(input));
  const saved=localStorage.getItem(STORAGE_KEY);render(<CalculatorApp/>);
  const {user,area}=await importPhoto(`장비분류: 장갑\n${options}`,"4.3");
  expect(area.queryByLabelText("교체할 장비 부위")).not.toBeInTheDocument();expect(area.getByText("장갑 교체")).toBeInTheDocument();
  await user.click(area.getByRole("button",{name:"후보로 비교"}));
  const card=screen.getByRole("article",{name:"후보 1 비교 결과"});expect(within(card).getByText("장갑 교체 후")).toBeInTheDocument();
  expect(within(card).getByLabelText("후보 1 구매 가격")).toHaveValue(4.3);
  const table=within(card).getByRole("table",{name:"캐릭터 스탯 변경 전후"});
  expect(within(within(table).getByRole("row",{name:/^공격력 /})).getAllByRole("cell").map(cell=>cell.textContent)).toEqual(["105","210","+105"]);
  await user.click(within(card).getByRole("button",{name:"후보 1 상세 보기"}));expect(screen.queryByLabelText("후보 이름 수정")).not.toBeInTheDocument();
  expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
});

it("asks which of four rings to replace and does not assume identical options mean duplicate gear",async()=>{
  const input=seed();for(const slot of ["ring_1","ring_2","ring_3","ring_4"] as const)input.equipment[slot]!.attackFlat="110";
  localStorage.setItem(STORAGE_KEY,serializeSetup(input));const saved=localStorage.getItem(STORAGE_KEY);render(<CalculatorApp/>);
  const {user,area}=await importPhoto(`장비분류: 반지\n${options}`);
  const select=area.getByLabelText("교체할 장비 부위");expect(select).toHaveValue("");expect(within(select).getAllByRole("option")).toHaveLength(5);
  const apply=area.getByRole("button",{name:"후보로 비교"});expect(apply).toBeDisabled();
  await user.selectOptions(select,"ring_3");expect(apply).toBeEnabled();await user.click(apply);
  const card=screen.getByRole("article",{name:"후보 1 비교 결과"});expect(card).toHaveTextContent("반지 3 교체 후");expect(within(card).getByLabelText("환산 공격력 비교")).toHaveTextContent("변화 없음");
  expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
});

it("requires a manual destination only when the photo category is unreadable",async()=>{
  seed();render(<CalculatorApp/>);const {user,area}=await importPhoto(options);
  expect(area.getByText("부위를 인식하지 못했습니다. 교체할 장비를 선택해주세요.")).toBeInTheDocument();
  const apply=area.getByRole("button",{name:"후보로 비교"});expect(apply).toBeDisabled();
  await user.selectOptions(area.getByLabelText("교체할 장비 부위"),"weapon");await user.click(apply);
  expect(screen.getByRole("article",{name:"후보 1 비교 결과"})).toHaveTextContent("무기 교체 후");
});

it("resolves custom categories and asks for a choice when two necklaces match",async()=>{
  const input=seed();input.customSlots=[{id:"extra_pendant",label:"펜던트"}];input.equipment.extra_pendant={...input.equipment.necklace!,attackFlat:"1"};
  localStorage.setItem(STORAGE_KEY,serializeSetup(input));render(<CalculatorApp/>);
  const {user,area}=await importPhoto(`장비분류: 펜던트\n${options}`);
  const select=area.getByLabelText("교체할 장비 부위");expect(within(select).getAllByRole("option")).toHaveLength(3);
  await user.selectOptions(select,"extra_pendant");await user.click(area.getByRole("button",{name:"후보로 비교"}));
  expect(screen.getByRole("article",{name:"후보 1 비교 결과"})).toHaveTextContent("펜던트 교체 후");
});

it("clears a manual ring choice when another photo replaces the draft, while keeping the price",async()=>{
  seed();render(<CalculatorApp/>);const {user,area}=await importPhoto(`장비분류: 반지\n${options}`);
  await user.selectOptions(area.getByLabelText("교체할 장비 부위"),"ring_4");
  await user.upload(area.getByLabelText("비교 후보 스크린샷"),image());
  await waitFor(()=>expect(area.getByLabelText("OCR 공격력")).toHaveValue(110));
  expect(area.getByLabelText("교체할 장비 부위")).toHaveValue("");expect(area.getByLabelText("새 후보 구매 가격")).toHaveValue(.3);
  expect(area.getByLabelText("원본의 모든 옵션을 확인했습니다")).not.toBeChecked();expect(area.getByRole("button",{name:"후보로 비교"})).toBeDisabled();
});
