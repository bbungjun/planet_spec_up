import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const output=path.resolve(arg('output',path.join(app,'output/playwright/ocr-numeric-regions-20261010')));
const read=name=>JSON.parse(fs.readFileSync(path.join(output,name),'utf8'));
const score=read('score.json'),segments=read('result-segmentation.json'),predictions=read('result-baseline.json');
const regression=fs.existsSync(path.join(output,'regression/score.json'))?read('regression/score.json'):null;
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const profiles={'current-contrast':'현행 강한 대비','min-inverted':'강한 대비 없는 반전','original-color':'원색'};
const regions={'whole-row':'전체 행','number-fixed-canvas':'숫자만 · 행 크기 유지','number-tight':'숫자만 · 좁게 자름'};
const table=summary=>`<table><thead><tr><th>전처리</th><th>입력</th><th>숫자열 일치</th><th>틀린 숫자</th><th>문자/빈 출력</th><th>분리 실패</th></tr></thead><tbody>${summary.groups.map(g=>`<tr class="${g.variant==='number-tight'?'selected':''}"><td>${profiles[g.profile]}</td><td>${regions[g.variant]}</td><td>${g.correct}/${g.total}</td><td>${g.wrongNumeric}</td><td>${g.nonNumericOrEmpty}</td><td>${g.segmentationFailed}</td></tr>`).join('')}</tbody></table>`;
const cases=segments.rows.map(c=>{
  const results=score.rows.filter(r=>r.id===c.id),original=results.find(r=>r.profile==='original-color'&&r.variant==='number-tight');
  return `<article data-failed="${!original.correct}"><h3>사진 ${c.sample+1} · ${esc(c.target.field)} <span>${original.correct?'일치':'미일치'}</span></h3><div class="images"><div>원본 행<img src="${c.originalPreview}" alt="원본 행"></div><div>분리한 값<img src="${c.numberPreview??c.originalPreview}" alt="분리한 숫자 영역"></div></div><p>정답 숫자열 <b>${esc(original.expected)}</b> · 분리 상태 ${esc(c.failure??'성공')}</p><details><summary>9가지 입력의 실제 출력 보기</summary><table><tr><th>전처리</th><th>입력</th><th>원출력</th><th>일치</th><th>모델 점수</th></tr>${results.map(r=>`<tr><td>${profiles[r.profile]}</td><td>${regions[r.variant]}</td><td>${esc(r.rawText||'빈 출력')}</td><td>${r.correct?'✓':'—'}</td><td>${r.score?.toFixed(3)??'—'}</td></tr>`).join('')}</table></details></article>`;
}).join('');
const regressionSection=regression?`<section><h2>별도 기존 원본 4장 · 8개 요구 조건</h2><p>숫자 영역 분리는 ${regression.summary.segmentationLocated}/8개다. 배경 혼입 또는 기존 행 좌표의 값 누락으로 분리하지 못한 5개도 분모에 포함했다. 이 자료는 이전부터 사용한 회귀 사진이며 신규 사용자 표본이 아니다.</p>${table(regression.summary)}</section>`:'';
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>숫자 영역 분리 기준 실험</title><style>
*{box-sizing:border-box}body{margin:0;background:#f1f5f9;color:#1b304b;font:15px Arial,sans-serif}main{max-width:1200px;margin:32px auto;padding:0 20px}h1{font-size:29px}h2{font-size:21px}h3{font-size:16px}p,li{line-height:1.75}section,article{background:white;border:1px solid #cbd7e6;border-radius:10px;padding:20px;margin:18px 0}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{padding:10px;text-align:left;border-bottom:1px solid #dce3ed}.selected{background:#f0f7ff}th{background:#e8eef6}.images{display:flex;gap:40px;align-items:flex-start}.images>div{flex:1;min-width:0}img{display:block;height:66px;max-width:100%;object-fit:contain;object-position:left;image-rendering:pixelated;margin-top:10px}span{float:right;color:#4d6684}summary{cursor:pointer;padding:8px 0}.note{color:#52677d}#only-failed:checked~#cases article[data-failed="false"]{display:none}code{word-break:break-all}</style><main>
<h1>숫자 영역 분리 · 기존 모델 기준 실험</h1><p>2026-10-10 · 기존 한국어 PP-OCRv5 · 브라우저 WASM · 문자 배치 6 · 학습/문자 치환/숫자 후보 제한 없음</p>
<section><h2>개발 원본 19장 · 40개 값</h2><p>요구 레벨·요구 STR 38개와 숫자 충돌 옵션 2개를 기존 행 좌표에서 추출했다. 40/40개에서 콜론 뒤 값 영역을 분리했다. 정답표는 추론이 끝난 뒤 로컬 채점에만 사용했다.</p><p><b>원색 전체 행 25/40 → 원색 숫자 영역 38/40.</b> 이때 남은 두 값은 0을 한글 문자로 읽은 사례다. 숫자를 잘못 읽은 결과는 없었지만 이 관측이 새 사진 전체의 안전성을 보장하지는 않는다.</p>${table(score.summary)}</section>
<section><h2>비교가 뜻하는 것</h2><ul><li>전체 행과 숫자만 남긴 동일 크기 입력은 행 크기·정렬·배치 패딩을 유지한다. 이 대조에서는 단순히 라벨을 없애는 것만으로 성능이 좋아지지 않았다.</li><li>좁게 자른 입력은 불필요한 빈 공간과 모델 내부 정규화·패딩도 달라진다. 원색 38/40을 라벨 제거만의 효과로 해석하지 않는다.</li><li>강한 대비를 유지한 숫자 입력에는 실제 숫자 오답도 있었다. 숫자 분리 자체가 모든 전처리에서 안전한 것은 아니다.</li><li>이 수치는 숫자 필드의 원출력 비교이며, 장비 전체 성공률이나 앱 자동 저장 성공률이 아니다. 기본 제품 경로는 변경하지 않았다.</li></ul></section>
${regressionSection}<section><h2>결론과 다음 검증 대상</h2><p>숫자 영역 분리의 기준선과 재현 도구를 확보했다. 기본 활성화는 보류한다. 다음 검증 대상은 큰 화면/반투명 배경에서 숫자 끝까지 포함하는 행 영역 확보와 콜론 분리 안정화다. 그 후 같은 숫자 입력을 고정해 인식 모델의 추가 학습 효과를 비교할 수 있다.</p><p class="note">실제 판독 ${predictions.completed}개 비교 · ${esc(score.summary.manifestName)}. 시간에는 진단용 이미지 준비·저장이 포함돼 속도 지표로 사용하지 않는다.</p></section>
<h2>개별 원본과 숫자 영역</h2><input id="only-failed" type="checkbox"><label for="only-failed"> 원색 숫자 입력의 미일치 사례만 표시</label><div id="cases">${cases}</div></main></html>`;
fs.writeFileSync(path.join(output,'report.html'),html);
console.log(path.join(output,'report.html'));
