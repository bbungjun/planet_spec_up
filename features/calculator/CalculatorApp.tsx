"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { calculateDamageResult } from "./domain/calculate";
import { createDefaultInput } from "./domain/defaults";
import { JOB_RULES } from "./domain/job-rules";
import { addEquipmentSlot, getEquipmentSlotLabel, removeEquipmentSlot } from "./domain/slots";
import { applyStatReplacement } from "./ocr/applyStatReplacement";
import type { OcrTarget, StatReplacement } from "./ocr/types";
import type {
  CalculatorInput,
  CharacterInput,
  EquipmentInput,
  EquipmentSlot,
  InputMode,
  JobId,
} from "./domain/types";
import { useSavedSetup } from "./hooks/useSavedSetup";
import { AppHeader } from "./components/AppHeader";
import { BulkEditor } from "./components/BulkEditor";
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
import { AttackSetupPanel } from "./components/AttackSetupPanel";

function hasEquipmentValues(input: CalculatorInput): boolean {
  return (input.customSlots?.length ?? 0) > 0 || Object.values(input.equipment).some(
    (equipment) => equipment !== undefined
      && Object.values(equipment).some((value) => value.trim() !== ""),
  );
}

function firstSlot(job: JobId): EquipmentSlot {
  return JOB_RULES[job].visibleSlots[0];
}

export function CalculatorApp() {
  const { load, save, clear } = useSavedSetup();
  const [input, setInput] = useState<CalculatorInput>(
    () => createDefaultInput("corsair"),
  );
  const [selectedSlot, setSelectedSlot] = useState<EquipmentSlot>(
    () => firstSlot("corsair"),
  );
  const [inputMode, setInputMode] = useState<InputMode>("cards");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const pendingFocusPath = useRef<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const result = useMemo(() => calculateDamageResult(input), [input]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const saved = load();
        if (!saved.ok) {
          if (saved.message !== "empty") {
            setStorageError("저장 데이터를 불러올 수 없습니다.");
          }
          return;
        }

        setInput(saved.value.input);
        setSelectedSlot(firstSlot(saved.value.input.character.job));
        setSavedAt(saved.value.savedAt);
        setStorageError(null);
      } catch {
        setStorageError("저장 데이터를 불러올 수 없습니다.");
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    const path = pendingFocusPath.current;
    if (path === null) return;

    const target = document.querySelector<HTMLElement>(
      `[data-field-path="${path}"]`,
    );
    if (target !== null) {
      const details = target.closest("details");
      if (details) details.open = true;
      target.focus();
      pendingFocusPath.current = null;
    }
  }, [focusRequest, inputMode, selectedSlot]);

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

  const handleOcrApply = (target: OcrTarget, replacement: StatReplacement) => {
    setInput((current) => {
      if (current.character.job !== target.job) return current;

      const equipment = current.equipment[target.slot];
      if (equipment === undefined) return current;

      return {
        ...current,
        equipment: {
          ...current.equipment,
          [target.slot]: applyStatReplacement(equipment, replacement),
        },
      };
    });
  };

  const handleAddSlot = (label: string): boolean => {
    const added = addEquipmentSlot(input, label);
    if (!added) return false;
    setInput(added.input);
    setSelectedSlot(added.slot);
    setInputMode("cards");
    return true;
  };

  const handleRemoveSlot = (slot: EquipmentSlot) => {
    const equipment = input.equipment[slot];
    if (!input.customSlots?.some(({ id }) => id === slot)) return;
    if (equipment && Object.values(equipment).some(value => value.trim() !== "")
      && !window.confirm(`${getEquipmentSlotLabel(input, slot)}의 입력값을 삭제할까요?`)) return;
    setInput(removeEquipmentSlot(input, slot));
    if (selectedSlot === slot) setSelectedSlot(firstSlot(input.character.job));
  };

  const handleOcrAddAsNew = (target: OcrTarget, label: string, replacement: StatReplacement) => {
    if (target.job !== input.character.job || input.equipment[target.slot] === undefined) return;
    const added = addEquipmentSlot(input, label);
    if (!added) return;
    setInput({
      ...added.input,
      equipment: {
        ...added.input.equipment,
        [added.slot]: applyStatReplacement(added.input.equipment[added.slot]!, replacement),
      },
    });
    setSelectedSlot(added.slot);
    setInputMode("cards");
  };

  const handleJobChange = (job: JobId) => {
    if (job === input.character.job) return;
    if (
      hasEquipmentValues(input)
      && !window.confirm("직업을 바꾸면 장비 값과 추가한 부위가 초기화됩니다. 계속할까요?")
    ) {
      return;
    }

    setInput(createDefaultInput(job));
    setSelectedSlot(firstSlot(job));
  };

  const handleReset = () => {
    if (!window.confirm("현재 입력과 저장된 세팅을 초기화할까요?")) return;

    const job = input.character.job;
    setInput(createDefaultInput(job));
    setSelectedSlot(firstSlot(job));
    try {
      clear();
      setSavedAt(null);
      setStorageError(null);
    } catch {
      setStorageError("저장된 세팅을 초기화할 수 없습니다.");
    }
  };

  const handleSave = () => {
    try {
      save(input);
      const saved = load();
      if (!saved.ok) {
        setStorageError("세팅을 저장할 수 없습니다.");
        return;
      }
      setSavedAt(saved.value.savedAt);
      setStorageError(null);
    } catch {
      setStorageError("세팅을 저장할 수 없습니다.");
    }
  };

  const handleLoad = () => {
    try {
      const saved = load();
      if (!saved.ok) {
        setStorageError(
          saved.message === "empty"
            ? "저장된 세팅이 없습니다."
            : "저장 데이터를 불러올 수 없습니다.",
        );
        return;
      }

      setInput(saved.value.input);
      setSelectedSlot(firstSlot(saved.value.input.character.job));
      setSavedAt(saved.value.savedAt);
      setStorageError(null);
    } catch {
      setStorageError("저장 데이터를 불러올 수 없습니다.");
    }
  };

  const handleNavigate = (path: string) => {
    const [group, candidate] = path.split(".");
    if (group === "equipment") {
      const slot = candidate as EquipmentSlot;
      if (input.equipment[slot] !== undefined) {
        setSelectedSlot(slot);
      }
    }

    setInputMode("cards");
    pendingFocusPath.current = path;
    setFocusRequest((request) => request + 1);
  };

  return (
    <main className="calculator-shell">
      <AppHeader
        inputMode={inputMode}
        savedAt={savedAt}
        storageError={storageError}
        onToggleMode={() => setInputMode((mode) => (
          mode === "cards" ? "bulk" : "cards"
        ))}
        onSave={handleSave}
        onLoad={handleLoad}
        onReset={handleReset}
      />
      <div className="calculator-setup">
          <CharacterPanel
            character={input.character}
            issues={result.issues}
            onChange={handleCharacterChange}
            onJobChange={handleJobChange}
          />
          <AttackSetupPanel input={input} issues={result.issues}
            onEquipmentChange={handleEquipmentChange} onCharacterChange={handleCharacterChange} />
      </div>
      <div className="calculator-workspace">
        <div className="calculator-left" aria-label="장비 목록">
          <EquipmentNavigator
            input={input}
            selectedSlot={selectedSlot}
            onSelectSlot={setSelectedSlot}
            onAddSlot={handleAddSlot}
            onRemoveSlot={handleRemoveSlot}
          />
        </div>
        <div className="calculator-main">
          <div className="calculator-center" aria-label="장비 입력">
            {inputMode === "cards" ? (
              <EquipmentEditor
                input={input}
                selectedSlot={selectedSlot}
                issues={result.issues}
                onEquipmentChange={handleEquipmentChange}
                onSelectSlot={setSelectedSlot}
                onOcrApply={handleOcrApply}
                onOcrAddAsNew={handleOcrAddAsNew}
              />
            ) : (
              <BulkEditor
                input={input}
                issues={result.issues}
                onEquipmentChange={handleEquipmentChange}
              />
            )}
          </div>
          <ResultsPanel
            job={input.character.job}
            input={input}
            result={result}
            onNavigate={handleNavigate}
          />
        </div>
      </div>
    </main>
  );
}
