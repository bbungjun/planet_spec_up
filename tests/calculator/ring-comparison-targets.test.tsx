import { expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RingComparisonTargets, type ComparisonSlotChoice } from "@/features/calculator/components/RingComparisonTargets";
import { emptyEquipment } from "@/features/calculator/domain/defaults";
import { RING_SLOTS } from "@/features/calculator/domain/slots";

it("shows each ring's stored options, explicit zero, unknown blanks, and empty slots without mutation", async () => {
  const choices: ComparisonSlotChoice[] = RING_SLOTS.map((slot,index) => ({ slot, label: `반지 ${index+1}`, equipment: emptyEquipment() }));
  Object.assign(choices[0].equipment!, { mainFlat: "12", subFlat: "3", mainPercent: "6", subPercent: "2", attackFlat: "5", attackPercent: "3",
    totalDamagePercent: "9", bossDamagePercent: "6", ignoreDefensePercent: "10", requiredLevel: "80", requiredSub: "0", damagePercent: "4" });
  choices[1].equipment!.mainFlat = "0";
  choices[2].equipment!.mainPercent = "15";
  const original=JSON.stringify(choices), select=vi.fn();
  const view=render(<RingComparisonTargets choices={choices} selected="" job="corsair" onSelect={select}/>);
  const first=screen.getByRole("radio",{name:"반지 1 비교 선택"}).closest("label")!;
  for(const text of ["DEX12","STR3","DEX%6%","STR%2%","공격력5","공격력%3%","총데미지9%","보공6%","방무10%","요구 레벨80","요구 STR0","구형 보공·총뎀4%"])
    expect(first).toHaveTextContent(text);
  const second=screen.getByRole("radio",{name:"반지 2 비교 선택"}).closest("label")!;
  expect(second).toHaveTextContent("DEX0");
  expect(within(second).queryByText("요구 레벨")).not.toBeInTheDocument();
  expect(screen.getByRole("radio",{name:"반지 4 비교 선택"}).closest("label")).toHaveTextContent("등록된 옵션이 없습니다.");
  await userEvent.click(screen.getByRole("radio",{name:"반지 3 비교 선택"}));
  expect(select).toHaveBeenCalledWith("ring_3");
  view.rerender(<RingComparisonTargets choices={choices} selected="ring_3" job="night_lord" onSelect={select}/>);
  expect(screen.getByRole("radio",{name:"반지 3 비교 선택"})).toBeChecked();
  expect(screen.getByRole("radio",{name:"반지 1 비교 선택"}).closest("label")).toHaveTextContent("LUK12");
  expect(JSON.stringify(choices)).toBe(original);
});
