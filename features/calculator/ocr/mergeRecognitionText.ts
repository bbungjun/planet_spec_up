/**
 * 문자 위치를 얻지 못한 Tesseract 비교 경로에서 두 텍스트 판독을 병합한다.
 * 기본 Paddle의 줄 위치 대조를 대신하는 자동 확정 규칙이 아니라 호환 처리다.
 */
import { parseMapleTooltip, parseTooltipOption } from "./parseMapleTooltip";

/**
 * 항목별로 읽힌 줄이 더 많은 한 회차를 선택해 같은 잠재 줄을 두 번 더하지 않는다.
 * 둘을 합쳐 새 숫자를 만들지 않고 미해석 줄과 원본 장비 분류도 보존한다.
 */
export function mergeRecognitionText(original: string, enlarged: string): string {
  const group = (text: string) => {
    const groups = new Map<string, string[]>();
    for (const line of text.split(/\r?\n/)) {
      const option = parseTooltipOption(line);
      if (!option) continue;
      const key = `${option.requirement}:${option.label}:${option.percent}`;
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }
    return groups;
  };
  const originalGroups = group(original);
  const enlargedGroups = group(enlarged);
  const lines: string[] = [];
  for (const key of new Set([...originalGroups.keys(), ...enlargedGroups.keys()])) {
    const first = originalGroups.get(key) ?? [];
    const second = enlargedGroups.get(key) ?? [];
    lines.push(...(second.length >= first.length ? second : first));
  }
  const unread = enlarged.split(/\r?\n/).filter(line => !parseTooltipOption(line));
  if (!parseMapleTooltip(unread.join("\n")).category) {
    const originalCategory = original.split(/\r?\n/).find(line => /장비\s*분류\s*[:：;]/.test(line));
    if (originalCategory) unread.push(originalCategory);
  }
  return [...lines, ...unread].join("\n");
}
