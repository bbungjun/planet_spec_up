"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { calculateDamageResult } from "./domain/calculate";
import { createDefaultInput, DEFAULT_PROJECTILE_ATTACK } from "./domain/defaults";
import type { StackableAttackBuffId } from "./domain/attack-buffs";
import { JOB_RULES } from "./domain/job-rules";
import { addEquipmentSlot, getEquipmentSlotLabel, isNonEquipmentSlot, removeEquipmentSlot } from "./domain/slots";
import { applyStatReplacement } from "./ocr/applyStatReplacement";
import type { OcrTarget, OcrSource, StatReplacement } from "./ocr/types";
import { isPendantSlot } from "./domain/pendants";
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
import { MapleBackdrop } from "./components/GameVisuals";
import { BulkEditor } from "./components/BulkEditor";
import {
  CharacterPanel,
  CharacterIdentityFields,
  type CharacterChangeHandler,
} from "./components/CharacterPanel";
import {
  EquipmentEditor,
  isEquipmentCardFieldVisible,
  type EquipmentChangeHandler,
} from "./components/EquipmentEditor";
import { EquipmentNavigator } from "./components/EquipmentNavigator";
import { CandidateComparisonPanel } from "./components/CandidateComparisonPanel";
import { StatSimulator } from "./components/StatSimulator";
import { CalculationIssues } from "./components/CalculationIssues";
import { AttackSetupPanel } from "./components/AttackSetupPanel";
import { GuildSkillsPanel } from "./components/GuildSkillsPanel";
import { CashEquipmentPanel, type CashEquipmentChangeHandler } from "./components/CashEquipmentPanel";
import { createDefaultCashEquipment } from "./domain/cash-equipment";
import { WeaponPresetsPanel } from "./components/WeaponPresetsPanel";
import { SetupImportPanel } from "./components/SetupImportPanel";
import { activeWeaponPreset, captureWeaponPreset, switchWeaponPreset } from "./domain/weapon-presets";
import type { WeaponPresetId } from "./domain/types";

function hasEquipmentValues(input: CalculatorInput): boolean {
  return Object.values(input.cashEquipment ?? {}).some(value => value === true)
    || Object.values(input.weaponPresets?.entries ?? {}).some(preset => Object.values(preset.weapon).some(value => value.trim() !== ""))
    || (input.customSlots?.length ?? 0) > 0 || Object.entries(input.equipment).some(
    ([slot, equipment]) => equipment !== undefined
      && Object.entries(equipment).some(([field, value]) => value.trim() !== ""
        && !(slot === "projectile" && field === "attackFlat" && value === DEFAULT_PROJECTILE_ATTACK)),
  );
}

function firstSlot(job: JobId): EquipmentSlot {
  return JOB_RULES[job].visibleSlots[0];
}

const loadErrorMessage = (message: string) => message === "unsupported-job"
  ? "이번 베타는 캡틴만 지원합니다. 기존 다른 직업의 저장값은 보존되며 캡틴 세팅은 별도로 저장합니다."
  : message === "empty" ? "저장된 세팅이 없습니다." : "저장 데이터를 불러올 수 없습니다.";

export function CalculatorApp({ captainBeta = false, development = false, aranBeta = false }: { captainBeta?: boolean; development?: boolean; aranBeta?: boolean }) {
  const { load, save, clear } = useSavedSetup(captainBeta, development, aranBeta);
  const [input, setInput] = useState<CalculatorInput>(
    () => createDefaultInput(aranBeta ? "aran" : "corsair"),
  );
  const [selectedSlot, setSelectedSlot] = useState<EquipmentSlot>(
    () => firstSlot(aranBeta ? "aran" : "corsair"),
  );
  const [inputMode, setInputMode] = useState<InputMode>("cards");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [setupRevision, setSetupRevision] = useState(0);
  const pendingFocusPath = useRef<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const result = useMemo(() => calculateDamageResult(input), [input]);

  const handleStackableBuffChange = (buff: StackableAttackBuffId, enabled: boolean) => {
    setInput(current => ({
      ...current,
      attackBuffs: { sprinkling: false, rage: false, ...current.attackBuffs, [buff]: enabled },
    }));
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const saved = load();
        if (!saved.ok) {
          if (saved.message !== "empty") {
            setStorageError(loadErrorMessage(saved.message));
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
      let ancestor = target.parentElement;
      while (ancestor) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
        ancestor = ancestor.parentElement;
      }
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

  const handleCashEquipmentChange: CashEquipmentChangeHandler = (field, value) => {
    setInput(current => ({
      ...current,
      cashEquipment: { ...(current.cashEquipment ?? createDefaultCashEquipment()), [field]: value },
    }));
  };

  const handleOcrApply = (target: OcrTarget, replacement: StatReplacement, source?: OcrSource) => {
    setInput((current) => {
      if (current.character.job !== target.job) return current;

      const equipment = current.equipment[target.slot];
      if (equipment === undefined) return current;

      return {
        ...current,
        equipment: {
          ...current.equipment,
          [target.slot]: { ...applyStatReplacement(equipment, replacement), ...(isPendantSlot(current, target.slot) && source?.pendantId !== undefined ? { pendantId: source.pendantId } : {}) },
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
    const characterError = calculateDamageResult(outcome.input).issues.find(issue => issue.severity === "error"
      && (issue.path.startsWith("character.") || issue.path.startsWith("cashEquipment.")));
    if (characterError) {
      handleNavigate(characterError.path);
      return characterError.path.startsWith("cashEquipment.")
        ? "캐시 장비 입력값을 수정한 뒤 저장하세요."
        : "캐릭터 설정에 잘못된 값이 있습니다. 표시된 입력값을 수정한 뒤 저장하세요.";
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
    if (captainBeta && job !== "corsair") return;
    if (aranBeta && job !== "aran") return;
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
    const aranError = input.character.job === "aran" ? result.issues.find(issue => issue.severity === "error" && (issue.code === "ARAN_REFERENCE_REQUIRED" || issue.path.startsWith("character.aran"))) : undefined;
    if (aranError) { setStorageError(aranError.message); handleNavigate(aranError.path); return; }
    const criticalError = result.issues.find(issue => issue.code === "CRITICAL_RATE_EXCEEDED" || (issue.severity === "error" && issue.path.endsWith(".criticalRate")));
    if (criticalError) {
      setStorageError(criticalError.message);
      handleNavigate(criticalError.path);
      return;
    }
    const cashError = result.issues.find(issue => issue.severity === "error" && issue.path.startsWith("cashEquipment."));
    if (cashError) {
      setStorageError("캐시 장비 입력값을 확인한 뒤 다시 저장해주세요.");
      handleNavigate(cashError.path);
      return;
    }
    const baseStatError = result.issues.find(issue => issue.severity === "error"
      && (issue.path === "character.pureMain" || issue.path === "character.pureSub"));
    if (baseStatError) {
      setStorageError("순수 스탯을 확인한 뒤 다시 저장해주세요.");
      handleNavigate(baseStatError.path);
      return;
    }
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

  const handleLoad = () => {
    try {
      const saved = load();
      if (!saved.ok) {
        setStorageError(loadErrorMessage(saved.message));
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

  const handleShowAllOptions = () => {
    setInputMode("bulk");
    window.requestAnimationFrame(() => {
      document.getElementById("equipment-editor-area")?.scrollIntoView({ block: "start" });
    });
  };

  const handleNavigate = (path: string) => {
    const [group, candidate, field] = path.split(".");
    let targetMode: InputMode = "cards";
    if (group === "equipment" && !(isNonEquipmentSlot(candidate as EquipmentSlot) && field === "attackFlat")) {
      const slot = candidate as EquipmentSlot;
      if (input.equipment[slot] !== undefined) {
        setSelectedSlot(slot);
        // Preserve an editing route for errors in saved options hidden from cards.
        if (!isEquipmentCardFieldVisible(slot, field)) targetMode = "bulk";
      }
    }

    setInputMode(targetMode);
    pendingFocusPath.current = path;
    setFocusRequest((request) => request + 1);
  };

  return (
    <main className="calculator-shell" aria-busy={initialLoading}>
      <MapleBackdrop />
      {development && <p className="panel-description">개발 전용 · 별도 저장</p>}
      {input.character.job === "aran" && <p className="panel-description" role="status">아란 참고 모델 · 콤보 크리20은 공식 효과를 자동 적용합니다. 폴암 계수 기본5·기타 추가공 기본0(효과 없음)·추가공의 공% 제외·공통 AP 범위는 참고 가정입니다. 스탯공·환산공·후보 상승률·효율은 게임 실측 미검증이며 전체 DPS가 아닙니다.</p>}
      <fieldset className="calculator-content" disabled={initialLoading} aria-label="계산기 입력 및 결과">
      <AppHeader
        captainBeta={captainBeta}
        aranBeta={aranBeta}
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
      <SetupImportPanel key={`${input.character.job}:${activeWeaponPreset(input)}:${setupRevision}`}
        input={input} disabled={initialLoading} savedAt={savedAt} onApplyAndSave={handleOcrBatchSave}>
        <div className="setup-import-identity">
          <CharacterIdentityFields captainBeta={captainBeta} aranBeta={aranBeta} character={input.character} issues={result.issues} onChange={handleCharacterChange} onJobChange={handleJobChange} />
        </div>
      </SetupImportPanel>
      <div className="character-settings-content" id="character-settings">
      <GuildSkillsPanel character={input.character} issues={result.issues} onChange={handleCharacterChange} />
      <CashEquipmentPanel input={input} issues={result.issues} onChange={handleCashEquipmentChange} />
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
            onStackableBuffChange={handleStackableBuffChange} />
      </div>
      </div>
      <WeaponPresetsPanel input={input} onSelect={handlePresetSelect} onSave={handleSave} />
      <div className="calculator-workspace" id="equipment-workspace">
        <div className="calculator-left" aria-label="장비 목록">
          <EquipmentNavigator
            input={input}
            issues={result.issues}
            selectedSlot={selectedSlot}
            onSelectSlot={setSelectedSlot}
            onAddSlot={handleAddSlot}
            onRemoveSlot={handleRemoveSlot}
            bulkActive={inputMode === "bulk"}
            onShowAllOptions={handleShowAllOptions}
          />
        </div>
        <div className="calculator-center" id="equipment-editor-area" aria-label="장비 입력">
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
          <CalculationIssues input={input} result={result} onNavigate={handleNavigate} />
        </div>
      </div>
      <StatSimulator key={`simulation:${input.character.job}:${setupRevision}`} input={input} />
      <CandidateComparisonPanel key={`candidates:${input.character.job}:${setupRevision}`} input={input} initialSlot={selectedSlot} onPresetSelect={handlePresetSelect}
        onEditBaseStats={() => handleNavigate(input.character.pureMain?.trim() ? "character.pureSub" : "character.pureMain")} />
      <footer className="app-footer"><span>플래닛 <span>장비 계산기</span></span><p>이 브라우저에 저장 · 이미지 외부 전송 없음</p><a className="asset-credit" href="https://maplestory.io/" target="_blank" rel="noreferrer">장비 아이콘: MapleStory.io · © NEXON</a><a href="#page-top">맨 위로 ↑</a></footer>
      </fieldset>
    </main>
  );
}
