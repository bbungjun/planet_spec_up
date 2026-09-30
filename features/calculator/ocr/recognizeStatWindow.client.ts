"use client";

/**
 * 능력창 전용 OCR의 보존된 호환/회귀 경로. 현재 화면의 능력창 사진 등록 기능은 제거되어 있다.
 * 밝은 능력창에는 장비 설명창의 흰 글자 마스크를 적용하지 않고 숫자 행을 별도 처리한다.
 */

import { paddleReadings } from "./recognizePaddle.client";
import { isSupportedTooltipImage, MAX_TOOLTIP_IMAGE_BYTES } from "./recognizeTooltip.client";
import { parseStatWindow, reconcileStatReads, statRows, type StatRecognition } from "./parseStatWindow";
import { sameStatNumberRow, statNumberMissing, statNumberRegions, statNumberRows } from "./statNumberRegions";
import { prepareStatNumbers, STAT_NUMBER_VIEWS } from "./prepareStatNumbers.client";
import type { OcrReading } from "./types";

/**
 * 텍스트 앵커로 능력창 영역을 찾아 2/3배로 읽고 순수+추가=합계 관계와 두 결과의 일치를 검사한다.
 * 두 판독이 같은 숫자 행을 찾았으나 값이 빠진 경우 원본 숫자 셀을 모아 재판독한다. 실패하면 기본 결과를 유지하고 취소/완료 시 엔진 자원을 해제한다.
 */
export async function recognizeStatWindow(file: File, signal: AbortSignal, progress: (message: string)=>void): Promise<StatRecognition> {
  if (!isSupportedTooltipImage(file) || file.size > MAX_TOOLTIP_IMAGE_BYTES) throw new Error("12MB 이하 PNG/JPG/WebP 이미지를 선택해주세요.");
  const active = () => { if(signal.aborted) throw new DOMException("Cancelled","AbortError"); };
  active(); progress("능력창 인식 모델을 준비하고 있습니다.");
  const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
  active();
  const base = new URL("/ocr/paddle/",location.href);
  const engine = await PaddleOCR.create({ initialize:false, worker:true,
    textDetectionModelName:"PP-OCRv5_mobile_det",textDetectionModelAsset:{url:new URL("models/det.tar",base).href},
    textRecognitionModelName:"korean_PP-OCRv5_mobile_rec",textRecognitionModelAsset:{url:new URL("models/rec-ko.tar",base).href},
    textDetLimitSideLen:1600,textDetLimitType:"max",textRecognitionBatchSize:6,
    ortOptions:{backend:"wasm",wasmPaths:new URL("ort/",base).href,numThreads:1,simd:true},
  });
  let disposed=false;
  const dispose=async()=>{if(!disposed){disposed=true;await engine.dispose().catch(()=>undefined);}};
  const cancel=()=>{void dispose();};
  signal.addEventListener("abort",cancel,{once:true});
  try {
    active(); await engine.initialize(); active();
    const bitmap=await createImageBitmap(file);
    try {
      progress("화면에서 스탯과 공격력 행을 찾고 있습니다.");
      const [full]=await engine.predict(file); active();
      const readings=paddleReadings(full.items,bitmap.width,bitmap.height,0);
      // Locate by text anchors rather than screenshot size or fixed coordinates.
      const anchors=readings.filter(r=>/STR|DEX|LUK|INT|CHARACTER|레벨|직업|공격력|총.?데미지|보스.?데미지|방어.?무시|크리.?확률|명중/i.test(r.text));
      if(anchors.filter(r=>/STR|DEX|LUK|INT/i.test(r.text)).length<2) return {...parseStatWindow(statRows(readings)),warnings:["능력창을 찾지 못했습니다. 캐릭터 스탯과 상세 공격력 창이 함께 보이도록 잘라 다시 넣어주세요."],automatic:false};
      const left=Math.max(0,Math.min(...anchors.map(r=>r.bounds!.x))-.02);
      const top=Math.max(0,Math.min(...anchors.map(r=>r.bounds!.y))-.03);
      const right=Math.min(1,Math.max(...anchors.map(r=>r.bounds!.x+r.bounds!.width))+.12);
      const bottom=Math.min(1,Math.max(...anchors.map(r=>r.bounds!.y+r.bounds!.height))+.03);
      const passes: StatRecognition[] = [];
      const passLines: string[][] = [];
      const numberAnchors: OcrReading[][] = [];
      for(const scale of [2,3]) {
        active(); progress(`능력창 숫자를 대조하고 있습니다 (${passes.length+1}/2).`);
        const canvas=document.createElement("canvas"), w=(right-left)*bitmap.width,h=(bottom-top)*bitmap.height;
        const factor=Math.min(scale,Math.sqrt(8_000_000/(w*h)));
        canvas.width=Math.round(w*factor);canvas.height=Math.round(h*factor);
        const context=canvas.getContext("2d");if(!context)throw new Error("이미지를 처리하지 못했습니다.");
        context.imageSmoothingEnabled=false;context.drawImage(bitmap,left*bitmap.width,top*bitmap.height,w,h,0,0,canvas.width,canvas.height);
        const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/png"));
        if(!blob)throw new Error("이미지를 처리하지 못했습니다.");
        active();const [output]=await engine.predict(new File([blob],"stat-window.png",{type:"image/png"}));active();
        const positioned = paddleReadings(output.items,canvas.width,canvas.height,passes.length);
        numberAnchors.push(positioned.map(reading => ({ ...reading, bounds: reading.bounds && {
          x: left + reading.bounds.x * (right-left), y: top + reading.bounds.y * (bottom-top),
          width: reading.bounds.width * (right-left), height: reading.bounds.height * (bottom-top),
        } })));
        const lines = statRows(positioned);
        passLines.push(lines); passes.push(parseStatWindow(lines));
      }
      const original = reconcileStatReads(passes[0],passes[1]);
      const regionPasses = numberAnchors.map(pass => statNumberRegions(pass, bitmap.width / bitmap.height));
      const regions = regionPasses[0].filter(region => regionPasses[1].some(other => sameStatNumberRow(region, other))
        && passes.some(pass => statNumberMissing(region.label, pass.draft)));
      if (!regions.length) return original;
      try {
        const focused: string[][] = [];
        for (const view of STAT_NUMBER_VIEWS) {
          active(); progress("미인식 숫자 영역을 좁혀 대조하고 있습니다.");
          const prepared = await prepareStatNumbers(bitmap, regions, view); active();
          if (!prepared) return original;
          const [output] = await engine.predict(prepared.file); active();
          focused.push(statNumberRows(paddleReadings(output.items,prepared.width,prepared.height,focused.length), prepared.regions));
        }
        // Retain the original evidence: focused reads cannot outvote numeric conflicts.
        return reconcileStatReads(parseStatWindow([...passLines[0], ...focused[0]]), parseStatWindow([...passLines[1], ...focused[1]]));
      } catch { active(); return original; }
    } finally { bitmap.close(); }
  } finally { signal.removeEventListener("abort",cancel);await dispose(); }
}
