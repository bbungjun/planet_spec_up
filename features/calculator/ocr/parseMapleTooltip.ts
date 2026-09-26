import { OCR_STAT_NAMES, type OcrStatName, type ParsedTooltipStats, type TooltipOption } from "./types";

const aliases: Record<string, string> = {
  STR: "STR", DEX: "DEX", INT: "INT", LUK: "LUK",
  ALLSTAT: "올스탯", ALLSTATS: "올스탯", 올스탯: "올스탯", 올스텟: "올스탯",
  ATT: "공격력", ATK: "공격력", ATTACK: "공격력", 물리공격력: "공격력", 공격력: "공격력",
  총데미지: "총데미지", 총대미지: "총데미지", 데미지: "총데미지", 대미지: "총데미지",
  TOTALDAMAGE: "총데미지", DAMAGE: "총데미지",
  보스공격력: "보스데미지", 보스데미지: "보스데미지", 보스대미지: "보스데미지",
  보스공격시데미지: "보스데미지", 보스공격시대미지: "보스데미지",
  보스몬스터공격시데미지: "보스데미지", 보스몬스터공격시대미지: "보스데미지",
  방어율무시: "방어율무시", 방어력무시: "방어율무시", 몬스터방어율무시: "방어율무시", 몬스터방어력무시: "방어율무시",
};

export function parseTooltipOption(raw: string): TooltipOption | null {
  const line = raw.normalize("NFKC").toUpperCase()
    .replace(/^[\s·ㆍᆞ•|+'"*«<>\-]+/, "").replace(/[\s|]+$/, "").trim();
  // Requirement rows remain separate from the stats granted by equipment.
  const requirement = line.match(/(?:REQ|REG|RER|RE[@®])\s*(STR|DEX|INT|LUK|LEV|LEVEL)\s*[:;]?\s*(\d+)$/);
  if (requirement) {
    return { label: requirement[1], value: Number(requirement[2]), percent: false, requirement: true, raw };
  }
  const match = line.match(/^([\p{L}][\p{L}\s]*?)\s*[:;]?\s*\+\s*(\d+(?:\.\d+)?)\s*(%)?$/u);
  if (!match) return null;
  const compact = match[1].replace(/\s/g, "");
  if (/^(REQ|REG|RER|ITEM)/.test(compact)) return null;
  const label = Object.hasOwn(aliases, compact) ? aliases[compact] : match[1].trim();
  // A missing percent glyph is ambiguous: retain the raw line for review,
  // instead of treating e.g. an OCR `996` as either 996 damage or 9%.
  if (["총데미지", "보스데미지", "방어율무시"].includes(label) && match[3] !== "%") return null;
  return {
    label,
    value: Number(match[2]), percent: match[3] === "%", requirement: false, raw,
  };
}

export function parseMapleTooltip(text: string): ParsedTooltipStats {
  const stats = Object.fromEntries(OCR_STAT_NAMES.map(name => [name, { flat: 0, percent: 0 }])) as ParsedTooltipStats["stats"];
  const allStat = { flat: 0, percent: 0 };
  const options: TooltipOption[] = [];
  const unparsed: string[] = [];
  let category: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const equipmentType = raw.normalize("NFKC").match(/장비\s*분류\s*[:：;]\s*([가-힣A-Za-z·]{1,30})/);
    if (equipmentType) category = equipmentType[1];
    const option = parseTooltipOption(raw);
    if (!option) {
      if (raw.trim()) unparsed.push(raw);
      continue;
    }
    options.push(option);
    if (option.requirement) continue;
    const totals = option.label === "올스탯" ? allStat
      : Object.hasOwn(stats, option.label) ? stats[option.label as OcrStatName] : undefined;
    if (totals) totals[option.percent ? "percent" : "flat"] += option.value;
  }
  return { stats, allStat, options, unparsed, category };
}
