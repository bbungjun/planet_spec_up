import { parseTooltipOption } from "./parseMapleTooltip";

/** Prefer the pass with more readable lines for each label; never add both
 * passes' copies of the same potential lines together or invent numeric values. */
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
  return [...lines, ...unread].join("\n");
}
