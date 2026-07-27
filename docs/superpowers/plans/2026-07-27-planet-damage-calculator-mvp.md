# 플래닛 데미지 계산기 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 신궁·캡틴·나이트로드의 장비 값을 피로도 낮은 PC 화면에서 입력하고 행성.com과 동일한 스탯공·환산공을 계산하는 비공개 웹 앱을 만든다.

**Architecture:** vinext 기반 단일 페이지 React 앱으로 구현하되, 계산 규칙은 UI와 브라우저 API에 의존하지 않는 순수 TypeScript 모듈에 둔다. 카드 입력과 일괄 입력은 하나의 상태를 공유하고, 저장 슬롯과 향후 OCR은 정규화된 입력 모델만 계산 엔진에 전달한다.

**Tech Stack:** Node.js 22.13+, TypeScript 5.9, React 19.2, Next-compatible App Router, vinext 0.0.50, Vite 8, Vitest 4.1.10, Testing Library React 16.3.2, Testing Library User Event 14.6.1, Testing Library jest-dom 7.0.0, jsdom 29.0.1

## Global Constraints

- PC 1280px 이상에서 장비 목록, 선택 장비 편집기, 결과 패널을 한 화면에 표시한다.
- MVP 직업은 신궁, 캡틴, 나이트로드뿐이다.
- MVP 결과는 장비 입력 → 스탯공·환산공 계산까지만 제공한다.
- OCR, 무기 잠재 순위, 추가 스펙 시뮬레이터, 다른 계산기, 위키, 챗봇은 구현하지 않는다.
- 로그인과 서버 저장 없이 브라우저 개인 저장 슬롯 1개만 제공한다.
- 빈 입력은 0으로 계산한다.
- 동일 입력의 스탯공·환산공은 2026-07-27 시점 행성.com 결과와 정수 단위까지 일치해야 한다.
- 계산 엔진은 React, DOM, localStorage에 의존하지 않는다.
- 모든 기능과 수정은 실패 테스트 → 최소 구현 → 통과 확인 순서로 진행한다.
- 새 사이트 초기화 후 개발 서버를 열어 둔 상태에서 작업하고, 최종 빌드가 끝날 때까지 유지한다.
- `.openai/hosting.json`의 `project_id`는 생성되거나 반환된 값을 그대로 사용하고 재생성하지 않는다.

## Planned File Structure

```text
app/
  globals.css                         # 제품 토큰, 레이아웃, 반응형 및 상태 스타일
  layout.tsx                          # 사이트 메타데이터와 루트 레이아웃
  page.tsx                            # 계산기 페이지 진입점
features/calculator/
  CalculatorApp.tsx                  # 화면 상태와 계산 엔진 연결
  components/
    AppHeader.tsx                    # 저장, 초기화, 입력 모드 전환
    CharacterPanel.tsx               # 직업·레벨·기타 설정
    EquipmentNavigator.tsx           # 장비 슬롯과 완료 상태
    EquipmentEditor.tsx              # 선택 장비 카드 입력
    BulkEditor.tsx                   # 숙련자용 전체 표 입력
    ResultsPanel.tsx                 # 결과, 근거, 경고와 오류 이동
  domain/
    types.ts                          # 입력·결과·오류 타입
    job-rules.ts                      # 3개 직업 규칙과 슬롯 가시성
    defaults.ts                       # 직업별 기본 세팅
    normalize.ts                      # 입력 파싱과 범위 검증
    equipment.ts                      # 장비 합산과 순수 스탯 배분
    formulas.ts                       # 스탯·공격력·방어율·크리 공식
    calculate.ts                      # 전체 계산 파이프라인
  hooks/
    useSavedSetup.ts                  # 저장 슬롯과 schemaVersion 처리
  storage.ts                          # localStorage 직렬화 경계
tests/
  setup.ts
  calculator/
    job-rules.test.ts
    normalize.test.ts
    equipment.test.ts
    formulas.test.ts
    reference-cases.test.ts
    storage.test.ts
    calculator-app.test.tsx
    keyboard-flow.test.tsx
    bulk-editor.test.tsx
vitest.config.ts
```

---

### Task 1: Site Scaffold and Test Harness

**Files:**
- Create from Sites starter: `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.openai/hosting.json`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Modify: `.gitignore`
- Remove after replacement: `app/_sites-preview/SkeletonPreview.tsx`, `app/_sites-preview/preview.css`

**Interfaces:**
- Consumes: approved design spec at `docs/superpowers/specs/2026-07-27-planet-damage-calculator-mvp-design.md`
- Produces: `npm run dev`, `npm run build`, `npm run test:unit`, jsdom test environment, minimal `/` page

- [ ] **Step 1: Initialize the vinext site once**

Because the repository already contains approved docs, run the Sites initializer once in an empty temporary directory, then copy the generated starter into the repository without the temporary `.git`.

```powershell
$starterRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("planet-site-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $starterRoot | Out-Null
$bashTarget = $starterRoot.Replace('\','/')
& 'C:\Program Files\Git\bin\bash.exe' 'C:/Users/PC/.codex/plugins/cache/openai-bundled/sites/0.1.31/scripts/init-site.sh' $bashTarget
Get-ChildItem -Force -LiteralPath $starterRoot |
  Where-Object Name -ne '.git' |
  Copy-Item -Destination (Get-Location) -Recurse -Force
$resolvedTemp = (Resolve-Path -LiteralPath $starterRoot).Path
$systemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
if (-not $resolvedTemp.StartsWith($systemTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to remove scaffold outside the system temp directory."
}
Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
```

Expected: dependencies install successfully; `.openai/hosting.json` exists; the repository keeps its original `.git` history.

- [ ] **Step 2: Start the development server and open its exact Local URL once**

```powershell
npm run dev
```

Expected: vinext prints one healthy Local URL. Keep this process running through implementation and use the Sites preview opening mechanism once.

- [ ] **Step 3: Install the unit/UI test dependencies**

```powershell
npm install --save-dev vitest@4.1.10 @testing-library/react@16.3.2 @testing-library/user-event@14.6.1 @testing-library/jest-dom@7.0.0 jsdom@29.0.1
```

Add this script to `package.json`:

```json
{
  "scripts": {
    "test:unit": "vitest run"
  }
}
```

- [ ] **Step 4: Write the failing page smoke test**

Create `tests/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
```

Create `tests/calculator/calculator-app.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import Page from "@/app/page";

it("renders the Planet Lab calculator entry point", () => {
  render(<Page />);
  expect(screen.getByRole("heading", { name: "플래닛 데미지 계산기" })).toBeInTheDocument();
});
```

- [ ] **Step 5: Run the smoke test to verify it fails**

Run:

```powershell
npm run test:unit -- tests/calculator/calculator-app.test.tsx
```

Expected: FAIL because the starter page does not contain the requested heading.

- [ ] **Step 6: Replace the starter page with the minimal product entry**

Create `app/page.tsx`:

```tsx
export default function Page() {
  return (
    <main>
      <h1>플래닛 데미지 계산기</h1>
    </main>
  );
}
```

Remove `app/_sites-preview` and any starter preview imports. Remove `react-loading-skeleton` and refresh the lockfile:

```powershell
npm uninstall react-loading-skeleton
```

- [ ] **Step 7: Run the smoke test and build**

Run:

```powershell
npm run test:unit -- tests/calculator/calculator-app.test.tsx
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 8: Commit the scaffold**

```powershell
git add package.json package-lock.json vite.config.ts tsconfig.json app tests vitest.config.ts .openai .gitignore
git commit -m "chore: scaffold Planet damage calculator"
```

---

### Task 2: Domain Types and Job Rules

**Files:**
- Create: `features/calculator/domain/types.ts`
- Create: `features/calculator/domain/job-rules.ts`
- Create: `features/calculator/domain/defaults.ts`
- Create: `tests/calculator/job-rules.test.ts`

**Interfaces:**
- Produces: `JobId`, `EquipmentSlot`, `CalculatorInput`, `CalculationResult`, `ValidationIssue`, `JOB_RULES`, `createDefaultInput(job)`
- Consumers: Tasks 3–8

- [ ] **Step 1: Write failing job rule tests**

Create `tests/calculator/job-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { JOB_RULES } from "@/features/calculator/domain/job-rules";
import { createDefaultInput } from "@/features/calculator/domain/defaults";

describe("MVP job rules", () => {
  it.each([
    ["marksman", "DEX", "STR", "crossbow", 3.6, 4, 270],
    ["corsair", "DEX", "STR", "gun", 3.6, 4, 380],
    ["night_lord", "LUK", "DEX", "claw", 3.6, 25, 150],
  ] as const)(
    "%s has the frozen reference constants",
    (id, main, sub, weapon, weaponConstant, minimumSub, skillPercent) => {
      expect(JOB_RULES[id]).toMatchObject({
        mainStat: main,
        subStat: sub,
        weapon,
        weaponConstant,
        minimumSub,
        defaultSkillPercent: skillPercent,
      });
    },
  );

  it("creates a complete empty input with one record per visible slot", () => {
    const input = createDefaultInput("corsair");
    expect(input.character.level).toBe("160");
    expect(input.character.job).toBe("corsair");
    expect(input.equipment.weapon).toBeDefined();
    expect(input.equipment.overall).toBeDefined();
    expect(input.equipment.top).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm run test:unit -- tests/calculator/job-rules.test.ts
```

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 3: Define the shared domain contracts**

Create `features/calculator/domain/types.ts` with these exact public types:

```ts
export type JobId = "marksman" | "corsair" | "night_lord";
export type StatName = "STR" | "DEX" | "LUK";
export type InputMode = "cards" | "bulk";
export type SharpEyes = "none" | "usable" | "sharp_30";
export type MapleWarrior = 0 | 20 | 30;
export type GuildSkillLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type EquipmentSlot =
  | "necklace" | "cape" | "earrings" | "eye" | "face"
  | "hat" | "shoes" | "gloves" | "overall" | "top" | "bottom"
  | "weapon" | "title" | "ring_1" | "ring_2" | "ring_3" | "ring_4"
  | "projectile" | "blessing_1" | "blessing_2" | "buff";

export type EquipmentInput = {
  mainFlat: string;
  subFlat: string;
  mainPercent: string;
  subPercent: string;
  attackFlat: string;
  attackPercent: string;
  requiredSub: string;
};

export type CharacterInput = {
  job: JobId;
  level: string;
  mapleWarrior: MapleWarrior;
  skillPercent: string;
  sharpEyes: SharpEyes;
  monsterDefense: string;
  bossAndTotalDamage: string;
  ignoreDefense: string;
  criticalRate: string;
  manualPureSub: string;
  nightLordStrStat: string;
  guildBossLevel: GuildSkillLevel;
  guildIgnoreLevel: GuildSkillLevel;
  guildAttackLevel: GuildSkillLevel;
  guildActiveBoss: boolean;
};

export type CalculatorInput = {
  character: CharacterInput;
  equipment: Partial<Record<EquipmentSlot, EquipmentInput>>;
};

export type ValidationIssue = {
  severity: "error" | "warning";
  path: string;
  code: string;
  message: string;
};

export type CalculationResult = {
  mainStat: number;
  subStat: number;
  extraStr: number;
  totalAttack: number;
  statAttack: number;
  convertedAttack: number;
  defenseMultiplier: number;
  criticalMultiplier: number;
  pureMain: number;
  pureSub: number;
  issues: ValidationIssue[];
};
```

- [ ] **Step 4: Implement frozen job and slot rules**

Create `features/calculator/domain/job-rules.ts`:

```ts
import type { EquipmentSlot, JobId, StatName } from "./types";

export type JobRule = {
  id: JobId;
  label: string;
  groupLabel: string;
  mainStat: StatName;
  subStat: StatName;
  weapon: "crossbow" | "gun" | "claw";
  weaponConstant: 3.6;
  minimumSub: number;
  baseCriticalRate: number;
  baseCriticalDamage: number;
  defaultSkillPercent: number;
  visibleSlots: readonly EquipmentSlot[];
};

const COMMON = [
  "necklace", "cape", "earrings", "eye", "face", "hat", "shoes",
  "gloves", "weapon", "title", "ring_1", "ring_2", "ring_3", "ring_4",
  "projectile", "blessing_1", "blessing_2", "buff",
] as const satisfies readonly EquipmentSlot[];

export const JOB_RULES: Record<JobId, JobRule> = {
  marksman: {
    id: "marksman", label: "신궁", groupLabel: "궁수",
    mainStat: "DEX", subStat: "STR", weapon: "crossbow",
    weaponConstant: 3.6, minimumSub: 4,
    baseCriticalRate: 40, baseCriticalDamage: 100, defaultSkillPercent: 270,
    visibleSlots: [...COMMON, "top", "bottom"],
  },
  corsair: {
    id: "corsair", label: "캡틴", groupLabel: "해적",
    mainStat: "DEX", subStat: "STR", weapon: "gun",
    weaponConstant: 3.6, minimumSub: 4,
    baseCriticalRate: 0, baseCriticalDamage: 0, defaultSkillPercent: 380,
    visibleSlots: [...COMMON, "overall"],
  },
  night_lord: {
    id: "night_lord", label: "나이트로드", groupLabel: "도적",
    mainStat: "LUK", subStat: "DEX", weapon: "claw",
    weaponConstant: 3.6, minimumSub: 25,
    baseCriticalRate: 50, baseCriticalDamage: 100, defaultSkillPercent: 150,
    visibleSlots: [...COMMON, "top", "bottom"],
  },
};
```

Create `features/calculator/domain/defaults.ts` with `emptyEquipment()` and `createDefaultInput(job)`. `createDefaultInput` must create only `JOB_RULES[job].visibleSlots`, set level `"160"` as the editable initial default (users may change or temporarily clear it within the UI's 1–200 validation range), skill percent to the job default, Maple Warrior to `20`, Sharp Eyes to `"none"`, all three guild levels to `0`, `guildActiveBoss` to `false`, and all other strings to `""`.

- [ ] **Step 5: Run tests and commit**

```powershell
npm run test:unit -- tests/calculator/job-rules.test.ts
git add features/calculator/domain tests/calculator/job-rules.test.ts
git commit -m "feat: define MVP job rules"
```

Expected: tests PASS and commit succeeds.

---

### Task 3: Normalization, Equipment Aggregation, and AP Allocation

**Files:**
- Create: `features/calculator/domain/normalize.ts`
- Create: `features/calculator/domain/equipment.ts`
- Create: `tests/calculator/normalize.test.ts`
- Create: `tests/calculator/equipment.test.ts`

**Interfaces:**
- Consumes: `CalculatorInput`, `EquipmentSlot`, `JobRule`
- Produces: `parseNumber`, `normalizeInput`, `sumEquipment`, `allocatePureStats`
- Consumer: Task 4

- [ ] **Step 1: Write failing normalization tests**

Create `tests/calculator/normalize.test.ts`:

```ts
import { expect, it } from "vitest";
import { parseNumber } from "@/features/calculator/domain/normalize";

it("treats blank input as zero without an issue", () => {
  expect(parseNumber("", { path: "equipment.weapon.attackFlat", min: 0, max: 9999 }))
    .toEqual({ value: 0, issues: [] });
});

it("converts invalid and out-of-range values to zero with an error", () => {
  expect(parseNumber("-1", { path: "character.level", min: 1, max: 200 }).value).toBe(0);
  expect(parseNumber("abc", { path: "equipment.hat.mainFlat", min: 0, max: 9999 }).issues[0])
    .toMatchObject({ severity: "error" });
});
```

- [ ] **Step 2: Write failing equipment and AP tests**

Create `tests/calculator/equipment.test.ts`:

```ts
import { expect, it } from "vitest";
import { allocatePureStats, sumEquipment } from "@/features/calculator/domain/equipment";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { JOB_RULES } from "@/features/calculator/domain/job-rules";

it("separates attack-percent eligible attack from flat attack", () => {
  const input = createDefaultInput("corsair");
  input.equipment.weapon!.attackFlat = "100";
  input.equipment.gloves!.attackFlat = "10";
  input.equipment.projectile!.attackFlat = "20";
  input.equipment.buff!.attackFlat = "30";

  expect(sumEquipment(input.equipment, JOB_RULES.corsair)).toMatchObject({
    percentEligibleAttack: 110,
    flatAttack: 50,
  });
});

it("allocates the minimum pure substat when there are no requirements", () => {
  expect(allocatePureStats({
    level: 160,
    mapleWarriorRate: 0.1,
    minimumSub: 4,
    equipmentSub: 0,
    equipmentSubPercent: 0,
    requirements: [],
    manualPureSub: null,
  })).toMatchObject({ pureMain: 818, pureSub: 4 });
});

it("uses the swap model and excludes the equipped item's own substat", () => {
  const allocation = allocatePureStats({
    level: 160,
    mapleWarriorRate: 0,
    minimumSub: 4,
    equipmentSub: 60,
    equipmentSubPercent: 0,
    requirements: [{ slot: "weapon", requiredSub: 100, itemSub: 20 }],
    manualPureSub: null,
  });
  expect(allocation.pureSub).toBe(60);
  expect(allocation.pureMain).toBe(762);
});
```

- [ ] **Step 3: Run focused tests to verify failure**

```powershell
npm run test:unit -- tests/calculator/normalize.test.ts tests/calculator/equipment.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement exact normalization ranges**

Create `features/calculator/domain/normalize.ts`. `parseNumber` must use this contract:

```ts
type NumberRule = {
  path: string;
  min: number;
  max: number;
  integer?: boolean;
};

export function parseNumber(
  raw: string,
  rule: NumberRule,
): { value: number; issues: ValidationIssue[] };
```

Rules:

- `raw.trim() === ""` returns `0` and no issue.
- Non-finite values, values below `min`, values above `max`, or non-integers when `integer` is true return `0` and one `error`.
- Level uses integer 1–200.
- Flat stats, attack, requirements use integer 0–9,999.
- Stat%, attack%, boss/total damage use 0–999.
- Defense, ignore defense, critical rate use 0–100.
- Skill percent uses 0–10,000.
- Manual pure substat uses 0–the current AP pool.
- Night Lord stat-window STR uses integer 0–9,999 and is ignored for the other two jobs.

`normalizeInput(input)` must return a numeric snapshot plus all field issues. Do not mutate `input`.

- [ ] **Step 5: Implement equipment aggregation**

Create `features/calculator/domain/equipment.ts`.

`sumEquipment` must:

- Sum main, sub, their percentages, attack percentage, and requirements.
- Treat `blessing_1`, `blessing_2`, `buff`, and `projectile` attack as `flatAttack`.
- Treat attack on all other slots as `percentEligibleAttack`.
- Return one requirement record per slot whose `requiredSub > 0`.

`allocatePureStats` must use:

```text
pool = level × 5 + (level ≥ 120 ? 22 : level ≥ 70 ? 17 : 12)
```

For each required item under the swap model:

```text
availableSub =
  floor(
    (pureSub + totalEquipmentSub - thisItemSub)
    × (1 + equipmentSubPercent / 100)
  )
  + floor(pureSub × mapleWarriorRate)
```

Choose the smallest integer `pureSub >= minimumSub` that satisfies every requirement. If `manualPureSub` is supplied, use it, add a warning when a requirement fails, and set `pureMain = max(0, pool - pureSub)`.

- [ ] **Step 6: Run tests and commit**

```powershell
npm run test:unit -- tests/calculator/normalize.test.ts tests/calculator/equipment.test.ts
git add features/calculator/domain/normalize.ts features/calculator/domain/equipment.ts tests/calculator
git commit -m "feat: normalize and aggregate equipment input"
```

Expected: focused tests PASS.

---

### Task 4: Calculation Formulas and Frozen Reference Cases

**Files:**
- Create: `features/calculator/domain/formulas.ts`
- Create: `features/calculator/domain/calculate.ts`
- Create: `tests/calculator/formulas.test.ts`
- Create: `tests/calculator/reference-cases.test.ts`

**Interfaces:**
- Consumes: normalized character input, equipment aggregate, AP allocation, `JOB_RULES`
- Produces: `mapleWarriorRate`, `calculateTotalStat`, `calculateTotalAttack`, `calculateDefenseMultiplier`, `calculateCriticalMultiplier`, `calculateStatAttack`, `calculateConvertedAttack`, `CalculationSnapshot`, `calculateFromSnapshot(snapshot): CalculationResult`, `calculateDamageResult(input): CalculationResult`
- Consumer: Task 6

- [ ] **Step 1: Write failing formula tests**

Create `tests/calculator/formulas.test.ts`:

```ts
import { expect, it } from "vitest";
import {
  calculateCriticalMultiplier,
  calculateDefenseMultiplier,
  calculateTotalAttack,
  calculateTotalStat,
} from "@/features/calculator/domain/formulas";

it("floors total stat at both reference floor points", () => {
  expect(calculateTotalStat(818, 100, 50, 0.1)).toBe(1458);
});

it("keeps flat attack outside attack percent", () => {
  expect(calculateTotalAttack(100, 30, 10)).toBe(140);
});

it("uses simple defense subtraction", () => {
  expect(calculateDefenseMultiplier(60, 30)).toBe(0.7);
  expect(calculateDefenseMultiplier(60, 80)).toBe(1);
});

it("returns one when skill percent is zero", () => {
  expect(calculateCriticalMultiplier(50, 100, 0)).toBe(1);
});

it("applies the two supported Sharp Eyes bonuses", () => {
  expect(calculateCriticalMultiplier(10, 115, 100)).toBe(1.115);
  expect(calculateCriticalMultiplier(15, 140, 100)).toBe(1.21);
});
```

- [ ] **Step 2: Write failing frozen reference tests**

Create `tests/calculator/reference-cases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { calculateFromSnapshot } from "@/features/calculator/domain/calculate";

const common = {
  level: 160,
  mapleWarrior: 20 as const,
  equipmentMain: 100,
  equipmentSub: 50,
  mainPercent: 50,
  subPercent: 10,
  nightLordStrStat: 0,
  percentEligibleAttack: 100,
  flatAttack: 30,
  attackPercent: 10,
  bossAndTotalDamage: 20,
  monsterDefense: 60,
  ignoreDefense: 30,
  sharpEyes: "none" as const,
  guildBossLevel: 0 as const,
  guildIgnoreLevel: 0 as const,
  guildAttackLevel: 0 as const,
  guildActiveBoss: false,
};

describe("2026-07-27 행성.com frozen cases", () => {
  it.each([
    ["marksman", 7430, 7165],
    ["corsair", 7430, 6241],
    ["night_lord", 7300, 8176],
  ] as const)("matches %s", (job, statAttack, convertedAttack) => {
    expect(calculateFromSnapshot({
      ...common,
      job,
      nightLordStrStat: job === "night_lord" ? 4 : 0,
      skillPercent: job === "marksman" ? 270 : job === "corsair" ? 380 : 150,
    })).toMatchObject({ statAttack, convertedAttack });
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

```powershell
npm run test:unit -- tests/calculator/formulas.test.ts tests/calculator/reference-cases.test.ts
```

Expected: FAIL because formula modules do not exist.

- [ ] **Step 4: Implement the formula primitives**

Create `features/calculator/domain/formulas.ts`:

```ts
export const mapleWarriorRate = (level: 0 | 20 | 30) =>
  level === 30 ? 0.15 : level === 20 ? 0.1 : 0;

export const calculateTotalStat = (
  pure: number,
  equipment: number,
  percent: number,
  mapleWarrior: number,
) => Math.floor((pure + equipment) * (1 + percent / 100))
  + Math.floor(pure * mapleWarrior);

export const calculateTotalAttack = (
  percentEligible: number,
  flat: number,
  percent: number,
) => Math.floor(percentEligible * (1 + percent / 100)) + flat;

export const calculateDefenseMultiplier = (monster: number, ignore: number) =>
  Math.max(0, 1 - Math.max(0, monster - ignore) / 100);

export const calculateCriticalMultiplier = (
  rate: number,
  damage: number,
  skillPercent: number,
) => skillPercent > 0 ? 1 + (rate / 100) * (damage / skillPercent) : 1;

export const calculateStatAttack = (
  main: number,
  sub: number,
  extraStr: number,
  weaponConstant: number,
  attack: number,
) => Math.floor((main * weaponConstant + sub + extraStr) * attack / 100);

export const calculateConvertedAttack = (
  statAttack: number,
  bossAndTotalDamage: number,
  defenseMultiplier: number,
  criticalMultiplier: number,
) => Math.floor(
  statAttack
  * (1 + bossAndTotalDamage / 100)
  * defenseMultiplier
  * criticalMultiplier,
);
```

- [ ] **Step 5: Implement the orchestration pipeline**

Create `features/calculator/domain/calculate.ts`.

- Export a `CalculationSnapshot` type containing every property used by the `common` fixture above plus `job` and `skillPercent`.
- `calculateFromSnapshot(snapshot)` applies job constants and formula primitives to already aggregated numeric values.
- `calculateDamageResult(input)` calls `normalizeInput`, `sumEquipment`, `allocatePureStats`, and `calculateFromSnapshot`.
- Useful Sharp Eyes adds 10 critical rate and 115 critical damage.
- Sharp Eyes 30 adds 15 critical rate and 140 critical damage.
- Guild boss level adds 1% per level, guild ignore level adds 2% per level, guild attack level adds 1 flat attack per level, and the active guild boss skill adds 10% boss damage.
- Night Lord adds the direct `nightLordStrStat` input as `extraStr`; other jobs use 0.
- Missing weapon attack adds warning code `MISSING_WEAPON_ATTACK`.
- The function always returns a complete `CalculationResult`, including accumulated issues.

- [ ] **Step 6: Run all domain tests and commit**

```powershell
npm run test:unit -- tests/calculator/job-rules.test.ts tests/calculator/normalize.test.ts tests/calculator/equipment.test.ts tests/calculator/formulas.test.ts tests/calculator/reference-cases.test.ts
git add features/calculator/domain tests/calculator
git commit -m "feat: calculate frozen Planet damage results"
```

Expected: all domain tests PASS; the three frozen result pairs are exact.

---

### Task 5: Versioned Single-Slot Browser Storage

**Files:**
- Create: `features/calculator/storage.ts`
- Create: `features/calculator/hooks/useSavedSetup.ts`
- Create: `tests/calculator/storage.test.ts`

**Interfaces:**
- Consumes: `CalculatorInput`
- Produces: `STORAGE_KEY`, `serializeSetup`, `deserializeSetup`, `useSavedSetup`
- Consumer: Task 6

- [ ] **Step 1: Write failing storage tests**

Create `tests/calculator/storage.test.ts`:

```ts
import { expect, it } from "vitest";
import { createDefaultInput } from "@/features/calculator/domain/defaults";
import { deserializeSetup, serializeSetup } from "@/features/calculator/storage";

it("round-trips schema version one", () => {
  const input = createDefaultInput("marksman");
  const encoded = serializeSetup(input, "2026-07-27T00:00:00.000Z");
  expect(deserializeSetup(encoded)).toMatchObject({
    ok: true,
    value: { schemaVersion: 1, savedAt: "2026-07-27T00:00:00.000Z", input },
  });
});

it("rejects corrupt and unsupported data without partial merge", () => {
  expect(deserializeSetup("{bad")).toMatchObject({ ok: false });
  expect(deserializeSetup(JSON.stringify({ schemaVersion: 2 }))).toMatchObject({ ok: false });
});
```

- [ ] **Step 2: Run the test to verify failure**

```powershell
npm run test:unit -- tests/calculator/storage.test.ts
```

Expected: FAIL because storage functions do not exist.

- [ ] **Step 3: Implement the storage boundary**

Create `features/calculator/storage.ts`:

```ts
export const STORAGE_KEY = "planet-lab:damage-setup:v1";

export type SavedSetupV1 = {
  schemaVersion: 1;
  savedAt: string;
  input: CalculatorInput;
};

export function serializeSetup(input: CalculatorInput, savedAt = new Date().toISOString()): string;
export function deserializeSetup(raw: string):
  | { ok: true; value: SavedSetupV1 }
  | { ok: false; message: string };
```

Validate the full object shape before returning `ok: true`. Never return a partially parsed setup.

Create `useSavedSetup.ts` with:

```ts
export function useSavedSetup() {
  return {
    load(): ReturnType<typeof deserializeSetup> | { ok: false; message: "empty" },
    save(input: CalculatorInput): void,
    clear(): void,
  };
}
```

Access `window.localStorage` only inside hook callbacks.

- [ ] **Step 4: Run tests and commit**

```powershell
npm run test:unit -- tests/calculator/storage.test.ts
git add features/calculator/storage.ts features/calculator/hooks/useSavedSetup.ts tests/calculator/storage.test.ts
git commit -m "feat: add one versioned setup slot"
```

Expected: storage tests PASS.

---

### Task 6: Three-Panel Calculator Shell and Live Results

**Files:**
- Create: `features/calculator/CalculatorApp.tsx`
- Create: `features/calculator/components/AppHeader.tsx`
- Create: `features/calculator/components/CharacterPanel.tsx`
- Create: `features/calculator/components/EquipmentNavigator.tsx`
- Create: `features/calculator/components/EquipmentEditor.tsx`
- Create: `features/calculator/components/ResultsPanel.tsx`
- Modify: `app/page.tsx`
- Modify: `tests/calculator/calculator-app.test.tsx`

**Interfaces:**
- Consumes: `createDefaultInput`, `calculateDamageResult`, domain types
- Produces: accessible card-only calculator UI and live result updates
- Consumer: Task 7, which adds bulk mode, keyboard flow, and finalized save actions

- [ ] **Step 1: Expand the failing UI test**

Replace `tests/calculator/calculator-app.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Page from "@/app/page";

it("updates the result when equipment input changes", async () => {
  const user = userEvent.setup();
  render(<Page />);

  expect(screen.getByRole("heading", { name: "플래닛 데미지 계산기" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "무기 편집" }));
  await user.type(screen.getByLabelText("무기 공격력"), "100");

  expect(screen.getByLabelText("스탯 공격력 결과")).not.toHaveTextContent("0");
});

it("shows only the three MVP jobs", () => {
  render(<Page />);
  const job = screen.getByLabelText("직업");
  expect(job).toHaveTextContent("신궁");
  expect(job).toHaveTextContent("캡틴");
  expect(job).toHaveTextContent("나이트로드");
});
```

- [ ] **Step 2: Run the UI test to verify failure**

```powershell
npm run test:unit -- tests/calculator/calculator-app.test.tsx
```

Expected: FAIL because the interactive calculator UI does not exist.

- [ ] **Step 3: Implement the client state shell**

`CalculatorApp.tsx` must:

- Start from `createDefaultInput("corsair")`.
- Keep `selectedSlot` and `CalculatorInput` state.
- Derive `result` with `useMemo(() => calculateDamageResult(input), [input])`.
- Keep all input values as strings.
- Update only the targeted equipment field.
- Confirm before resetting or changing job when any equipment field is non-empty.
- On confirmed job change, replace input with `createDefaultInput(newJob)`.
- Render the card editor directly. Task 6 must not import or create `BulkEditor`; Task 7 adds mode state and switching.

Use this composition:

```tsx
<div className="calculator-shell">
  <AppHeader />
  <div className="calculator-workspace">
    <div className="calculator-left">
      <CharacterPanel />
      <EquipmentNavigator />
    </div>
    <div className="calculator-center">
      <EquipmentEditor />
    </div>
    <ResultsPanel />
  </div>
</div>
```

- [ ] **Step 4: Implement accessible panels**

- Every equipment slot is a button named `"{부위} 편집"`.
- Every numeric input has a unique visible label such as `"무기 공격력"`.
- `CharacterPanel` exposes level, Maple Warrior, skill percent, Sharp Eyes, monster defense, boss/total damage, ignore defense, critical rate, manual pure substat, and the three guild skill levels plus active boss toggle.
- `CharacterPanel` exposes `"나이트로드 스탯창 STR"` only when `job === "night_lord"`.
- `ResultsPanel` exposes `aria-label="스탯 공격력 결과"` and `aria-label="환산 공격력 결과"`.
- Completion status uses both `✓` text and styling.
- The result panel renders formula inputs and issue messages.
- Clicking an issue invokes `onNavigate(path)` and selects the related slot.

- [ ] **Step 5: Wire the page and run the test**

Create `app/page.tsx`:

```tsx
import { CalculatorApp } from "@/features/calculator/CalculatorApp";

export default function Page() {
  return <CalculatorApp />;
}
```

Run:

```powershell
npm run test:unit -- tests/calculator/calculator-app.test.tsx
```

Expected: UI tests PASS.

- [ ] **Step 6: Commit the calculator shell**

```powershell
git add app/page.tsx features/calculator tests/calculator/calculator-app.test.tsx
git commit -m "feat: add live three-panel calculator"
```

---

### Task 7: Low-Fatigue Keyboard Flow, Bulk Mode, Validation, and Save Actions

**Files:**
- Create: `features/calculator/components/BulkEditor.tsx`
- Create: `tests/calculator/keyboard-flow.test.tsx`
- Create: `tests/calculator/bulk-editor.test.tsx`
- Modify: `features/calculator/components/EquipmentEditor.tsx`
- Modify: `features/calculator/components/AppHeader.tsx`
- Modify: `features/calculator/components/ResultsPanel.tsx`
- Modify: `features/calculator/CalculatorApp.tsx`

**Interfaces:**
- Consumes: Task 6 calculator state callbacks and Task 5 storage
- Produces: `inputMode`, card/bulk state parity, keyboard navigation, save/load/reset, issue navigation

- [ ] **Step 1: Write failing keyboard and mode parity tests**

Create `tests/calculator/keyboard-flow.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Page from "@/app/page";

it("moves to the next field with Enter and next equipment with Control+Enter", async () => {
  const user = userEvent.setup();
  render(<Page />);
  await user.click(screen.getByRole("button", { name: "목걸이 편집" }));
  const main = screen.getByLabelText("목걸이 DEX");
  main.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByLabelText("목걸이 STR")).toHaveFocus();
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(screen.getByRole("heading", { name: "망토 옵션" })).toBeInTheDocument();
});
```

Create `tests/calculator/bulk-editor.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Page from "@/app/page";

it("shares values between card and bulk modes", async () => {
  const user = userEvent.setup();
  render(<Page />);
  await user.click(screen.getByRole("button", { name: "목걸이 편집" }));
  await user.type(screen.getByLabelText("목걸이 DEX"), "22");
  await user.click(screen.getByRole("button", { name: "일괄 입력 보기" }));
  expect(screen.getByLabelText("일괄 입력 목걸이 DEX")).toHaveValue(22);
});
```

- [ ] **Step 2: Run tests to verify failure**

```powershell
npm run test:unit -- tests/calculator/keyboard-flow.test.tsx tests/calculator/bulk-editor.test.tsx
```

Expected: FAIL because keyboard navigation and bulk mode are missing.

- [ ] **Step 3: Implement deterministic keyboard navigation**

In `EquipmentEditor.tsx`:

- Keep an ordered array of visible field refs.
- `Enter` prevents form submission and focuses the next visible field.
- `Ctrl+Enter` selects the next visible equipment slot and focuses its first field.
- Arrow keys keep native number-input behavior.
- Hidden fields are not included in the order.
- The final slot wraps to the first slot only when the user presses `Ctrl+Enter` again.

- [ ] **Step 4: Implement bulk mode against the same state**

`BulkEditor.tsx` receives the same `input` and `onEquipmentChange` callbacks as the card editor.

- Add `inputMode` state and the card/bulk mode switch to `CalculatorApp.tsx` and `AppHeader.tsx`.
- Rows are the current job's visible slots.
- Columns are only fields applicable to the current job.
- Every cell label follows `"일괄 입력 {부위} {스탯}"`.
- Switching modes changes presentation only and never copies, resets, or reparses state.

- [ ] **Step 5: Implement save, load, reset, and issue navigation**

- Save writes one `SavedSetupV1` and displays its timestamp.
- Load replaces the full calculator input only after successful schema validation.
- Corrupt storage displays one non-blocking error and does not alter current state.
- Save overwrites the existing slot without creating a second slot.
- Reset requires confirmation.
- An error value becomes 0 in calculation but remains visible in its input until the user edits it.
- Clicking a result issue switches to card mode, selects the referenced equipment slot, and focuses the invalid field.

- [ ] **Step 6: Run all UI tests and commit**

```powershell
npm run test:unit -- tests/calculator/calculator-app.test.tsx tests/calculator/keyboard-flow.test.tsx tests/calculator/bulk-editor.test.tsx tests/calculator/storage.test.ts
git add features/calculator tests/calculator
git commit -m "feat: reduce calculator input fatigue"
```

Expected: all focused UI and storage tests PASS.

---

### Task 8: Product Styling, Accessibility, Metadata, and Final Verification

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Modify: `features/calculator/components/*.tsx`
- Modify: `tests/rendered-html.test.mjs` only if its starter assertions reference removed preview content

**Interfaces:**
- Consumes: complete calculator UI
- Produces: finished responsive product, product metadata, verified production build

- [ ] **Step 1: Add the approved design system**

In `app/globals.css`, define and use these tokens:

```css
:root {
  --bg: #08111d;
  --surface: #0d1726;
  --surface-raised: #101c2e;
  --line: #26364e;
  --text: #eef5ff;
  --muted: #8195ae;
  --accent: #68dfaf;
  --accent-soft: #17372d;
  --warning: #e8bf76;
  --danger: #ff7d89;
  --focus: #8db5ff;
}
```

Implement:

- 230px left column, fluid center column, 270px sticky result column at 1280px+.
- 44px minimum interactive target height.
- Visible `:focus-visible` outline using `--focus`.
- Error text plus icon; do not rely on color alone.
- Tabular numerals for inputs and result values.
- At widths below 1000px, move results below the editor without losing state.
- Respect `prefers-reduced-motion`.

- [ ] **Step 2: Update metadata**

Set `app/layout.tsx` metadata:

```ts
export const metadata = {
  title: "플래닛 데미지 계산기",
  description: "신궁, 캡틴, 나이트로드의 장비 스탯과 환산 공격력을 빠르게 계산합니다.",
};
```

Remove starter `codex-preview` metadata and starter title/description.

- [ ] **Step 3: Run the full verification suite**

```powershell
npm run test:unit
npm run test
npm run lint
npm run build
git diff --check
```

Expected:

- All Vitest unit and UI tests PASS.
- The starter rendered HTML test PASS after any required assertion update.
- ESLint exits 0.
- Production build exits 0.
- `git diff --check` prints no errors.

- [ ] **Step 4: Review the spec coverage**

Confirm with repository evidence:

- Exactly three jobs are exposed.
- Card and bulk modes share state.
- Blank values calculate as 0.
- One browser save slot survives reload.
- The three frozen job cases match their exact expected integers.
- OCR, wiki, chatbot, and excluded calculators are absent.

- [ ] **Step 5: Commit the finished product**

```powershell
git add app features tests package.json package-lock.json .openai
git commit -m "feat: finish Planet damage calculator MVP"
```

- [ ] **Step 6: Publish the verified private site**

Use the `sites-hosting` skill and Sites connector:

1. Read `.openai/hosting.json`. If it has no `project_id`, create the Site exactly once and persist the returned opaque ID verbatim.
2. Push the exact committed source state.
3. Package an archive from that same commit.
4. Save one site version whose `commit_sha` is the pushed commit.
5. Verify the site is owner-only.
6. Deploy with the private deployment action.
7. If deployment is not terminal, inspect status until it succeeds or returns a concrete failure.
8. Confirm `.openai/hosting.json` contains the exact `project_id` returned by Sites.
9. Stop the retained development server after hosting completes.

Expected: a production Sites URL accessible to the owner, ready for later access-control changes when the user chooses how to share it with guild members.

---

## Final Acceptance Checklist

- [ ] `npm run test:unit` passes.
- [ ] `npm run test` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] 신궁 fixture returns `statAttack=7430`, `convertedAttack=7165`.
- [ ] 캡틴 fixture returns `statAttack=7430`, `convertedAttack=6241`.
- [ ] 나이트로드 fixture returns `statAttack=7300`, `convertedAttack=8176`.
- [ ] 저장 슬롯은 한 개뿐이며 schema version은 1이다.
- [ ] 카드 입력과 일괄 입력이 동일한 상태를 편집한다.
- [ ] PC 1280px 이상에서 3열 레이아웃이 유지된다.
- [ ] 오류 항목에서 관련 입력으로 이동할 수 있다.
- [ ] 제외 기능이 UI나 도메인에 섞여 있지 않다.
- [ ] 최종 커밋과 저장·배포된 버전의 소스가 동일하다.
