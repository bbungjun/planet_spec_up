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
  크리티컬확률: "크리티컬확률", 크리확률: "크리티컬확률", 크리티컬확율: "크리티컬확률", 크리확율: "크리티컬확률",
  CRITICALRATE: "크리티컬확률", CRITICALCHANCE: "크리티컬확률",
};

/** Recognize an option heading even if OCR dropped its entire numeric value. */
export function readCombatOptionLabel(raw: string): string | null {
  const label = raw.normalize("NFKC").toUpperCase().replace(/^[\s._·ㆍᆞ•|+'"*«<>:;\-]+/, "")
    .split(/[:;+%]/, 1)[0].replace(/\s/g, "");
  return Object.hasOwn(aliases, label) ? aliases[label] : null;
}

/** Normalize only the requirement label and separators; ambiguous digits stay raw. */
export function readTooltipRequirement(raw: string): { label: string; valueText: string } | null {
  const match = raw.normalize("NFKC").toUpperCase().match(/(?:REQ|REG|RER|REIQ|RE[@®])\s*(STR|STA|DEX|OEX|INT|LUK|LEVEL|LEV|LEU|LEW)(?=\s|[:;!.]|\d|$)[\s:;!]*(.*?)\s*$/);
  if (!match) return null;
  const label = /^(LEVEL|LEV|LEU|LEW)$/.test(match[1]) ? "LEV" : match[1] === "STA" ? "STR" : match[1] === "OEX" ? "DEX" : match[1];
  return { label, valueText: match[2].replace(/[\s;:,.]+$/, "") };
}

/** Use the declared field type only after the label/value boundary is known.
 * Keep unverified lookalikes (I/Q/S, etc.) unresolved and retain the raw text. */
function numericToken(value: string, allowDecimal: boolean, allowLookalikes: boolean): string | null {
  const normalized = allowLookalikes ? value.replace(/O/g, "0").replace(/B/g, "8") : value;
  return (allowDecimal ? /^\d+(?:\.\d+)?$/ : /^\d+$/).test(normalized) ? normalized : null;
}

export function parseTooltipOption(raw: string): TooltipOption | null {
  const line = raw.normalize("NFKC").toUpperCase()
    .replace(/^[\s._·ㆍᆞ•|+'"*«<>:;\-]+/, "").replace(/[\s|;:,.]+$/, "").trim()
    .replace(/^5TR(?=\s*[:;+])/, "STR").replace(/^0EX(?=\s*[:;+])/, "DEX");
  // Requirement rows remain separate from the stats granted by equipment.
  const requirement = readTooltipRequirement(line);
  const requirementValue = requirement ? numericToken(requirement.valueText, false, true) : null;
  if (requirement && requirementValue !== null) {
    return { label: requirement.label, value: Number(requirementValue), percent: false, requirement: true, raw };
  }
  const match = line.match(/^([\p{L}][\p{L}\s]*?)\s*([:;])?\s*(\+)?\s*([0-9OB]+(?:\.[0-9OB]+)?)\s*(%)?$/u);
  if (!match || (!match[2] && !match[3])) return null;
  const compact = match[1].replace(/\s/g, "");
  if (/^(REQ|REG|RER|ITEM)/.test(compact)) return null;
  const known = Object.hasOwn(aliases, compact);
  if (!match[3] && !known) return null;
  const value = numericToken(match[4], true, known && !!match[2]);
  if (value === null) return null;
  const label = known ? aliases[compact] : match[1].trim();
  // A missing percent glyph is ambiguous: retain the raw line for review,
  // instead of treating e.g. an OCR `996` as either 996 damage or 9%.
  if (["총데미지", "보스데미지", "방어율무시", "크리티컬확률"].includes(label) && match[5] !== "%") return null;
  return {
    label,
    value: Number(value), percent: match[5] === "%", requirement: false, raw,
  };
}

const equipmentCategories = ["얼굴장식", "눈장식", "어깨장식", "펜던트", "목걸이", "귀고리", "귀걸이", "한벌옷", "모자", "망토", "장갑", "신발", "상의", "하의", "반지", "훈장", "벨트", "건", "석궁", "아대", "폴암", "무기"];
export function isKnownEquipmentCategory(value: string): boolean { return equipmentCategories.includes(value); }
export function parseEquipmentCategory(raw: string): string | null {
  const match = raw.normalize("NFKC").match(/[장잠창참]비\s*분류\s*[:：;]\s*([가-힣A-Za-z·]{1,30})/);
  if (!match) return null;
  const label = match[1];
  if (equipmentCategories.includes(label)) return label;
  // Only a unique one-character substitution in a known, multi-character
  // category is normalized. Numeric options never use fuzzy substitution.
  const candidates = equipmentCategories.filter(category => category.length >= 3 && category.length === label.length
    && [...category].filter((character, i) => character !== label[i]).length === 1);
  return candidates.length === 1 ? candidates[0] : label;
}

export function parseMapleTooltip(text: string): ParsedTooltipStats {
  const stats = Object.fromEntries(OCR_STAT_NAMES.map(name => [name, { flat: 0, percent: 0 }])) as ParsedTooltipStats["stats"];
  const allStat = { flat: 0, percent: 0 };
  const options: TooltipOption[] = [];
  const unparsed: string[] = [];
  let category: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const equipmentType = parseEquipmentCategory(raw);
    if (equipmentType) category = equipmentType;
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
