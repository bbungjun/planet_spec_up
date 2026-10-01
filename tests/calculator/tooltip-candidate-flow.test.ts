import {afterEach,beforeEach,expect,it,vi} from "vitest";
const {prepare,create,predict,dispose}=vi.hoisted(()=>({prepare:vi.fn(),create:vi.fn(),predict:vi.fn(),dispose:vi.fn()}));
vi.mock("@paddleocr/paddleocr-js",()=>({PaddleOCR:{create}}));
vi.mock("@/features/calculator/ocr/prepareTooltip.client",()=>({prepareTooltip:prepare}));
vi.mock("@/features/calculator/ocr/enlargeTooltip.client",()=>({enlargeTooltip:async()=>null,
  contrastTooltip:async(file:File)=>new File([file],`mask-${file.name}`,{type:"image/png"}),
  tooltipImageSize:async(file:File)=>file.name.includes("second-tooltip-view")?{width:200,height:400}:{width:300,height:600}}));
import {createPaddleTooltipRecognizer} from "@/features/calculator/ocr/recognizePaddle.client";
import {mapReviewedStats} from "@/features/calculator/ocr/reviewRecognition";
import type {OcrBounds,OcrReview} from "@/features/calculator/ocr/types";

const good:OcrBounds={x:.1,y:.1,width:.3,height:.6},bad:OcrBounds={x:.5,y:.1,width:.3,height:.6};
const source=()=>new File(["synthetic source"],"source.png",{type:"image/png"});
const item=(text:string,y:number,scale=1)=>({text,score:.99,poly:[[10,y],[200,y],[200,y+14],[10,y+14]].map(p=>p.map(n=>n*scale))});
const items=(scale=1)=>[item("테스트 장비",10,scale),item("(일반 아이템)",35,scale),item("REQ STR : 0",80,scale),
  item("장비분류: 망토",200,scale),item("DEX +13",250,scale),item("DEX +7%",330,scale)];
const callbacks=()=>({signal:new AbortController().signal,onProgress:vi.fn(),onPrepared:vi.fn(),onReview:vi.fn()});
beforeEach(()=>{
  vi.resetAllMocks();dispose.mockResolvedValue(undefined);create.mockResolvedValue({initialize:vi.fn().mockResolvedValue(undefined),predict,dispose});
  prepare.mockImplementation(async(_file:File,opts:{region?:OcrBounds})=>{
    if(!opts.region)throw {code:"MULTIPLE_TOOLTIPS",regions:[bad,good],retryable:false};
    return new File(["synthetic crop"],opts.region.x===bad.x?"bad.png":"good.png",{type:"image/png"});
  });
  predict.mockImplementation(async(image:File)=>[{items:image.name.includes("bad")?[item("EQUIPMENT INVENTORY",0),...items()]
    :items(image.name.includes("second-tooltip-view")?2/3:1)}]);
  vi.stubGlobal("createImageBitmap",vi.fn().mockResolvedValue({width:300,height:600,close:vi.fn()}));
  vi.spyOn(document,"createElement").mockReturnValue({width:0,height:0,getContext:()=>({drawImage:vi.fn()}),
    toBlob:(cb:(blob:Blob)=>void)=>cb(new Blob(["scaled pixels"],{type:"image/png"}))} as unknown as HTMLCanvasElement);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it("rejects the wrong first crop, continues to the next, and reuses only the selected crop's mask reading",async()=>{
  const cb=callbacks(),recognizer=createPaddleTooltipRecognizer();await recognizer.recognize(source(),cb);
  expect(cb.onPrepared.mock.calls[0][0].name).toBe("good.png");
  expect(predict.mock.calls.map(call=>call[0].name)).toEqual(["mask-bad.png","mask-good.png","mask-second-tooltip-view.png"]);
  expect(mapReviewedStats(cb.onReview.mock.calls[0][0] as OcrReview,"corsair")).toEqual({requiredSub:"0",mainFlat:"13",mainPercent:"7"});
  await recognizer.terminate();
});
it("falls back to the original color when the mask loses the title, without copying color numbers into the result",async()=>{
  prepare.mockImplementation(async(_file:File,opts:{region?:OcrBounds})=>{
    if(!opts.region)throw {code:"MULTIPLE_TOOLTIPS",regions:[good],retryable:false};return new File(["crop"],"good.png",{type:"image/png"});
  });
  predict.mockImplementation(async(image:File)=>[{items:image.name==="mask-good.png"?items().slice(2)
    :image.name==="good.png"?items().map(i=>({...i,text:i.text.replace("DEX +13","DEX +99")}))
    :items(2/3)}]);
  const cb=callbacks(),recognizer=createPaddleTooltipRecognizer();await recognizer.recognize(source(),cb);
  expect(predict.mock.calls.map(call=>call[0].name)).toEqual(["mask-good.png","good.png","mask-second-tooltip-view.png"]);
  expect(mapReviewedStats(cb.onReview.mock.calls[0][0] as OcrReview,"corsair").mainFlat).toBe("13");
  await recognizer.terminate();
});
it("still rejects two complete separate gear tooltips",async()=>{
  predict.mockImplementation(async()=>[{items:items()}]);
  const cb=callbacks();await expect(createPaddleTooltipRecognizer().recognize(source(),cb)).rejects.toMatchObject({code:"MULTIPLE_TOOLTIPS"});
  expect(cb.onPrepared).not.toHaveBeenCalled();expect(cb.onReview).not.toHaveBeenCalled();
});
it("checks a pixel-selected single candidate and falls through to an alternative if the selected area is wrong",async()=>{
  prepare.mockImplementation(async(_file:File,opts:{region?:OcrBounds;onCandidates?:(result:unknown)=>void})=>{
    if(!opts.region){opts.onCandidates?.({regions:[bad,good],selected:bad});return new File(["wrong selected crop"],"bad.png",{type:"image/png"});}
    return new File(["crop"],opts.region.x===good.x?"good.png":"bad.png",{type:"image/png"});
  });
  const cb=callbacks(),recognizer=createPaddleTooltipRecognizer();await recognizer.recognize(source(),cb);
  expect(cb.onPrepared.mock.calls[0][0].name).toBe("good.png");await recognizer.terminate();
});
it("does not reread a selected crop's source frame as a second tooltip when OCR differs at the border",async()=>{
  const selected={x:.102,y:.102,width:.296,height:.596};
  prepare.mockImplementation(async(_file:File,opts:{region?:OcrBounds;onCandidates?:(result:unknown)=>void})=>{
    if(!opts.region){opts.onCandidates?.({regions:[good,bad],selected,selectedFrame:good});return new File(["crop"],"selected.png",{type:"image/png"});}
    return new File(["crop"],opts.region.x===good.x?"source-frame.png":"bad.png",{type:"image/png"});
  });
  predict.mockImplementation(async(image:File)=>[{items:image.name.includes("bad")?[item("EQUIPMENT INVENTORY",0)]
    :items(image.name.includes("second-tooltip-view")?2/3:1).map(i=>({...i,text:image.name.includes("source-frame")?i.text.replace("테스트 장비","테스트 장8"):i.text}))}]);
  const cb=callbacks(),recognizer=createPaddleTooltipRecognizer();await recognizer.recognize(source(),cb);
  expect(cb.onPrepared.mock.calls[0][0].name).toBe("selected.png");
  expect(predict.mock.calls.map(call=>call[0].name)).toEqual(["mask-selected.png","mask-bad.png","mask-second-tooltip-view.png"]);
  expect(mapReviewedStats(cb.onReview.mock.calls[0][0] as OcrReview,"corsair").mainFlat).toBe("13");
  await recognizer.terminate();
});
it("can still recover from the source frame when the inset crop loses required structure",async()=>{
  const selected={x:.102,y:.102,width:.296,height:.596};
  prepare.mockImplementation(async(_file:File,opts:{region?:OcrBounds;onCandidates?:(result:unknown)=>void})=>{
    if(!opts.region){opts.onCandidates?.({regions:[good],selected,selectedFrame:good});return new File(["inset"],"inset.png",{type:"image/png"});}
    return new File(["frame"],"frame.png",{type:"image/png"});
  });
  predict.mockImplementation(async(image:File)=>[{items:image.name.includes("inset")?[item("제목만",10)]
    :items(image.name.includes("second-tooltip-view")?2/3:1)}]);
  const cb=callbacks(),recognizer=createPaddleTooltipRecognizer();await recognizer.recognize(source(),cb);
  expect(cb.onPrepared.mock.calls[0][0].name).toBe("frame.png");
  expect(mapReviewedStats(cb.onReview.mock.calls[0][0] as OcrReview,"corsair").mainFlat).toBe("13");
  await recognizer.terminate();
});
it("still requires a selection when a selected frame and a separate frame are both complete",async()=>{
  const selected={x:.102,y:.102,width:.296,height:.596};
  prepare.mockImplementation(async(_file:File,opts:{region?:OcrBounds;onCandidates?:(result:unknown)=>void})=>{
    if(!opts.region){opts.onCandidates?.({regions:[good,bad],selected,selectedFrame:good});return new File(["crop"],"selected.png",{type:"image/png"});}
    return new File(["other gear"],"other.png",{type:"image/png"});
  });
  predict.mockResolvedValue([{items:items()}]);
  const cb=callbacks();await expect(createPaddleTooltipRecognizer().recognize(source(),cb)).rejects.toMatchObject({code:"MULTIPLE_TOOLTIPS"});
  expect(cb.onPrepared).not.toHaveBeenCalled();expect(cb.onReview).not.toHaveBeenCalled();
});
it("returns not-found when color and all candidate crops still lack a complete body",async()=>{
  predict.mockResolvedValue([{items:[item("불완전한 창",10)]}]);
  const cb=callbacks();await expect(createPaddleTooltipRecognizer().recognize(source(),cb)).rejects.toMatchObject({code:"TOOLTIP_NOT_FOUND"});
  expect(predict).toHaveBeenCalledTimes(4);expect(cb.onPrepared).not.toHaveBeenCalled();
});
