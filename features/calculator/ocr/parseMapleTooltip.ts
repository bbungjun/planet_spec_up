/**
 * 장비 설명창의 텍스트를 항목명·숫자·%·요구 조건·부위로 해석하는 공통 파서.
 * 원문과 미해석 줄을 보존하며, 숫자 추정과 이미지 좌표 기반 줄 대조는 이 모듈에서 수행하지 않는다.
 */
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

/** 숫자가 통째로 누락되어도 알려진 전투 옵션 이름을 식별해 검토·재시도에 사용한다. */
export function readCombatOptionLabel(raw: string): string | null {
  const label = raw.normalize("NFKC").toUpperCase().replace(/^[\s._·ㆍᆞ•|+'"*«<>:;\-]+/, "")
    .split(/[:;+%]/, 1)[0].replace(/\s/g, "");
  return Object.hasOwn(aliases, label) ? aliases[label] : null;
}

/** 요구 조건의 접두사·항목명·구분자만 정리하고 숫자 부분은 원문으로 남긴다. */
export function readTooltipRequirement(raw: string): { label: string; valueText: string } | null {
  const match = raw.normalize("NFKC").toUpperCase().match(/(?:REQ|REG|RER|REIQ|RE[@®])\s*(STR|STA|DEX|OEX|INT|LUK|LEVEL|LEV|LEU|LEW)(?=\s|[:;!.]|\d|$)[\s:;!]*(.*?)\s*$/);
  if (!match) return null;
  const label = /^(LEVEL|LEV|LEU|LEW)$/.test(match[1]) ? "LEV" : match[1] === "STA" ? "STR" : match[1] === "OEX" ? "DEX" : match[1];
  return { label, valueText: match[2].replace(/[\s;:,.]+$/, "") };
}

/**
 * 항목과 값의 경계가 확인된 문맥에서 허용한 경우에만 O/B를 0/8로 정리한다.
 * 정수/소수 형식에 맞지 않거나 I/Q/S 등 미확인 유사 문자가 남으면 null을 반환한다.
 */
function numericToken(value: string, allowDecimal: boolean, allowLookalikes: boolean): string | null {
  const normalized = allowLookalikes ? value.replace(/O/g, "0").replace(/B/g, "8") : value;
  return (allowDecimal ? /^\d+(?:\.\d+)?$/ : /^\d+$/).test(normalized) ? normalized : null;
}

/**
 * 한 줄의 이름·숫자·%를 해석하고 착용 요구 조건과 장비 보너스를 분리한다.
 * 총데미지·보공·방무에서 %가 빠졌으면 고정 수치로 추정하지 않고 null로 남겨 검토하게 한다.
 */
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
/** 부위 문자열이 현재 알려진 장비 분류인지 검사하며 새 부위를 임의로 정상 분류로 확정하지 않는다. */
export function isKnownEquipmentCategory(value: string): boolean { return equipmentCategories.includes(value); }
/**
 * 장비 분류 줄을 읽고 알려진 긴 부위명과 한 글자만 다른 유일 후보를 정리한다.
 * 알 수 없는 분류는 원래 이름으로 남긴다. 이 제한적인 이름 정리는 숫자 옵션에 적용하지 않는다.
 */
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

/**
 * 전체 텍스트의 옵션·미해석 줄·분류를 보존하고 스탯/올스탯의 고정값과 %를 각각 합산한다.
 * 요구 조건은 options에만 남겨 장비 보너스에 더하지 않는다. 판독 간 같은 줄의 중복 제거는 검토 모듈이 담당한다.
 */
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
