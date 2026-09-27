# Browser OCR assets

The application serves these assets from its own origin. Screenshot pixels and OCR text are not sent to an external inference service.

- SDK: `@paddleocr/paddleocr-js` 0.4.2, Apache-2.0. The SDK and its worker are bundled by Vite from the pinned dependency.
- Detection: `PP-OCRv5_mobile_det` ONNX archive, 4,843,520 bytes.
- Korean recognition: `korean_PP-OCRv5_mobile_rec` ONNX archive, 13,537,280 bytes.
- Runtime: `onnxruntime-web` 1.24.3, MIT, single-thread CPU/WASM. The packaged SDK worker uses this runtime version; keep the WASM and JavaScript glue version aligned.
- OpenCV.js: bundled SDK dependency, license in `licenses/OPENCV_LICENSE.txt`.

Official model sources:

- https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar
- https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/korean_PP-OCRv5_mobile_rec_onnx_infer.tar

SHA256:

- `models/det.tar`: `781056046C9ED77A15C94681605DB6A0F62317C2E9CCE6931C71DA2478D4BC30`
- `models/rec-ko.tar`: `568ED8B43A260ADC9F484D92105E425EA8CDDF8CE16940C177BC12864CFB0EB0`

These are upstream model weights, not fine-tuned models. Model archives plus the runtime WASM occupy about 43.4 MB before the SDK/worker code. First-visit download and low-memory device performance need separate measurement; browser caching does not eliminate model initialization or per-worker memory use.
