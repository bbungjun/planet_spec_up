# 디렉터리·인터페이스·유지보수 구조 점검

확인일: 2026-09-26. 커밋되지 않은 현재 로컬 구현을 포함해 확인했다. 이 문서의 권장 구조는 제안이며, 파일 이동·OCR 엔진 교체·배포 전환을 완료했다는 의미가 아니다.

## 판단

**계산 도메인 분리와 테스트 기반은 좋다. OCR 작업 상태와 앱 동작을 조합하는 책임은 화면에 많이 남아 있어, 기능이 늘기 전에 이 부분을 정리하는 것이 좋다.** 전체 재작성이나 프론트/백엔드 별도 프로젝트 분리보다 실제 변경이 잦은 OCR와 세팅 저장 흐름을 작은 인터페이스 뒤로 모으는 편이 적합하다.

현재 서비스는 브라우저에서 계산·OCR·개인 세팅 저장을 수행하는 React 앱이다. 서버는 페이지 렌더링·메타데이터·정적 자산 제공을 담당한다. 서비스용 HTTP API와 DB는 현재 사용하지 않는다. `next/headers` 같은 Next 프레임워크 API 사용과 `app/api`의 HTTP 엔드포인트 구현은 구분해야 한다.

## 실제 작업 위치와 현재 구조

실제 앱 루트는 `C:/Users/PC/Documents/플래닛`이며 Git 저장소 루트와 같다. 최초 점검 당시의 `.worktrees/planet-damage-mvp` 배치는 2026-09-26 사용자 결정에 따라 루트 배치로 변경했다. GitHub 저장소에도 동일한 앱 루트 구조를 사용한다. 변경 이유와 검증 결과는 [DECISIONS.md](../DECISIONS.md)의 D-009를 참조한다.

```text
플래닛/                         Git main·실제 앱 루트
├─ app/
│  ├─ page.tsx                    계산기 화면 진입점
│  ├─ layout.tsx                  공통 HTML·메타데이터·요청 호스트 처리
│  ├─ globals.css                 전역 및 계산기/OCR 화면 스타일
│  └─ chatgpt-auth.ts             현재 화면에서 사용하지 않는 인증 헬퍼
├─ features/calculator/
│  ├─ CalculatorApp.tsx           화면 조합·입력 상태·저장·프리셋/OCR 적용
│  ├─ components/                 캐릭터·장비·OCR 검토·결과 화면
│  ├─ domain/                     계산식·정규화·직업·장비·프리셋 규칙
│  ├─ ocr/                        탐지·전처리·엔진·병렬 실행·파싱·검토·적용
│  ├─ hooks/useSavedSetup.ts       localStorage 읽기/쓰기/삭제
│  ├─ storage.ts                  저장 데이터 직렬화·형식 검증
│  └─ labels.ts                   화면 표시용 명칭
├─ public/ocr/                    브라우저 OCR JS/WASM/언어 모델·라이선스
├─ tests/                         계산·OCR·저장·사용자 동작 회귀 테스트
├─ docs/                          정책 보조 문서·과거 설계·검증 지침
├─ worker/                        현재 빌드에 연결된 Cloudflare 서버 진입점
├─ build/sites-vite-plugin.ts     현재 빌드에 연결된 Sites 메타데이터 포장
├─ db/                            D1 접근 헬퍼·비어 있는 스키마
├─ drizzle/                       DB 마이그레이션 관리 틀
├─ examples/d1/                   선택 사용용 DB·notes HTTP API 예제
├─ scripts/                      Windows 경로 대응 등 빌드 실행 보조
├─ output/                        비공개 실험·이미지·진단 보고서, Git 제외
└─ 설정 파일                     Vite/Vinext·TypeScript·ESLint·Vitest
```

실제 `app/api/**/route.ts`는 없다. `examples/d1/app/api/notes/route.ts`는 현재 서비스에 연결된 장비 API가 아니다. `db/schema.ts`는 비어 있고, 앱/계산기에서 `getDb` 또는 `chatgpt-auth`를 사용하는 import도 확인되지 않았다. 반면 `worker/`와 `build/sites-vite-plugin.ts`는 `vite.config.ts`에 실제 연결되어 있으므로 사용하지 않는 예제처럼 삭제하면 안 된다.

현재 흐름:

```text
페이지 → CalculatorApp → 입력/검토 화면
                         ├─ domain → 계산 결과
                         ├─ OCR 작업 → 이미지 준비 → Tesseract → 옵션 파싱·검토
                         └─ 적용·저장 → storage 직렬화 → localStorage
```

OCR 추론과 저장 흐름에 원격 HTTP API는 필요하지 않다. PaddleOCR 실험은 `output/paddle-browser/`에 있으며, 실제 앱 의존성과 기본 엔진은 아직 Tesseract다.

## 잘 분리된 부분

| Module | 현재 Interface | 평가 |
|---|---|---|
| 계산 | `calculateDamageResult(input): CalculationResult` | 입력을 받아 결과·검증 이슈를 반환한다. React·DOM·저장 구현을 참조하지 않아 재사용과 테스트가 쉽다. |
| 입력 정규화 | `normalizeInput` 및 숫자 규칙 | 입력창 문자열과 숫자 계산을 분리한다. 문자열 입력 자체는 문제가 아니며, 현재 정규화 단계를 유지하면 된다. |
| OCR 작업자 풀 | `recognizeBatch(files, options)` | 병렬 제한·동일 이미지 공유·취소·종료를 감춘다. `createRecognizer` 주입으로 실제 WASM 없이 작업 제어를 검증할 수 있다. |
| OCR 검토 | `buildOcrReview`, `mapReviewedStats`, `reviewBlocked` | 불확실한 줄과 확인된 값을 분리하는 기반이 있다. 엔진 교체 시 반드시 보존할 책임이다. |
| 일괄 적용 | `applyOcrBatch(input, job, entries)` | 새 입력 또는 오류를 반환한다. 적용 위치 충돌 시 기존 세팅에 부분 적용하지 않는 정책을 UI 밖에 둔다. |
| 저장 형식 | `serializeSetup`, `deserializeSetup` | JSON 형식 검증과 실제 localStorage 접근이 분리되어 있다. |

테스트는 단순 렌더링 확인뿐 아니라 취소 후 늦은 결과, 중복 인식, 저장 실패 시 검토 보존, 여러 프리셋 저장 등 실제 위험한 동작을 다룬다. 다만 모의 엔진 테스트 통과와 실제 이미지 정확도는 별개이며, 브라우저 이미지 검증을 계속 병행해야 한다.

## 개선 우선순위와 코드 근거

### 1. OCR Interface를 구현 파일에서 독립시키기 — 높은 우선순위

`ocr/recognizeTooltip.client.ts:15`의 `TooltipRecognizer`는 `recognize`와 `terminate`만 노출해 출발점은 좋다. 하지만 계약·오류·파일 제한·Tesseract 로딩·전처리·다중 인식·검토 생성까지 같은 파일에 있다. `recognizeBatch.client.ts:4`와 OCR 화면들이 이 구현 파일에서 타입과 기본 엔진을 함께 가져온다.

또한 반환값은 `Promise<string>`인데 실제 사용에 필요한 이미지와 검토는 `onPrepared`, `onReview` 콜백으로 전달한다. 호출자가 텍스트·이미지·검토를 별도 변수에 모아야 하며 `review`가 선택적이라 엔진 교체 시 검토 없이 텍스트만 전달하는 경로가 가능하다.

권장:

- 엔진 계약과 오류 타입을 `ocr/contracts.ts`로 이동한다.
- 내부 엔진은 텍스트·신뢰도·정규화 좌표를 가진 공통 `OcrReading[]`를 반환한다.
- Tesseract의 `blocks → paragraphs → lines` 변환은 해당 Adapter로 이동한다. 지금은 공통 검토 코드 `reviewRecognition.ts:139`에 해당 형식이 들어 있다.
- UI가 호출하는 상위 Module은 `{ text, preview, review }`를 하나의 최종 결과로 반환한다. 진행률/진행 중 미리보기는 필요하면 이벤트로 유지한다.
- 성공한 결과에 검토가 필수인지, 좌표의 기준이 어느 이미지인지, 취소 후 이벤트 금지, 종료의 멱등성, 재시작 가능 여부를 Interface에 명시한다.
- Tesseract/Paddle 선택은 조합 지점 한 곳에서 한다. 엔진 이름이 UI 분기와 파서 곳곳에 퍼지지 않게 한다.

이미 인식기 주입이 있어 전면 재작성은 필요하지 않다. Paddle 후보가 실제로 생겼으므로 이제 이 Seam을 명확히 할 이유가 있다. Paddle 실험 어댑터는 현재 앱 계약을 만족하는 정식 Adapter로 구현된 상태는 아니다.

### 2. OCR 화면에서 작업 상태와 배정 규칙 분리 — 높은 우선순위

`EquipmentOcrPanel.tsx`는 540줄이며 단일/다중 입력, 비동기 취소, 검토, 재시도, 미리보기와 화면을 함께 관리한다. `EquipmentOcrBatchPanel.tsx`는 283줄이지만 `useEffect` 내부의 `flushInOrder`와 재시도 경로에서 중복 판정·부위 선택·무기 프리셋 추천을 반복한다. 줄 수 자체보다 이 책임 중복이 유지보수 위험이다.

예를 들어 프리셋 추천 규칙을 바꾸면 최초 인식과 재시도 양쪽을 확인해야 한다. `Row`에는 상태 문자열과 여러 nullable 값이 있어 유효하지 않은 조합도 타입상 만들 수 있다.

권장:

- 부위 추천·중복 판정·검토 행 생성을 하나의 순수 정책 함수로 모은다.
- 실행·취소·재시도와 행 상태 전이는 `useEquipmentImport` 및 reducer로 모은다.
- UI는 검토 행을 보여주고 명령을 호출하도록 줄인다. JSX를 작은 파일로 쪼개기만 하는 변경은 우선하지 않는다.
- `ready` 상태에는 결과가 반드시 있고 `error` 상태에는 오류가 반드시 있도록 판별 유니언을 검토한다.

### 3. 세팅 변경·저장 동작을 CalculatorApp에서 분리 — 중상 우선순위

`CalculatorApp.tsx`는 385줄이며 화면 배치 외에 직업 변경, 슬롯 추가/삭제, OCR 적용, 저장, 복원, 프리셋 전환과 오류 위치 이동을 담당한다. 특히 `handleOcrBatchSave`는 검증→프리셋 캡처→저장→화면 반영 순서를 보장한다. 이 순서는 보존하면서 별도 Module로 옮기는 것이 좋다.

`domain/weapon-presets.ts:16`의 `captureWeaponPreset`는 현재 편집 중인 무기를 해당 프리셋에 반영한다. 현재 편집값과 프리셋 스냅샷을 같이 보관하는 것은 명시된 설계이며 즉시 버그라고 볼 수 없다. 그러나 저장·전환 전에 캡처해야 한다는 순서가 Interface의 일부다. 새 구매 후보 화면에서도 호출자가 이 순서를 기억해야 한다면 결합이 커진다.

권장: `application/`에 세팅 변경과 검토 결과 적용·저장을 두고, 저장소 의존성을 주입한다. 현재 localStorage만 필요하므로 범용 CRUD/Repository 프레임워크까지 만들 필요는 없다.

### 4. 배포 설정과 미사용 템플릿 분리 — 중상 우선순위

현재 `vite.config.ts`는 Vinext와 함께 Cloudflare 플러그인, Sites 포장 플러그인을 활성화한다. `db/`, `examples/d1/`, `app/chatgpt-auth.ts`는 현재 제품 흐름에 사용되지 않는다. `app/layout.tsx:22`에는 과거 Sites 도메인이 기본 메타데이터 주소로 남아 있다.

이 구조 때문에 새 기여자는 현재 서비스가 로그인·D1 DB·notes API를 쓰는 것으로 오해할 수 있다. Vercel 목표와 현재 빌드 방식도 다르다.

권장: 사용하지 않는 인증/DB 예제와 실제 빌드 의존성을 구분해서 정리한다. 사용 중인 배포 어댑터는 대체 빌드 확인 후 제거한다. 최종 도메인과 런타임을 확정한 뒤 공개 SEO를 설정한다. 단순 파일 정리를 Vercel 호환 완료로 취급하지 않는다.

### 5. 저장 스키마와 제품 규칙 전환을 명시적으로 관리 — 중상 우선순위

저장은 `schemaVersion: 1`을 유지하면서 여러 선택적 호환 필드를 수용한다. 현재 호환 처리가 있다는 점은 좋지만, 실제 순수 스탯 고정·구매 후보 저장까지 추가하면 형식 검증과 이전 버전 변환이 복잡해진다. `schema.ts`와 `migrations.ts`를 나누고 형식이 실질적으로 바뀔 때 버전별 변환을 명시하는 편이 좋다.

별도로 `domain/calculate.ts:196`에는 장비 요구치 기반 `allocatePureStats` 호출이 남아 있다. 이는 디렉터리 설계 문제가 아니라 확정 정책과 계산 동작의 차이다. 폴더 재배치만으로 해결되지 않으며, 고정 순수 스탯 전환은 별도 기능 작업과 회귀 검증이 필요하다.

### 6. 검사 범위와 스타일 정리 — 작은 변경부터

`output/`은 Git 제외 경로지만 TypeScript의 `**/*.ts` 입력과 ESLint 범위에서는 제외되지 않았다. 실제로 Paddle 실험의 `main.ts`, `postprocess.ts`가 앱 검사에 들어왔고 `navigator.gpu` 타입 오류로 `npm run typecheck`가 실패했다.

이번 점검에서 `tsconfig.json`과 `eslint.config.mjs`에 `output` 제외를 추가했다. 실험 소스는 보존하고 독립 검증 대상으로 유지한다. 수정 후 타입 검사와 린트가 통과했다.

`app/globals.css`는 1,093줄이다. 공통 토큰·리셋·전역 레이아웃은 유지하고 OCR/장비/결과의 상세 스타일은 해당 기능 가까이 옮기면 변경 영향 추적이 쉬워진다. 지금 즉시 모든 파일을 CSS Modules로 변환할 필요는 없다.

## 권장 구조 — 단계적으로 적용할 제안

```text
app/                                   라우팅·공통 문서·전역 스타일
features/calculator/
├─ CalculatorApp.tsx                    화면 조합
├─ components/                         화면 표현과 사용자 입력
├─ application/                        세팅 편집·일괄 적용/저장 작업
├─ hooks/                              React와 작업 Module 연결
├─ domain/                             계산·장비·프리셋 정책 유지
├─ ocr/
│  ├─ contracts.ts                     엔진 및 인식 결과 계약
│  ├─ pipeline.client.ts               탐지→전처리→인식→검토 조합
│  ├─ recognizeBatch.client.ts         작업자 풀 유지
│  ├─ engines/                         Tesseract/Paddle Adapter
│  ├─ image/                           영역 탐지·대비·확대·Worker
│  ├─ parsing/                         옵션 텍스트 해석
│  └─ review/                          줄 대조·충돌·확정 정책
├─ persistence/                        저장 형식·마이그레이션·localStorage
└─ labels.ts                           표시 명칭
tests/                                 위 Module의 Interface별 검증
public/ocr/                            실제 채택한 모델과 런타임만
output/                                비공개 실험/진단, 앱 검사 제외
```

위 구조는 방향이며 빈 폴더부터 전부 만들라는 뜻이 아니다. 우선 OCR 계약과 엔진 Adapter, 중복된 결과 배정 정책부터 실제 코드와 함께 옮긴다. 지금은 서버 API를 만들 이유가 없으므로 `frontend/`, `backend/`, `services/`, `repositories/`를 형식적으로 추가하지 않는다. 브라우저 OCR를 HTTP 요청으로 바꾸는 제안도 아니다.

권장 순서:

1. 검사 범위 분리 — 이번 점검에서 완료.
2. OCR 계약 분리와 공통 검토 결과 정의, 기존 Tesseract 동작 보존.
3. Paddle Adapter를 같은 계약과 취소/종료 테스트로 검증.
4. 최초 인식/재시도 중복 정책과 화면 상태 관리 정리.
5. 세팅 적용·저장 Module와 스키마 마이그레이션 정리.
6. 고정 순수 스탯 기능, 구매 후보 기능, 배포 런타임 전환은 각각 목적에 맞는 작업으로 진행.

## 이번 작업 범위와 검증

- 현재 소스·의존성·프레임워크 설정·테스트를 정적으로 검토했다.
- 앱 기능을 이동하거나 바꾸지 않았다. 실제 변경은 비공개 실험 폴더의 타입/린트 검사 제외와 이 문서·README 연결이다.
- `npm run typecheck` 통과, `npm run lint` 통과.
- 기능 코드 변경이 없어 전체 단위 테스트와 브라우저 UI 테스트를 다시 실행하지 않았다. 기존 테스트의 존재와 내용은 확인했으며 과거 통과 결과를 이번 실행 결과로 표현하지 않는다.
- 기존 작업 변경분과 개인 이미지·저장 데이터를 보존했다.
