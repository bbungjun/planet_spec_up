# 메이플플래닛 장비 성능 비교

장비 스크린샷으로 입력 부담을 줄이고, 실제 캐릭터를 기준으로 장비 성능과 구매 효율을 비교하는 공개 웹앱을 개발합니다.

기준 저장소: [bbungjun/planet_spec_up](https://github.com/bbungjun/planet_spec_up) · 기본 브랜치: `main`

## 현재 구현

- 신궁·캡틴·나이트로드의 스탯공 및 전투 조건별 환산공 계산
- 장비 카드/일괄 입력, 사용자 정의 장비 부위, 키보드 입력 이동
- 브라우저 내부 OCR, 이미지 붙여넣기, 여러 이미지 인식과 중복 검토
- 카오스 보스·일반 보스·사냥용 무기 프리셋 3개
- 총데미지·보공·방무 분리 및 혼테일/핑크빈 공격력 버프 비교
- 로그인 없는 브라우저 개인 세팅 1개 저장

**아직 구현하지 않은 목표:** 실제 순수 스탯 고정 전환, 기존 장비를 보존하는 구매 후보·가격 대비 효율 비교, Vercel 배포 및 공개 SEO 완성. 현재 계산에는 장비 요구치 기반 순수 스탯 자동 배분이 남아 있습니다. 자세한 상태와 검증 한계는 [AGENTS.md](AGENTS.md)를 확인하세요.

## 로컬 실행

Node.js `22.13.0` 이상이 필요합니다.

```powershell
git clone https://github.com/bbungjun/planet_spec_up.git
cd planet_spec_up
npm ci
npm run dev -- --host 0.0.0.0
```

브라우저에서 [localhost:3000](http://localhost:3000/)을 엽니다. 기존 `플래닛` 작업 공간에서는 새 앱을 만들지 않고 `.worktrees/planet-damage-mvp`에서 위 npm 명령을 실행합니다.

OCR 실행 파일과 한글·영문 학습 데이터는 `public/ocr`에 포함되어 있습니다. 이미지와 OCR 텍스트는 외부 OCR API로 보내지 않으며, 검토 후 사용자가 적용합니다. 개인 세팅은 현재 브라우저에 저장되어 다른 기기나 도메인으로 자동 이전되지 않습니다.

## 검증

앱 루트에서 실행합니다.

```powershell
npm test
npm run lint
npm run typecheck
npm run build
```

테스트 병렬 실행으로 자원이 부족하면 `npx vitest run --maxWorkers=4`를 사용합니다. Windows의 한글 경로에서는 빌드 스크립트가 임시 드라이브 별칭을 만들고 종료 시 해제합니다.

## 코드와 문서

| 위치 | 내용 |
| --- | --- |
| `app/` | 페이지, 메타데이터, 스타일 |
| `features/calculator/domain/` | 계산식, 직업·장비·프리셋 규칙 |
| `features/calculator/components/` | 입력·OCR 검토·결과 UI |
| `features/calculator/ocr/` | 로컬 OCR, 옵션 파싱과 적용 |
| `features/calculator/storage.ts` | 브라우저 저장과 이전 데이터 호환 |
| `tests/` | 계산·OCR·저장·UI 회귀 테스트 |
| `public/ocr/` | OCR 실행 자산과 라이선스 |
| `docs/` | 설계, 구현 계획, OCR 비용 조사 |

- [AGENTS.md](AGENTS.md): 최신 확정 정책, 개발 제약, 미구현 항목
- [CONTEXT.md](CONTEXT.md): 도메인 용어
- [agent.md](agent.md): 이전 구현 지침과 이력
- [외부 OCR 비용 참고](docs/ocr-api-costs.md): 조사 자료이며 API 연결·과금 승인을 뜻하지 않음

기술 구성은 React/TypeScript, Next API + Vinext/Vite, Tesseract.js, Vitest입니다. 기존 Cloudflare/Sites 관련 코드와 설정이 남아 있으며 Vercel 호환이 완료된 상태는 아닙니다. 저장소 업로드는 웹사이트 배포와 별개입니다.

## 저장소에 포함하지 않는 자료

개인 장비 스크린샷(`내장비/`), 환경변수와 개인 키, `node_modules/`, 빌드 결과, OCR 임시 캐시, 브라우저 캡처와 도구 로그는 Git에서 제외합니다. 로컬 원본은 그대로 보존합니다. 앱에 필요한 `public/ocr/` 자산은 포함합니다.
