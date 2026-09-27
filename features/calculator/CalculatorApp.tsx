"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { calculateDamageResult } from "./domain/calculate";
import { createDefaultInput } from "./domain/defaults";
import { JOB_RULES } from "./domain/job-rules";
import { addEquipmentSlot, getEquipmentSlotLabel, removeEquipmentSlot } from "./domain/slots";
import { applyStatReplacement } from "./ocr/applyStatReplacement";
import type { OcrTarget, StatReplacement } from "./ocr/types";
import { applyOcrBatch, type ApplyOcrBatch } from "./ocr/batch";
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
  CharacterIdentityFields,
  type CharacterChangeHandler,
} from "./components/CharacterPanel";
import {
  EquipmentEditor,
  type EquipmentChangeHandler,
} from "./components/EquipmentEditor";
import { EquipmentNavigator } from "./components/EquipmentNavigator";
import { CandidateComparisonPanel } from "./components/CandidateComparisonPanel";
import { ResultsPanel } from "./components/ResultsPanel";
import { AttackSetupPanel } from "./components/AttackSetupPanel";
import { CharacterStatWindowPanel } from "./components/CharacterStatWindowPanel";
import { applyStatWindow } from "./domain/statWindow";
import type { StatWindowSnapshot } from "./domain/types";
import { GuildSkillsPanel } from "./components/GuildSkillsPanel";
import { WeaponPresetsPanel } from "./components/WeaponPresetsPanel";
import { SetupImportPanel } from "./components/SetupImportPanel";
import { activeWeaponPreset, captureWeaponPreset, getWeaponPreset, switchWeaponPreset } from "./domain/weapon-presets";
import type { WeaponPresetId } from "./domain/types";

function hasEquipmentValues(input: CalculatorInput): boolean {
  return Object.values(input.weaponPresets?.entries ?? {}).some(preset => Object.values(preset.weapon).some(value => value.trim() !== ""))
    || (input.customSlots?.length ?? 0) > 0 || Object.values(input.equipment).some(
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
  const [initialLoading, setInitialLoading] = useState(true);
  const [setupRevision, setSetupRevision] = useState(0);
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
      } finally {
        setInitialLoading(false);
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

  const handleOcrBatchApply: ApplyOcrBatch = (job, entries) => {
    const outcome = applyOcrBatch(input, job, entries);
    if (outcome.error) return outcome.error;
    if (outcome.input) setInput(outcome.input);
    return null;
  };

  const handleOcrBatchSave: ApplyOcrBatch = (job, entries) => {
    if (initialLoading) return "저장된 캐릭터를 불러오는 중입니다. 잠시 기다려주세요.";
    const outcome = applyOcrBatch(input, job, entries);
    if (outcome.error) return outcome.error;
    if (!outcome.input) return "인식 결과를 다시 확인하세요.";
    const characterError = calculateDamageResult(outcome.input).issues.find(issue => issue.severity === "error" && issue.path.startsWith("character."));
    if (characterError) {
      handleNavigate(characterError.path);
      return "캐릭터 설정에 잘못된 값이 있습니다. 표시된 입력값을 수정한 뒤 저장하세요.";
    }
    const next = captureWeaponPreset(outcome.input);
    try {
      // Persist the exact reviewed snapshot before committing UI state. A quota
      // or privacy-mode failure leaves the old setup and the review intact.
      const timestamp = save(next);
      setInput(next);
      setSavedAt(timestamp);
      setStorageError(null);
      return null;
    } catch {
      return "브라우저에 저장하지 못했습니다. 인식 목록은 유지됩니다. 브라우저 저장 공간·설정을 확인한 뒤 다시 눌러주세요.";
    }
  };

  const handleStatWindowSave = (snapshot: StatWindowSnapshot): string | null => {
    if (initialLoading) return "저장된 캐릭터를 불러오는 중입니다.";
    try {
      const next = captureWeaponPreset(applyStatWindow(input, snapshot));
      const error = calculateDamageResult(next).issues.find(issue => issue.severity === "error" && issue.path.startsWith("character."));
      if (error) return "캐릭터 설정을 확인해주세요: " + error.message;
      const timestamp = save(next);
      setInput(next); setSavedAt(timestamp); setStorageError(null);
      return null;
    } catch (error) {
      return error instanceof Error && error.message.startsWith("능력창") ? error.message : "브라우저에 저장하지 못했습니다. 기존 세팅과 인식값은 유지됩니다.";
    }
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
      && !window.confirm("직업을 바꾸면 장비 값·무기 프리셋 3개·추가한 부위가 초기화됩니다. 계속할까요?")
    ) {
      return;
    }

    setInput(createDefaultInput(job));
    setSelectedSlot(firstSlot(job));
    setSetupRevision(revision => revision + 1);
  };

  const handleReset = () => {
    if (!window.confirm("현재 입력과 저장된 세팅을 초기화할까요?")) return;

    const job = input.character.job;
    setInput(createDefaultInput(job));
    setSelectedSlot(firstSlot(job));
    setSetupRevision(revision => revision + 1);
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
      setSavedAt(save(captureWeaponPreset(input)));
      setStorageError(null);
    } catch {
      setStorageError("세팅을 저장할 수 없습니다.");
    }
  };

  const handlePresetSelect = (id: WeaponPresetId) => {
    setInput(current => switchWeaponPreset(current, id));
    setSelectedSlot("weapon");
    setInputMode("cards");
  };

  const handlePresetCopy = (id: WeaponPresetId) => {
    if (id === activeWeaponPreset(input)) return;
    const existing = getWeaponPreset(input, id);
    if (existing && Object.values(existing.weapon).some(value => value.trim() !== "")
      && !window.confirm("해당 프리셋의 무기를 현재 무기로 교체할까요?")) return;
    setInput(current => {
      const destination = switchWeaponPreset(current, id);
      return { ...destination, equipment: { ...destination.equipment, weapon: { ...current.equipment.weapon! } } };
    });
    setSelectedSlot("weapon");
    setInputMode("cards");
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
      setSetupRevision(revision => revision + 1);
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
    <main className="calculator-shell" aria-busy={initialLoading}>
      <fieldset className="calculator-content" disabled={initialLoading} aria-label="계산기 입력 및 결과">
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
      <div className="page-intro">
        <div>
          <h1>플래닛 데미지 계산기</h1>

        </div>

      </div>
      <SetupImportPanel key={`${input.character.job}:${activeWeaponPreset(input)}:${setupRevision}`}
        input={input} disabled={initialLoading} savedAt={savedAt} onApplyAndSave={handleOcrBatchSave}>
        <div className="setup-import-identity">
          <CharacterIdentityFields character={input.character} issues={result.issues} onChange={handleCharacterChange} onJobChange={handleJobChange} />
        </div>
      </SetupImportPanel>
      <div className="section-heading" id="character-settings"><div><span>01</span><h2>캐릭터와 전투 조건</h2></div></div>
      <CharacterStatWindowPanel key={`stat:${input.character.job}:${activeWeaponPreset(input)}:${setupRevision}`} input={input} result={result} onSave={handleStatWindowSave} />
      <GuildSkillsPanel character={input.character} issues={result.issues} onChange={handleCharacterChange} />
      <div className="calculator-setup">
          <CharacterPanel
            showIdentity={false}
            character={input.character}
            issues={result.issues}
            onChange={handleCharacterChange}
            onJobChange={handleJobChange}
          />
          <AttackSetupPanel input={input} issues={result.issues}
            onEquipmentChange={handleEquipmentChange}
            onStackableBuffChange={(buff, enabled) => setInput(current => ({
              ...current,
              attackBuffs: { sprinkling: false, rage: false, ...current.attackBuffs, [buff]: enabled },
            }))} />
      </div>
      <div className="section-heading"><div><span>02</span><h2>내 장비와 계산 결과</h2></div></div>
      <WeaponPresetsPanel input={input} onSelect={handlePresetSelect} onCopy={handlePresetCopy} onSave={handleSave} />
      <div className="calculator-workspace" id="equipment-workspace">
        <div className="calculator-left" aria-label="장비 목록">
          <EquipmentNavigator
            input={input}
            issues={result.issues}
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
                onOcrBatchApply={handleOcrBatchApply}
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
            onBuffSelect={attack => handleEquipmentChange("buff", "attackFlat", String(attack))}
          />
        </div>
      </div>
      <CandidateComparisonPanel key={`candidates:${input.character.job}:${setupRevision}`} input={input} initialSlot={selectedSlot} onPresetSelect={handlePresetSelect} onSaveStatWindow={handleStatWindowSave} />
      <footer className="app-footer"><a href="#page-top">맨 위로 ↑</a></footer>
      </fieldset>
    </main>
  );
}
