/** A tooltip title needs a following item-grade/potential marker; dates, stat
 * rows and arbitrary background text are not item names. */
export function tooltipHeader(text: string): { name: string; marker: string } | null {
  const lines = text.split(/\r?\n/).map(line => line.normalize("NFKC").trim()).filter(Boolean);
  const markerIndex = lines.findIndex(line => /\(.*(?:레어|에픽|유니크|레전드리|일반).*아이템/.test(line)
    || /^잠재\s*능력\s*설정\s*불가$/.test(line));
  if (markerIndex <= 0) return null;
  const name = lines[markerIndex - 1].replace(/^[\s|·ㆍᆞ]+/, "").trim();
  if (!/[가-힣A-Za-z]/.test(name) || name.length > 60 || /(?:REQ|ITEM|장비\s*분류|사용\s*가능|\d+년|[:;%])/i.test(name)) return null;
  return { name, marker: lines[markerIndex] };
}
