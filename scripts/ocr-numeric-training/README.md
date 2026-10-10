# 로컬 숫자 OCR 학습 실험

제품 모델과 분리한 한국어 PP-OCRv5 미세조정 도구다. 이미지·라벨·예측·체크포인트는 `output/ocr-numeric-training/`에만 보관한다. 숫자 사전 제한, 문자 치환, 정답 주입을 하지 않는다. 파일럿·외형 증강 비교·새 숫자 영역 시험의 결과와 미완료 항목은 [학습 계획](../../docs/ocr-accuracy-improvement-plan.md#숫자-학습-실행-결과--2026-10-11)을 따른다. 새 시험은 BN1 69/70으로 99% 목표에 미달했으며 제품 적용은 보류다.

## 검증한 환경

- Windows 호스트의 WSL Ubuntu, Python 3.11.15, RTX 3070 Ti 8GB.
- Paddle GPU 3.2.2/CUDA 12.6, paddle2onnx 2.0.1, ONNX Runtime 1.31.0.
- PaddleOCR `release/3.2`의 `242460de229d5df4421ce8d13bf555338c6a4caf`.
- 브라우저 SDK는 앱의 `@paddleocr/paddleocr-js` 0.4.2/ORT Web 1.24.3을 사용한다.
- 학습의 `batch=16`은 제품 OCR의 `batch=6`과 별개다. 현재 실험은 20 epoch, LR `3e-5`, Adam, CTC+NRTR, 원색/높이48/BGR 정규화, 증강 없음이다.
- 기본 GPU 실행이므로 사용자가 GPU 사용을 중단한 동안에는 실행하지 않는다. 전용 Python 환경의 의존성은 `environment-lock.txt`에 고정했다. 앱 의존성을 수정하지 않는다.

설치는 전용 가상환경에서 Paddle GPU를 공식 CUDA 12.6 인덱스로 먼저 설치한 뒤 나머지 고정 의존성을 설치한다. 공식 학습 가중치는 [Paddle의 pretrained 파일](https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model/korean_PP-OCRv5_mobile_rec_pretrained.pdparams)을 사용한다. 실행에 사용한 파일의 SHA256은 `8975dede5e0c2f47e0a7712b3d79ffdc766972f872fd0441ebcccd9d77cd52a3`이다.

## 자료 준비

`prepare.py --review <검수 JSON> --output <새 output 하위 경로>`로 만든다. 검수 JSON의 `rows`에는 `id`, 저장소 상대 `source`, `sourceGroupId`, `split`, `field`, 문자열 `label`, `[x,y,width,height]`의 `crop`, `completeness=complete`, 두 번의 실제 검수 기록 `reviews`가 필요하다. 검수자를 사람이 아닌 에이전트로 기록한 자료를 사람의 검수로 표현하지 않는다.

같은 원본/그룹의 train·validation·test 교차를 거절한다. `diagnostic`은 이미 노출된 회귀 재생 자료이며 독립 시험이나 모델 선택용으로 간주하지 않는다. 기존 디렉터리를 덮어쓰지 않고, 검증이 끝나기 전에 crop을 쓰지 않는다. 생성된 `manifest.json`에는 전체 정답이 있지만 학습기는 train만 담은 `training.json`, 추론은 ID·이미지 경로·hash만 담은 `inputs.json`을 읽는다. 기존 실험에도 동일 train38개의 전용 목록을 추가했고 원래 manifest/crop은 바꾸지 않았다.

`pilot.py`는 `validation`이라는 split 이름을 사용해도 train만 읽고 마지막 epoch를 고정해 저장한다. 별도 `paired-train.py`는 분리된 `training.json`·`validation.json`을 읽고 매 epoch 검증·조기 종료·체크포인트 선택을 수행한다. test/diagnostic 정답은 학습기에 전달하지 않는다.

## 실행 예시

앱 루트에서 WSL Python을 사용한다. 아래 `RUN`은 공개 저장소에 포함되지 않는 검수 자료와 실행 산출물의 경로다.

```bash
TRAIN_PY="$HOME/.venvs/planet-ocr-numeric/bin/python"
RUN=output/ocr-numeric-training/run-20261010
UPSTREAM=output/ocr-numeric-training/PaddleOCR
WEIGHTS=output/ocr-numeric-training/korean_PP-OCRv5_mobile_rec_pretrained.pdparams
export LD_LIBRARY_PATH="/usr/lib/wsl/lib:${LD_LIBRARY_PATH:-}"

# 이미 기록된 실행 ID를 재사용하지 않는다.
"$TRAIN_PY" scripts/ocr-numeric-training/pilot.py train \
  --upstream "$UPSTREAM" --data "$RUN/additional-aran-20261011/data" \
  --weights "$WEIGHTS" --output "$RUN/new-real-pilot" \
  --epochs 20 --batch 16 --lr 0.00003 --seed 20261010 --freeze-bn

"$TRAIN_PY" scripts/ocr-numeric-training/pilot.py evaluate \
  --upstream "$UPSTREAM" --data "$RUN/additional-aran-20261011/data" \
  --weights "$RUN/new-real-pilot/epoch-20.pdparams" --output "$RUN/new-predictions"

"$TRAIN_PY" scripts/ocr-numeric-training/convert.py \
  --upstream "$UPSTREAM" --weights "$RUN/new-real-pilot/epoch-20.pdparams" \
  --output "$RUN/new-conversion" --app-model public/ocr/paddle/models/rec-ko.tar
```

`--freeze-bn`은 BatchNorm의 사전학습 running statistics를 학습 중 유지한다. 모델 구조·한국어 사전·CTC/NRTR 헤드는 유지하고 학습 가능한 계수는 갱신한다. 이 옵션의 효과는 정상 BatchNorm 학습과 별도 실험으로 기록한다.

각 실행은 설정·학습 소스 사본·step별 loss/gradient·epoch별 모델/Adam 상태·RNG·완료 receipt를 저장한다. `--resume <epoch-NN>`은 확장자를 뺀 prefix이며 데이터·가중치·사전·학습 코드·seed/batch/LR/BatchNorm 정책이 일치해야 한다. 이후 목표 epoch는 저장 epoch보다 커야 하고 출력은 새 디렉터리여야 한다. 과거 코드 hash의 체크포인트를 이어서 실행할 때는 해당 실행의 `training-source.py`를 사용한다.

`verify_checkpoint_load.py`는 모델과 Adam 상태가 읽기 직후 정확히 복원되는지 확인한다. `verify_resume.py`는 연속/재개 실행 후 상태의 **완전 일치**를 검사하므로 작은 GPU 수치 차이에도 종료 코드1을 반환한다. 그 실패를 숨기지 않고 개별 최대 오차·허용오차 판정을 함께 보존한다. 현재 결정적 cuDNN 설정에서도 embedding 관련 3개 텐서의 미세 차이가 남으므로 bitwise 재현을 보장하지 않는다.

## 브라우저와 채점

로컬 실행 경로에 `browser-models.json`으로 모델 ID와 저장소 상대 tar 경로를 기록한다. `serve.mjs --run=<경로> --port=3147`은 loopback에서만 이미지·모델·정답 없는 입력 목록을 제공한다. CSP로 외부 요청을 제한한다. 새 모델 목록은 서버 시작 시 고정한다.

`browser.js`는 SDK 일반 CTC와 WASM 1스레드로 배치1/6을 실행하고 원출력·입력/모델 hash를 보존한다. 현재는 recognition-only **메인 스레드** 실험이다. 실제 제품 Worker·취소·저장 흐름이나 속도/메모리 벤치마크의 완료 근거가 아니다.

`score.py --manifest ... --receipt ... --baseline ... --output ...`은 누락/중복 ID, 변경된 입력, 실패/미완료 추론을 거절하고 엄격 문자열 일치·형식만 정리한 일치·틀린 숫자·0 오독·자리 손실을 구분한다. `audit.py --run ... --output ...`은 이번 파일럿 receipt 구조를 대상으로 원본/crop·학습 membership·체크포인트·브라우저 모델 hash·출력 일치를 다시 검사하며 추론을 실행하지 않는다.

```bash
python -m unittest discover -s scripts/ocr-numeric-training -p 'test_*.py'
npx eslint scripts/ocr-numeric-training/browser.js scripts/ocr-numeric-training/serve.mjs
```

외형 증강 비교와 새 숫자 영역 시험은 아래 후속 절을 따른다. 자동 영역 추출을 포함한 장비 전체 검증, 제품의 SDK Worker/취소/적용은 남아 있다. 연구 모델을 `public/ocr/`로 자동 복사하거나 제품 모델로 교체하지 않는다.

## 실제 Worker와 프로세스 비용 후속

`runtime.html`은 별도의 실제 Worker에서 같은 recognition-only 모델을 실행한다. `numeric-runtime.worker.js`가 SDK 코어를 직접 사용하고 `runtime-client.js`가 요청 ID·종료·미결 약속 거절을 관리한다. 제품 SDK의 전체 OCR Worker나 제품 적용/저장 경로를 대체하지 않는다. 초기화 및 판독 중 취소 후 결과 미채택·새 Worker 재시작, 배치1/6, 같은 Worker 재사용을 실제 브라우저로 검사한다.

`measure-runtime.ps1`은 Playwright CLI로 trial별 새 브라우저를 열고 해당 PID의 프로세스 트리만 측정한다. 기존 사용자 브라우저는 닫지 않는다. Working Set/Private Bytes·빈 RAM·Worker 수를 관찰하며6GiB Working Set 또는 빈 RAM3GiB 한도/300초를 넘으면 해당 실험을 종료한다. 기존 trial ID의 결과는 덮어쓰지 않는다. 비교 모델은 번갈아 실행하고 중간에 다른 학습/추론 실험을 병렬 실행하지 않는다.

```powershell
# 서버와 측정은 별도 터미널에서 실행한다.
node scripts/ocr-numeric-training/serve.mjs --run=output/ocr-numeric-training/run-20261010/additional-aran-20261011 --runtime-output=output/ocr-numeric-training/runtime-20261011 --port=3148
./scripts/ocr-numeric-training/measure-runtime.ps1
./scripts/ocr-numeric-training/measure-runtime.ps1 -Cases @('dual01,BN1,6,2,dual','dual02,BN1,6,2,dual','dual03,BN1,6,2,dual','cancel-init,BN1,6,2,cancel-init','cancel-predict,BN1,6,2,cancel-predict','single,BN1,1,2,normal')
python scripts/ocr-numeric-training/runtime-summary.py --output output/ocr-numeric-training/runtime-20261011 --study output/ocr-numeric-training/run-20261010/additional-aran-20261011 --require a01 b01 b02 a02 a03 b03 dual01 dual02 dual03 cancel-init cancel-predict single
```

위 날짜/ID의 실행은 이미 존재한다. 재실행할 때는 새 output과 trial ID를 사용한다. `runtime-summary.py`는 입력/모델 hash·원출력·설정·실제 Worker/WASM·종료/취소 결과가 맞아야 비용을 집계한다. p95는 선형 보간이며 모델당3회 준비/최초 판독·15회 이후 판독으로 표본이 작다. Working Set 합계는 공유 페이지를 중복 계상할 수 있고 샘플링은 순간 피크를 놓칠 수 있다. 측정 소스 snapshot은 `measured-harness/`에 보존했다.

## 고정된 자동 분리 결과 재생

`prepare-auto-replay.py --baseline <ocr-numeric-regions 결과> --study <검수 study> --output <새 경로>`는 과거 `original-color/number-tight` 이미지 중 분리 가능한 것만 추론 입력으로 내보내고 실패 목록은 별도 분모로 보존한다. 수동 crop 수정이나 정답별 전처리 선택은 하지 않는다. 같은 `serve.mjs`와 기본 브라우저 판독으로 A1/BN1을 실행한 뒤 `score-auto-replay.py --run <경로>`로 채점한다. 기존 행 위치를 고정한 재생이므로 새 전체 사진 탐지나 장비 저장의 성공률로 표시하지 않는다.

이 후속의 Worker/비용 검사는 완료했지만 제품의 전체 SDK Worker/취소/적용·장비 전체 검증은 남아 있다.

## 실사와 외형 증강의 동일 노출 비교

`synthesize-crops.py --data <기존 data> --output <새 output 경로>`는 train 숫자 영역만 사용해 배율·명도·약한 blur·padding을 바꾼 3,040개를 생성한다. 기본 seed는 20261011이다. 원본 영역을 잘라내거나 획을 지우지 않고 정답을 유지한다. 새 숫자 조합/글꼴을 렌더링하는 도구가 아니며, 원본에 없는 3·6·9의 글자 모양을 보충하지 않는다. preview를 실제로 검토한 뒤 학습한다.

`paired-train.py`는 두 비교군 모두 매 epoch 각 실사 원본을 두 번 노출한다. `--arm real-replay`는 동일 실사를 반복하고, `--arm real-plus-augmentation`은 두 번째 노출만 같은 원본의 파생 이미지로 바꾼다. 동일 seed로 원본/정답 순서를 맞추고 BN running statistics를 고정한다. 검증 완전일치 증가·틀린 숫자 증가 없음·정상 회귀 0을 만족하는 가장 이른 최상 epoch를 선택한다. 동점 5회면 종료하며 최대 20 epoch다.

```bash
"$TRAIN_PY" scripts/ocr-numeric-training/paired-train.py \
  --upstream "$UPSTREAM" --data "$RUN/additional-aran-20261011/data" \
  --synthetic output/ocr-numeric-training/new-pair/augmentation --weights "$WEIGHTS" \
  --output output/ocr-numeric-training/new-pair/control --arm real-replay
# 다른 새 출력 폴더에서 --arm real-plus-augmentation으로 비교군을 실행한다.
```

실제 두 실행은 각각 6 epoch/30 update에 종료되고 epoch 1을 선택했다. 둘 다 검증 38/38이지만 증강군은 학습 37/38·기존 진단 9/10으로 악화되어 채택하지 않았다. 기존 BN1 후보를 유지했으며 새 시험으로 다른 seed/epoch를 고르지 않았다. `audit-paired.py --run <비교 경로> --study <기존 study>`는 파생 출처·원본/정답 노출 순서·선택 기록·GPU/브라우저 출력을 대조한다. 고정한 글꼴로 새로운 숫자 조합을 만드는 합성 실험과 구분한다.

## 새 원본의 봉인 시험

새 사진은 원본·모델 hash를 먼저 고정한 `pretest-lock.json`, 추론 전 2회 검토한 `review.json`, 입력/정답 hash와 평가 규칙을 고정한 `test-manifest-lock.json`으로 구분한다. 두 검토는 같은 에이전트가 수행했다. `prepare.py`로 test만 준비하면 학습/검증 목록은 비어 있고 추론 입력에는 정답이 없다. A1·B0·BN1을 각 한 번 같은 입력으로 비교한 뒤 같은 BN1 GPU 출력을 변환 대조에만 사용했다.

`audit-final.py --run <새 시험 경로> --prior <기존 study> --conversion <고정 후보 변환 경로> --weights <고정 후보 학습 가중치>`는 봉인 파일·원본/crop/model hash·이전 출처 중복·단일 완결 receipt·추론 순서·GPU/브라우저 일치를 검사한다. 결과는 새로운 `final-audit.json`에만 쓰며 기존 파일을 덮어쓰지 않는다. 시험은 70개 숫자 영역/14장/1회 촬영/보수적 장비 그룹 13개다. 숫자 5개 동시 일치를 장비 전체 성공으로 표현하지 않는다. 결과를 보고 crop·정답·전처리를 수정하거나 모델을 다시 고르지 않는다. 후속 학습에 사용한다면 개발 자료로 재분류하고 별도 새 시험을 확보해야 한다.
