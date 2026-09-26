import { JOB_RULES, type JobRule } from "../domain/job-rules";
import { useMemo } from "react";
import { calculateDamageResult } from "../domain/calculate";
import { normalizeInput } from "../domain/normalize";
import { sumEquipment } from "../domain/equipment";
import { calculateTotalAttack } from "../domain/formulas";
import { emptyEquipment } from "../domain/defaults";
import { ATTACK_BUFF_PRESETS } from "./AttackSetupPanel";
import type {
  CalculationResult,
  CalculatorInput,
  CharacterInput,
  EquipmentInput,
  EquipmentSlot,
  JobId,
} from "../domain/types";
import { getEquipmentSlotLabel } from "../domain/slots";
import { EQUIPMENT_FIELD_DEFINITIONS } from "./EquipmentEditor";
import { activeWeaponPreset, WEAPON_PRESETS } from "../domain/weapon-presets";

type ResultsPanelProps = {
  job: JobId;
  input: CalculatorInput;
  result: CalculationResult;
  onNavigate: (path: string) => void;
};

const integerFormat = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 0,
});

const decimalFormat = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const percentFormat = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 20,
});

const CHARACTER_FIELD_LABELS: Partial<Record<keyof CharacterInput, string>> = {
  level: "레벨",
  skillPercent: "타격당 평균 데미지 비율",
  monsterDefense: "몬스터 방어율",
  bossAndTotalDamage: "보스 공격력 및 총데미지",
  totalDamagePercent: "기타 총데미지%",
  bossDamagePercent: "기타 보스공격력%",
  ignoreDefense: "방어율 무시",
  criticalRate: "추가 크리티컬 확률",
  manualPureSub: "순수 부스탯 수동값",
  nightLordStrStat: "나이트로드 스탯창 STR",
};

function issueContext(path: string, rule: JobRule, input: CalculatorInput): string {
  const [group, candidate, fieldCandidate] = path.split(".");

  if (group === "equipment") {
    const slot = candidate as EquipmentSlot;
    const field = fieldCandidate as keyof EquipmentInput;
    const fieldDefinition = EQUIPMENT_FIELD_DEFINITIONS.find(
      (definition) => definition.field === field,
    );
    const slotLabel = getEquipmentSlotLabel(input, slot);
    if (slotLabel !== undefined && fieldDefinition !== undefined) {
      return `${slotLabel} ${
        fieldDefinition.suffix(rule.mainStat, rule.subStat)
      }`;
    }
  }

  if (group === "character") {
    return CHARACTER_FIELD_LABELS[candidate as keyof CharacterInput] ?? path;
  }

  return path;
}

export function ResultsPanel({
  job,
  input,
  result,
  onNavigate,
}: ResultsPanelProps) {
  const rule = JOB_RULES[job];
  const extraStat = job === "night_lord" ? " + STR" : "";
  const missingWeapon = result.issues.some(issue => issue.code === "MISSING_WEAPON_ATTACK");
  const buffComparisons = useMemo(() => ATTACK_BUFF_PRESETS.filter(({attack}) => attack > 0).map(preset => ({
    ...preset,
    result: calculateDamageResult({
      ...input,
      equipment: {...input.equipment, buff: {...(input.equipment.buff ?? emptyEquipment()), attackFlat: String(preset.attack)}},
    }),
  })), [input]);
  const attackSources = useMemo(() => {
    const normalized = normalizeInput(input).value;
    const totals = sumEquipment(normalized.equipment, JOB_RULES[input.character.job], (input.customSlots ?? []).map(({id}) => id));
    return [
      ["장비 (% 적용 후)", calculateTotalAttack(totals.percentEligibleAttack, 0, totals.attackPercent)],
      ["불릿·표창", normalized.equipment.projectile?.attackFlat ?? 0],
      ["정령의 축복", normalized.equipment.blessing_1?.attackFlat ?? 0],
      ["여제의 축복", normalized.equipment.blessing_2?.attackFlat ?? 0],
      ["공격력 버프", normalized.equipment.buff?.attackFlat ?? 0],
      ["길드 공격력", normalized.character.guildAttackLevel],
    ] as const;
  }, [input]);

  return (
    <aside className="panel results-panel" aria-label="계산 결과">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">실시간 결과</p>
          <h2>계산 결과</h2>
        </div>
        <span className="live-badge">LIVE</span>
      </div>

      <div className="primary-results">
        <div className="result-card is-primary">
          <span>최대 스탯 공격력</span>
          <output aria-label="스탯 공격력 결과">
            {integerFormat.format(result.statAttack)}
          </output>
          <small>게임 스탯창 공격력의 오른쪽 값</small>
        </div>
        <div className="result-card">
          <span>환산 공격력</span>
          <output aria-label="환산 공격력 결과">
            {integerFormat.format(result.convertedAttack)}
          </output>
          <small>{WEAPON_PRESETS.find(preset => preset.id === activeWeaponPreset(input))!.label} · {activeWeaponPreset(input) === "hunting" ? "보공 제외" : "보공 포함"} · 방무·크리 반영</small>
        </div>
      </div>

      <section className="buff-comparison" aria-label="버프별 스탯공 비교">
        <h3>버프별 최대 스탯공</h3>
        {buffComparisons.map(({label, attack, result: comparison}) => (
          <div key={label} className={Number(input.equipment.buff?.attackFlat) === attack ? "is-active" : ""}>
            <span>{label} <small>+{attack}</small></span>
            <output aria-label={`${label} 예상 스탯공`}>{missingWeapon ? "—" : integerFormat.format(comparison.statAttack)}</output>
          </div>
        ))}
        <p>{missingWeapon ? "무기 공격력을 입력하면 비교값을 표시합니다." : "현재 장비에서 각 버프를 따로 적용한 값"}</p>
      </section>

      <details className="attack-breakdown">
        <summary>공격력 합산 내역 <strong>{integerFormat.format(result.totalAttack)}</strong></summary>
        <dl>{attackSources.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>+{integerFormat.format(value)}</dd></div>)}</dl>
      </details>

      <section className="result-details" aria-labelledby="formula-heading">
        <h3 id="formula-heading">계산 근거</h3>
        <dl>
          <div>
            <dt>최종 주스탯</dt>
            <dd>{integerFormat.format(result.mainStat)} {rule.mainStat}</dd>
          </div>
          <div>
            <dt>최종 부스탯</dt>
            <dd>{integerFormat.format(result.subStat)} {rule.subStat}</dd>
          </div>
          {job === "night_lord" ? (
            <div>
              <dt>스탯창 STR</dt>
              <dd>{integerFormat.format(result.extraStr)} STR</dd>
            </div>
          ) : null}
          <div>
            <dt>최종 공격력</dt>
            <dd>{integerFormat.format(result.totalAttack)}</dd>
          </div>
          <div>
            <dt>보공·총뎀 적용값</dt>
            <dd>{percentFormat.format(result.formulaInputs.bossAndTotalDamage)}%</dd>
          </div>
          <div>
            <dt>순수 주스탯</dt>
            <dd>{integerFormat.format(result.pureMain)}</dd>
          </div>
          <div>
            <dt>순수 부스탯</dt>
            <dd>{integerFormat.format(result.pureSub)}</dd>
          </div>
          <div>
            <dt>방어율 배율</dt>
            <dd>{decimalFormat.format(result.defenseMultiplier)}</dd>
          </div>
          <div>
            <dt>크리 배율</dt>
            <dd>{decimalFormat.format(result.criticalMultiplier)}</dd>
          </div>
        </dl>
        <p className="formula-summary">
          ({rule.mainStat} × {rule.weaponConstant} + {rule.subStat}{extraStat})
          {" "}× 공격력 ÷ 100
        </p>
      </section>

      <section className="result-issues" aria-labelledby="issues-heading">
        <h3 id="issues-heading">확인할 항목</h3>
        {result.issues.length === 0 ? (
          <p className="no-issues">문제가 없습니다.</p>
        ) : (
          <ul>
            {result.issues.map((issue, index) => {
              const severityLabel = issue.severity === "error" ? "오류" : "경고";
              const context = issueContext(issue.path, rule, input);

              return (
                <li key={`${issue.path}-${issue.code}-${index}`}>
                  <button
                    type="button"
                    className={`issue-button is-${issue.severity}`}
                    aria-label={`${severityLabel} ${context}: ${issue.message}`}
                    onClick={() => onNavigate(issue.path)}
                  >
                    <span>{severityLabel}</span>
                    <div>
                      <strong>{context}</strong>
                      <div>{issue.message}</div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </aside>
  );
}
