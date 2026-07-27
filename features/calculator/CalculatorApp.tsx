"use client";

import { useMemo, useState } from "react";
import { calculateDamageResult } from "./domain/calculate";
import { createDefaultInput } from "./domain/defaults";
import { JOB_RULES } from "./domain/job-rules";
import type {
  CalculatorInput,
  CharacterInput,
  EquipmentInput,
  EquipmentSlot,
  JobId,
} from "./domain/types";
import { AppHeader } from "./components/AppHeader";
import {
  CharacterPanel,
  type CharacterChangeHandler,
} from "./components/CharacterPanel";
import {
  EquipmentEditor,
  type EquipmentChangeHandler,
} from "./components/EquipmentEditor";
import { EquipmentNavigator } from "./components/EquipmentNavigator";
import { ResultsPanel } from "./components/ResultsPanel";

function hasEquipmentValues(input: CalculatorInput): boolean {
  return Object.values(input.equipment).some(
    (equipment) => equipment !== undefined
      && Object.values(equipment).some((value) => value.trim() !== ""),
  );
}

function firstSlot(job: JobId): EquipmentSlot {
  return JOB_RULES[job].visibleSlots[0];
}

export function CalculatorApp() {
  const [input, setInput] = useState<CalculatorInput>(
    () => createDefaultInput("corsair"),
  );
  const [selectedSlot, setSelectedSlot] = useState<EquipmentSlot>(
    () => firstSlot("corsair"),
  );
  const result = useMemo(() => calculateDamageResult(input), [input]);

  const handleCharacterChange: CharacterChangeHandler = (field, value) => {
    setInput((current) => ({
      ...current,
      character: {
        ...current.character,
        [field]: value,
      } as CharacterInput,
    }));
  };

  const handleEquipmentChange: EquipmentChangeHandler = (slot, field, value) => {
    setInput((current) => {
      const equipment = current.equipment[slot];
      if (equipment === undefined) return current;

      return {
        ...current,
        equipment: {
          ...current.equipment,
          [slot]: {
            ...equipment,
            [field]: value,
          } as EquipmentInput,
        },
      };
    });
  };

  const handleJobChange = (job: JobId) => {
    if (job === input.character.job) return;
    if (
      hasEquipmentValues(input)
      && !window.confirm("직업을 바꾸면 입력한 장비 값이 초기화됩니다. 계속할까요?")
    ) {
      return;
    }

    setInput(createDefaultInput(job));
    setSelectedSlot(firstSlot(job));
  };

  const handleReset = () => {
    if (
      hasEquipmentValues(input)
      && !window.confirm("입력한 장비 값을 초기화할까요?")
    ) {
      return;
    }

    const job = input.character.job;
    setInput(createDefaultInput(job));
    setSelectedSlot(firstSlot(job));
  };

  const handleNavigate = (path: string) => {
    const [group, candidate] = path.split(".");
    if (group !== "equipment") return;

    const slot = candidate as EquipmentSlot;
    if (input.equipment[slot] !== undefined) {
      setSelectedSlot(slot);
    }
  };

  return (
    <main className="calculator-shell">
      <AppHeader onReset={handleReset} />
      <div className="calculator-workspace">
        <div className="calculator-left" aria-label="캐릭터 및 장비">
          <CharacterPanel
            character={input.character}
            issues={result.issues}
            onChange={handleCharacterChange}
            onJobChange={handleJobChange}
          />
          <EquipmentNavigator
            input={input}
            selectedSlot={selectedSlot}
            onSelectSlot={setSelectedSlot}
          />
        </div>
        <div className="calculator-center" aria-label="장비 입력">
          <EquipmentEditor
            input={input}
            selectedSlot={selectedSlot}
            issues={result.issues}
            onEquipmentChange={handleEquipmentChange}
          />
        </div>
        <ResultsPanel
          job={input.character.job}
          result={result}
          onNavigate={handleNavigate}
        />
      </div>
    </main>
  );
}
