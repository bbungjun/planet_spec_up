/**
 * 등급/잠재 표식을 근거로 장비 이름과 표식을 함께 확인한다.
 * 화면의 날짜·배경 문구·스탯 행을 이름으로 추측하지 않는다.
 */
/**
 * 알려진 아이템 등급 또는 잠재 설정 불가 표식 바로 앞 줄을 이름 후보로 검사한다.
 * 유효한 표식/이름 조합이 없으면 null을 반환한다. 단순히 첫 번째 텍스트 줄을 이름으로 확정하지 않는다.
 */
export function tooltipHeader(text: string): { name: string; marker: string } | null {
  const lines = text.split(/\r?\n/).map(line => line.normalize("NFKC").trim()).filter(Boolean);
  const markerIndex = lines.findIndex(line => /\(.*(?:레어|에픽|유니크|레전드리|일반).*아이템/.test(line)
    || /^잠재\s*능력\s*설정\s*불가$/.test(line));
  if (markerIndex <= 0) return null;
  const name = lines[markerIndex - 1].replace(/^[\s|·ㆍᆞ]+/, "").trim();
  if (!/[가-힣A-Za-z]/.test(name) || name.length > 60 || /(?:REQ|ITEM|장비\s*분류|사용\s*가능|\d+년|[:;%])/i.test(name)) return null;
  return { name, marker: lines[markerIndex] };
}
