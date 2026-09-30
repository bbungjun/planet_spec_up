import { JOB_RULES } from "../domain/job-rules";
import type {
  CharacterInput,
  JobId,
  MapleWarrior,
  SharpEyes,
  ValidationIssue,
} from "../domain/types";
import { WEAPON_LABELS } from "../labels";
import { levelAchievementBonus, MAX_CHARACTER_LEVEL, pureStatPool } from "../domain/level";

export type CharacterChangeHandler = <Field extends keyof CharacterInput>(
  field: Field,
  value: CharacterInput[Field],
) => void;

type CharacterPanelProps = {
  character: CharacterInput;
  issues: readonly ValidationIssue[];
  onChange: CharacterChangeHandler;
  onJobChange: (job: JobId) => void;
  showIdentity?: boolean;
  captainBeta?: boolean;
};

type NumericFieldProps = {
  label: string;
  path: string;
  value: string;
  min: number;
  max: number;
  step?: number | "any";
  hint?: string;
  issues: readonly ValidationIssue[];
  onChange: (value: string) => void;
};

function errorFor(
  issues: readonly ValidationIssue[],
  path: string,
): ValidationIssue | undefined {
  return issues.find((issue) => issue.path === path && issue.severity === "error");
}

function NumericField({
  label,
  path,
  value,
  min,
  max,
  step = "any",
  hint,
  issues,
  onChange,
}: NumericFieldProps) {
  const error = errorFor(issues, path);
  const id = path.replaceAll(".", "-");
  const errorId = `${id}-error`;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={path}
        autoComplete="off"
        inputMode={step === 1 ? "numeric" : "decimal"}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        data-field-path={path}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={[error ? errorId : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error === undefined ? null : (
        <span id={errorId} className="field-error">
          <span className="field-error-icon" aria-hidden="true">!</span>
          <span>{error.message}</span>
        </span>
      )}
    </div>
  );
}

export function CharacterIdentityFields({ character, issues, onChange, onJobChange, captainBeta = false }: CharacterPanelProps) {
  const bonus = levelAchievementBonus(Number(character.level));
  return <>
    <div className="field">
      <label htmlFor="character-job">직업</label>
      <select id="character-job" value={character.job} disabled={captainBeta} onChange={event => onJobChange(event.currentTarget.value as JobId)}>
        {!captainBeta && <option value="marksman">신궁</option>}
        <option value="corsair">캡틴</option>
        {!captainBeta && <option value="night_lord">나이트로드</option>}
      </select>
    </div>
    <NumericField label="레벨" path="character.level" value={character.level} min={1} max={MAX_CHARACTER_LEVEL} step={1}
      issues={issues} onChange={value => onChange("level", value)} />
    <p className="level-achievement" role="status" aria-label="레벨 달성 버프">{bonus.attack > 0
      ? `레벨 달성 버프 자동 적용 · 공격력 +${bonus.attack} · 올스탯 +${bonus.allStat}`
      : "레벨 달성 버프 · 200레벨부터 자동 적용"}</p>
  </>;
}

export function CharacterPanel({
  character,
  issues,
  onChange,
  onJobChange,
  showIdentity = true,
}: CharacterPanelProps) {
  const rule = JOB_RULES[character.job];

  return (
    <section className="panel character-panel" aria-labelledby="character-heading">
      <div className="panel-heading">
        <div>

          <h2 id="character-heading">캐릭터 설정</h2>
        </div>
        <span className="job-chip">{rule.groupLabel}</span>
      </div>

      <div className="field-grid">
        {showIdentity && <CharacterIdentityFields character={character} issues={issues} onChange={onChange} onJobChange={onJobChange} />}

        <div className="field">
          <label htmlFor="character-maple-warrior">메이플 용사</label>
          <select
            id="character-maple-warrior"
            value={character.mapleWarrior}
            onChange={(event) => onChange(
              "mapleWarrior",
              Number(event.currentTarget.value) as MapleWarrior,
            )}
          >
            <option value={0}>없음</option>
            <option value={20}>20</option>
            <option value={30}>30</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="character-sharp-eyes">샤프 아이즈</label>
          <select
            id="character-sharp-eyes"
            value={character.sharpEyes}
            onChange={(event) => onChange(
              "sharpEyes",
              event.currentTarget.value as SharpEyes,
            )}
          >
            <option value="none">없음</option>
            <option value="usable">쓸만한 샤프 아이즈</option>
            <option value="sharp_30">샤프 아이즈 30</option>
          </select>
        </div>
      </div>

      <fieldset className="settings-group">
        <legend>순수 스탯 <small>장비·버프 제외</small></legend>
        <div className="field-grid">
          <NumericField label={`순수 ${rule.mainStat}`} path="character.pureMain" value={character.pureMain ?? ""}
            min={0} max={pureStatPool(Number(character.level))} step={1} issues={issues} onChange={value => onChange("pureMain", value)} />
          <NumericField label={`순수 ${rule.subStat}`} path="character.pureSub" value={character.pureSub ?? ""}
            min={0} max={pureStatPool(Number(character.level))} step={1} issues={issues} onChange={value => onChange("pureSub", value)} />
        </div>
      </fieldset>

      <dl className="job-summary" aria-label="현재 직업 규칙">
        <div>
          <dt>무기</dt>
          <dd>{WEAPON_LABELS[rule.weapon]}</dd>
        </div>
        <div>
          <dt>주스탯</dt>
          <dd>{rule.mainStat}</dd>
        </div>
        <div>
          <dt>부스탯</dt>
          <dd>{rule.subStat}</dd>
        </div>
      </dl>

      <details className="character-advanced">
        <summary>상세 전투 설정</summary>
      <fieldset className="settings-group">
        <legend>전투 설정</legend>
        <div className="field-grid">
          <NumericField
            label="타격당 평균 데미지 비율"
            path="character.skillPercent"
            value={character.skillPercent}
            min={0}
            max={10000}
            issues={issues}
            onChange={(value) => onChange("skillPercent", value)}
          />
          <NumericField
            label="몬스터 방어율"
            path="character.monsterDefense"
            value={character.monsterDefense}
            min={0}
            max={100}
            issues={issues}
            onChange={(value) => onChange("monsterDefense", value)}
          />
          {([ ["totalDamagePercent", "기타 총데미지%"], ["bossDamagePercent", "기타 보스공격력%"] ] as const).map(([field, label]) => (
            <NumericField key={field} label={label} path={`character.${field}`} value={character[field] ?? ""}
              min={0} max={999} issues={issues} onChange={value => onChange(field, value)} />
          ))}
          {character.bossAndTotalDamage.trim() !== "" && <NumericField
            label="기존 보공·총데미지 합산값 (분리 후 비우기)"
            path="character.bossAndTotalDamage"
            value={character.bossAndTotalDamage}
            min={0}
            max={999}
            issues={issues}
            onChange={(value) => onChange("bossAndTotalDamage", value)}
          />}
          <NumericField
            label="방어율 무시"
            path="character.ignoreDefense"
            value={character.ignoreDefense}
            min={0}
            max={100}
            issues={issues}
            onChange={(value) => onChange("ignoreDefense", value)}
          />
          <NumericField
            label="추가 크리티컬 확률"
            path="character.criticalRate"
            value={character.criticalRate}
            min={0}
            max={100}
            issues={issues}
            onChange={(value) => onChange("criticalRate", value)}
          />
          {character.manualPureSub.trim() && !(character.pureMain?.trim() && character.pureSub?.trim()) && <NumericField
            label="순수 부스탯 수동값"
            path="character.manualPureSub"
            value={character.manualPureSub}
            min={0}
            max={pureStatPool(Number(character.level))}
            step={1}
            issues={issues}
            onChange={(value) => onChange("manualPureSub", value)}
          />}
          {character.job === "night_lord" ? (
            <NumericField
              label="나이트로드 스탯창 STR"
              hint="캐시 장비를 제외한 STR"
              path="character.nightLordStrStat"
              value={character.nightLordStrStat}
              min={0}
              max={9999}
              step={1}
              issues={issues}
              onChange={(value) => onChange("nightLordStrStat", value)}
            />
          ) : null}
        </div>
      </fieldset>

      <p className="panel-description">기타 수치에는 장비·길드 효과를 제외하세요.</p>

      </details>
    </section>
  );
}
