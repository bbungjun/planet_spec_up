import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { render,screen,within,waitFor,fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalculatorApp } from "@/features/calculator/CalculatorApp";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { STORAGE_KEY,serializeSetup } from "@/features/calculator/storage";
import * as recognition from "@/features/calculator/ocr/recognizeTooltip.client";
const recognize=vi.fn<recognition.TooltipRecognizer["recognize"]>();
const image=()=>new File(["fake pixels"],"candidate.png",{type:"image/png"});
function seed(){const input=createDefaultInput("corsair");input.equipment.projectile!.attackFlat="0";Object.assign(input.character,{level:"120",pureMain:"600",pureSub:"22",mapleWarrior:0,guildAttackFlat:"0",guildBossPercent:"0",guildIgnorePercent:"0"});Object.assign(input.equipment.weapon!,{attackFlat:"100",requiredLevel:"0",requiredSub:"0",bossDamagePercent:"50"});localStorage.setItem(STORAGE_KEY,serializeSetup(input));return input;}
const panel=()=>screen.getByRole("region",{name:"구매 후보 비교"});
it("keeps candidate review numeric and requires confirmation again after a manual edit",async()=>{
 seed();const saved=localStorage.getItem(STORAGE_KEY);render(<CalculatorApp/>);
 const {user,area}=await importPhoto("장비분류: 건\nREQ LEV: 0\nREQ STR: 0\n공격력 +110");
 const dialog=screen.getByRole("dialog",{name:"비교할 장비 추가"});
 expect(dialog.textContent).not.toMatch(/OCR|인식한 전체 옵션|인식 텍스트 확인/);
 expect(dialog.querySelector("textarea")).toBeNull();
 expect([...dialog.querySelectorAll("[aria-label]")].some(element=>element.getAttribute("aria-label")?.includes("OCR"))).toBe(false);
 const apply=area.getByRole("button",{name:"후보로 비교"});expect(apply).toBeEnabled();
 fireEvent.change(area.getByLabelText("인식 총데미지%"),{target:{value:"21"}});
 expect(apply).toBeDisabled();
 expect(area.getByLabelText("원본의 모든 옵션을 확인했습니다")).not.toBeChecked();
 await user.click(area.getByLabelText("원본의 모든 옵션을 확인했습니다"));await user.click(apply);
 expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
 const card=screen.getByRole("article",{name:"후보 1 비교 결과"});
 await user.click(within(card).getByRole("button",{name:"후보 1 상세 보기"}));
 expect(screen.getByLabelText("후보 1 총데미지%")).toHaveValue(21);
});
it("shows hunting skill changes, sources and blocked placeholders while preserving candidate and saved gear",async()=>{
 const input=seed();input.equipment.weapon!.totalDamagePercent="21";
 input.weaponPresets={active:"hunting",entries:{boss:{weapon:{...input.equipment.weapon!},monsterDefense:"0"}}};
 localStorage.setItem(STORAGE_KEY,serializeSetup(input));const saved=localStorage.getItem(STORAGE_KEY);
 recognize.mockResolvedValue("장비분류: 건\nREQ LEV: 0\nREQ STR: 0\n공격력 +110\n총데미지 +9%");
 render(<CalculatorApp/>);const user=await add();
 const card=screen.getByRole("article",{name:"후보 A 비교 결과"});
 const skills=within(card).getByRole("region",{name:"사냥 스킬 피해 비교"});
 expect(within(skills).getAllByRole("row")).toHaveLength(5);
 expect(within(skills).getByRole("row",{name:/서포터 옥토퍼스/})).toHaveTextContent("-9.93%");
 expect(skills).toHaveTextContent("속성강화 포함 390%");
 await user.click(within(skills).getByText("계산 가정·출처"));
 expect(within(skills).getByRole("link",{name:"빅뱅 전 공격·소환수 공식"})).toHaveAttribute("href","https://www.southperry.net/showthread.php?tid=1033");
 await user.selectOptions(within(panel()).getByLabelText("비교 전투 프리셋"),"boss");
 expect(within(card).queryByRole("region",{name:"사냥 스킬 피해 비교"})).not.toBeInTheDocument();
 await user.selectOptions(within(panel()).getByLabelText("비교 전투 프리셋"),"hunting");
 await user.clear(screen.getByLabelText("순수 STR"));
 const blocked=within(card).getByRole("region",{name:"사냥 스킬 피해 비교"});
 expect(blocked).toHaveTextContent("비교 조건 확인 후 표시");expect(blocked).not.toHaveTextContent("-9.93%");
 expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
});
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
 await waitFor(()=>expect(area.getByLabelText("인식 공격력")).toHaveValue(110));expect(area.getByRole("button",{name:"후보로 비교"})).toBeDisabled();
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

async function manualStatsCase() {
  const input=seed();delete input.character.pureMain;delete input.character.pureSub;
  localStorage.setItem(STORAGE_KEY,serializeSetup(input));
  render(<CalculatorApp/>);const user=await add("대기 후보");const card=screen.getByRole("article",{name:"대기 후보 비교 결과"});
  await user.type(within(card).getByLabelText("대기 후보 구매 가격"),"4.1");
  expect(within(card).getByText("기준 캐릭터의 순수 스탯이 필요합니다.")).toBeInTheDocument();
  await user.click(within(card).getByRole("button",{name:"순수 스탯 입력"}));
  expect(screen.getByLabelText("순수 DEX")).toHaveFocus();
  expect(screen.queryByRole("dialog",{name:"능력창 등록"})).not.toBeInTheDocument();
  return {card,user};
}
it("resumes the same candidate after directly entering base stats and saves only the setup",async()=>{
  const {card,user}=await manualStatsCase();
  fireEvent.change(screen.getByLabelText("순수 DEX"),{target:{value:"600"}});
  await user.click(within(card).getByRole("button",{name:"순수 스탯 입력"}));
  expect(screen.getByLabelText("순수 STR")).toHaveFocus();
  fireEvent.change(screen.getByLabelText("순수 STR"),{target:{value:"22"}});
  expect(screen.getByRole("article",{name:"대기 후보 비교 결과"})).toBe(card);
  expect(within(card).getByLabelText("최대 스탯공 비교")).toHaveTextContent("2,400");
  expect(within(card).queryByRole("button",{name:"순수 스탯 입력"})).not.toBeInTheDocument();
  expect(within(card).getByLabelText("대기 후보 구매 가격")).toHaveValue(4.1);
  expect(within(card).getByLabelText("대기 후보 1억 메소당 환산공 상승률")).not.toHaveTextContent("—");
  await user.click(screen.getByRole("button",{name:"저장"}));
  const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)!);
  expect(saved.input.character).toMatchObject({pureMain:"600",pureSub:"22"});
  expect(saved.input.equipment.weapon.attackFlat).toBe("100");expect(saved.input.candidates).toBeUndefined();
});
it("keeps the candidate, price and direct input when saving fails",async()=>{
  const {card,user}=await manualStatsCase();const original=localStorage.getItem(STORAGE_KEY);
  fireEvent.change(screen.getByLabelText("순수 DEX"),{target:{value:"600"}});
  fireEvent.change(screen.getByLabelText("순수 STR"),{target:{value:"22"}});
  const fail=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("quota");});
  await user.click(screen.getByRole("button",{name:"저장"}));
  expect(localStorage.getItem(STORAGE_KEY)).toBe(original);
  expect(screen.getByLabelText("순수 DEX")).toHaveValue(600);
  expect(within(card).getByLabelText("대기 후보 구매 가격")).toHaveValue(4.1);
  fail.mockRestore();await user.click(screen.getByRole("button",{name:"저장"}));
  expect(within(card).getByLabelText("최대 스탯공 비교")).toHaveTextContent("2,400");
});
it("blocks comparison for invalid direct stats without losing the candidate",async()=>{
  const {card}=await manualStatsCase();
  fireEvent.change(screen.getByLabelText("순수 DEX"),{target:{value:"600"}});
  fireEvent.change(screen.getByLabelText("순수 STR"),{target:{value:"100"}});
  expect(card).toHaveTextContent("비교 불가");
  expect(within(card).getByLabelText("대기 후보 구매 가격")).toHaveValue(4.1);
  fireEvent.change(screen.getByLabelText("순수 STR"),{target:{value:"22"}});
  expect(within(card).getByLabelText("최대 스탯공 비교")).toHaveTextContent("2,400");
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
  await waitFor(()=>expect(area.getByLabelText("인식 공격력")).toHaveValue(110));
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
  const radios=area.getAllByRole("radio");expect(radios).toHaveLength(4);for(const radio of radios)expect(radio).not.toBeChecked();
  expect(area.queryByLabelText("교체할 장비 부위")).not.toBeInTheDocument();
  expect(area.getByRole("group",{name:"기존 반지 옵션 · 교체 대상 선택"})).toHaveTextContent("공격력110");
  const apply=area.getByRole("button",{name:"후보로 비교"});expect(apply).toBeDisabled();
  await user.click(area.getByRole("radio",{name:"반지 3 비교 선택"}));expect(apply).toBeEnabled();await user.click(apply);
  const card=screen.getByRole("article",{name:"후보 1 비교 결과"});expect(card).toHaveTextContent("반지 3 교체 후");expect(within(card).getByLabelText("환산 공격력 비교")).toHaveTextContent("변화 없음");
  await user.click(within(card).getByRole("button",{name:"후보 1 상세 보기"}));
  const details=within(screen.getByRole("dialog",{name:"후보 1 상세"}));
  expect(details.getByRole("radio",{name:"반지 3 비교 선택"})).toBeChecked();
  await user.click(details.getByRole("radio",{name:"반지 1 비교 선택"}));
  expect(details.getByLabelText("후보 비교 부위 수정")).toHaveValue("ring_1");
  await user.click(details.getByRole("button",{name:"후보 1 상세 닫기"}));
  expect(card).toHaveTextContent("반지 1 교체 후");
  expect(within(card).getByLabelText("후보 1 구매 가격")).toHaveValue(.3);
  expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
});

it("requires a manual destination only when the photo category is unreadable",async()=>{
  seed();render(<CalculatorApp/>);const {user,area}=await importPhoto(options);
  expect(area.getByText("부위를 인식하지 못했습니다. 교체할 장비를 선택해주세요.")).toBeInTheDocument();
  const apply=area.getByRole("button",{name:"후보로 비교"});expect(apply).toBeDisabled();
  await user.selectOptions(area.getByLabelText("교체할 장비 부위"),"weapon");await user.click(apply);
  expect(screen.getByRole("article",{name:"후보 1 비교 결과"})).toHaveTextContent("무기 교체 후");
});

it("asks which of the two pendant slots to replace",async()=>{
  const input=seed();input.equipment.pendant_2={...input.equipment.necklace!,attackFlat:"1",pendantId:"horntail"};
  localStorage.setItem(STORAGE_KEY,serializeSetup(input));render(<CalculatorApp/>);
  const {user,area}=await importPhoto(`장비분류: 펜던트\n${options}`);
  const select=area.getByLabelText("교체할 장비 부위");expect(within(select).getAllByRole("option")).toHaveLength(3);
  await user.selectOptions(select,"pendant_2");await user.click(area.getByRole("button",{name:"후보로 비교"}));
  expect(screen.getByRole("article",{name:"후보 1 비교 결과"})).toHaveTextContent("펜던트 2 교체 후");
});

it("clears a manual ring choice when another photo replaces the draft, while keeping the price",async()=>{
  seed();render(<CalculatorApp/>);const {user,area}=await importPhoto(`장비분류: 반지\n${options}`);
  await user.click(area.getByRole("radio",{name:"반지 4 비교 선택"}));
  await user.upload(area.getByLabelText("비교 후보 스크린샷"),image());
  await waitFor(()=>expect(area.getByLabelText("인식 공격력")).toHaveValue(110));
  for(const radio of area.getAllByRole("radio"))expect(radio).not.toBeChecked();expect(area.getByLabelText("새 후보 구매 가격")).toHaveValue(.3);
  expect(area.getByLabelText("원본의 모든 옵션을 확인했습니다")).not.toBeChecked();expect(area.getByRole("button",{name:"후보로 비교"})).toBeDisabled();
});

async function openManualCandidate() {
  const user=userEvent.setup();
  await user.click(await screen.findByRole("button",{name:"비교 카드 추가"}));
  const dialog=screen.getByRole("dialog",{name:"비교할 장비 추가"});
  await user.click(within(dialog).getByRole("button",{name:"직접 입력"}));
  return {user,dialog,area:within(dialog)};
}

it("adds a photo-free candidate, edits its options, compares presets and saves only original gear",async()=>{
  const input=seed();input.weaponPresets={active:"boss",entries:{chaos:{weapon:{...input.equipment.weapon!,attackFlat:"200"},monsterDefense:"80"}}};
  localStorage.setItem(STORAGE_KEY,serializeSetup(input));const saved=localStorage.getItem(STORAGE_KEY);render(<CalculatorApp/>);
  const {user,area}=await openManualCandidate();
  await user.selectOptions(area.getByLabelText("직접 입력 비교 부위"),"weapon");
  expect(area.queryByLabelText("비교 후보 스크린샷")).not.toBeInTheDocument();
  expect(area.getByLabelText("새 후보 공격력",{exact:true})).toHaveValue(null);
  for(const [label,value] of [["공격력","110"],["요구 레벨","0"],["요구 STR","0"]])fireEvent.change(area.getByLabelText(`새 후보 ${label}`,{exact:true}),{target:{value}});
  await user.type(area.getByLabelText("새 후보 구매 가격"),"0.3");
  await user.click(area.getByRole("button",{name:"후보로 비교"}));
  const card=screen.getByRole("article",{name:"후보 1 비교 결과"});
  expect(within(card).getByLabelText("최대 스탯공 비교")).toHaveTextContent("2,400");
  expect(within(card).getByLabelText("후보 1 1억 메소당 환산공 상승률")).toHaveTextContent("-88.91%");
  expect(within(card).queryByRole("img")).not.toBeInTheDocument();expect(recognize).not.toHaveBeenCalled();
  await user.selectOptions(screen.getByLabelText("비교 전투 프리셋"),"chaos");
  expect(within(card).getByLabelText("최대 스탯공 비교")).toHaveTextContent("현재 4,364");
  await user.click(within(card).getByRole("button",{name:"후보 1 상세 보기"}));
  const detail=within(screen.getByRole("dialog",{name:"후보 1 상세"}));
  fireEvent.change(detail.getByLabelText("후보 1 공격력",{exact:true}),{target:{value:"220"}});
  await user.click(detail.getByRole("button",{name:"후보 1 상세 닫기"}));
  expect(within(card).getByLabelText("최대 스탯공 비교")).toHaveTextContent("4,800");
  expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
  await user.click(screen.getByRole("button",{name:"저장"}));const stored=JSON.parse(localStorage.getItem(STORAGE_KEY)!);
  expect(stored.input.equipment.weapon.attackFlat).toBe("200");expect(stored.input.candidates).toBeUndefined();
});

it("preserves blank manual requirements and withholds percentages until explicitly entered",async()=>{
  seed();render(<CalculatorApp/>);const {user,area}=await openManualCandidate();
  await user.selectOptions(area.getByLabelText("직접 입력 비교 부위"),"weapon");
  fireEvent.change(area.getByLabelText("새 후보 공격력",{exact:true}),{target:{value:"110"}});
  await user.type(area.getByLabelText("새 후보 구매 가격"),"1");await user.click(area.getByRole("button",{name:"후보로 비교"}));
  const card=screen.getByRole("article",{name:"후보 1 비교 결과"});
  expect(card).toHaveTextContent("조건 확인 필요 · 후보 장비의 요구 레벨을 입력해주세요.");
  expect(within(card).getByLabelText("후보 1 1억 메소당 환산공 상승률")).toHaveTextContent("—");
  await user.click(within(card).getByRole("button",{name:"후보 1 상세 보기"}));const details=within(screen.getByRole("dialog",{name:"후보 1 상세"}));
  expect(details.getByLabelText("후보 1 요구 레벨")).toHaveValue(null);expect(details.getByLabelText("후보 1 요구 STR")).toHaveValue(null);
  fireEvent.change(details.getByLabelText("후보 1 요구 레벨"),{target:{value:"0"}});
  fireEvent.change(details.getByLabelText("후보 1 요구 STR"),{target:{value:"9999"}});
  expect(details.getAllByRole("status")[0]).toHaveTextContent("비교 불가");
  fireEvent.change(details.getByLabelText("후보 1 요구 STR"),{target:{value:"0"}});
  await user.click(details.getByRole("button",{name:"후보 1 상세 닫기"}));
  expect(within(card).getByLabelText("후보 1 1억 메소당 환산공 상승률")).not.toHaveTextContent("—");
});

it("shows existing rings for manual target selection without inheriting their stats",async()=>{
  const input=seed();input.equipment.ring_1!.attackFlat="5";input.equipment.ring_3!.attackFlat="10";
  localStorage.setItem(STORAGE_KEY,serializeSetup(input));const saved=localStorage.getItem(STORAGE_KEY);render(<CalculatorApp/>);
  const {user,area}=await openManualCandidate();await user.selectOptions(area.getByLabelText("직접 입력 비교 부위"),"ring_1");
  expect(area.getByRole("group",{name:"기존 반지 옵션 · 교체 대상 선택"})).toHaveTextContent("공격력10");
  await user.click(area.getByRole("radio",{name:"반지 3 비교 선택"}));
  expect(area.getByLabelText("새 후보 공격력",{exact:true})).toHaveValue(null);
  for(const [label,value] of [["공격력","15"],["요구 레벨","0"],["요구 STR","0"]])fireEvent.change(area.getByLabelText(`새 후보 ${label}`,{exact:true}),{target:{value}});
  await user.click(area.getByRole("button",{name:"후보로 비교"}));
  const card=screen.getByRole("article",{name:"후보 1 비교 결과"});expect(card).toHaveTextContent("반지 3 교체 후");
  const row=within(within(card).getByRole("table",{name:"캐릭터 스탯 변경 전후"})).getByRole("row",{name:/^공격력 /});
  expect(within(row).getAllByRole("cell").map(cell=>cell.textContent)).toEqual(["115","120","+5"]);
  expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
});

it("ignores late photo recognition after switching to manual input and resets a canceled draft",async()=>{
  let finish!:(value:string)=>void;recognize.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));seed();render(<CalculatorApp/>);const user=userEvent.setup();
  await user.click(await screen.findByRole("button",{name:"비교 카드 추가"}));const dialog=screen.getByRole("dialog",{name:"비교할 장비 추가"});const area=within(dialog);
  await user.upload(area.getByLabelText("비교 후보 스크린샷"),image());await user.click(area.getByRole("button",{name:"직접 입력"}));finish("공격력 +999");
  fireEvent.change(area.getByLabelText("새 후보 공격력",{exact:true}),{target:{value:"120"}});
  await user.type(area.getByLabelText("새 후보 구매 가격"),"0.3");
  await user.click(area.getByRole("button",{name:"사진 등록"}));await user.click(area.getByRole("button",{name:"직접 입력"}));
  expect(area.getByLabelText("새 후보 공격력",{exact:true})).toHaveValue(120);expect(area.getByLabelText("새 후보 구매 가격")).toHaveValue(.3);
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  fireEvent(dialog,new Event("cancel",{cancelable:true}));expect(screen.getByRole("button",{name:"비교 카드 추가"})).toHaveFocus();
  const next=await openManualCandidate();expect(next.area.getByLabelText("새 후보 공격력",{exact:true})).toHaveValue(null);expect(next.area.getByLabelText("새 후보 구매 가격")).toHaveValue(null);
});
