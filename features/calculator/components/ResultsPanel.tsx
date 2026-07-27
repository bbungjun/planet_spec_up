import { JOB_RULES, type JobRule } from "../domain/job-rules";
import type {
  CalculationResult,
  CharacterInput,
  EquipmentInput,
  EquipmentSlot,
  JobId,
} from "../domain/types";
import { EQUIPMENT_SLOT_LABELS } from "../labels";
import { EQUIPMENT_FIELD_DEFINITIONS } from "./EquipmentEditor";

type ResultsPanelProps = {
  job: JobId;
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
  ignoreDefense: "방어율 무시",
  criticalRate: "추가 크리티컬 확률",
  manualPureSub: "순수 부스탯 수동값",
  nightLordStrStat: "나이트로드 스탯창 STR",
};

function issueContext(path: string, rule: JobRule): string {
  const [group, candidate, fieldCandidate] = path.split(".");

  if (group === "equipment") {
    const slot = candidate as EquipmentSlot;
    const field = fieldCandidate as keyof EquipmentInput;
    const fieldDefinition = EQUIPMENT_FIELD_DEFINITIONS.find(
      (definition) => definition.field === field,
    );
    const slotLabel = EQUIPMENT_SLOT_LABELS[slot];
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
  result,
  onNavigate,
}: ResultsPanelProps) {
  const rule = JOB_RULES[job];
  const extraStat = job === "night_lord" ? " + STR" : "";

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
          <span>환산 공격력</span>
          <output aria-label="환산 공격력 결과">
            {integerFormat.format(result.convertedAttack)}
          </output>
        </div>
        <div className="result-card">
          <span>스탯 공격력</span>
          <output aria-label="스탯 공격력 결과">
            {integerFormat.format(result.statAttack)}
          </output>
        </div>
      </div>

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
              const context = issueContext(issue.path, rule);

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
