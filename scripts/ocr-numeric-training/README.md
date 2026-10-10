# 로컬 숫자 OCR 학습 실험

제품 모델과 분리한 한국어 PP-OCRv5 미세조정 도구다. 이미지·라벨·예측·체크포인트는 `output/ocr-numeric-training/`에만 보관한다. 숫자 사전 제한, 문자 치환, 정답 주입을 하지 않는다. 본학습/독립 시험과 구분한 파일럿이며 현재 결과와 미완료 항목은 [학습 계획](../../docs/ocr-accuracy-improvement-plan.md#숫자-학습-실행-결과--2026-10-11)을 따른다.

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

파일럿에서 `validation`이라는 split 이름을 사용해도 파일럿 학습기는 train만 읽고 마지막 epoch를 고정해 저장한다. 매 epoch 검증·조기 종료·검증 기반 최적 체크포인트 선택은 이 도구의 현재 구현에 없다. 작은 자료에서 정상 학습/변환을 확인하는 기능이며 계획의 본학습 컨트롤러를 구현했다고 주장하지 않는다.

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

합성 자료 비교, 별도 새 최종시험, 자동 영역 추출을 포함한 장비 전체 검증, 실제 Worker/취소/적용과 반복 시간·프로세스 메모리 측정은 남아 있다. 연구 모델을 `public/ocr/`로 자동 복사하거나 제품 모델로 교체하지 않는다.
