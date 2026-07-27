import { JOB_RULES } from "../domain/job-rules";
import type {
  CalculationResult,
  JobId,
} from "../domain/types";

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
            {result.issues.map((issue, index) => (
              <li key={`${issue.path}-${issue.code}-${index}`}>
                <button
                  type="button"
                  className={`issue-button is-${issue.severity}`}
                  onClick={() => onNavigate(issue.path)}
                >
                  <span>{issue.severity === "error" ? "오류" : "경고"}</span>
                  {issue.message}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
