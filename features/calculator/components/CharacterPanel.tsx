import { JOB_RULES } from "../domain/job-rules";
import type {
  CharacterInput,
  GuildSkillLevel,
  JobId,
  MapleWarrior,
  SharpEyes,
  ValidationIssue,
} from "../domain/types";
import { WEAPON_LABELS } from "../labels";

export type CharacterChangeHandler = <Field extends keyof CharacterInput>(
  field: Field,
  value: CharacterInput[Field],
) => void;

type CharacterPanelProps = {
  character: CharacterInput;
  issues: readonly ValidationIssue[];
  onChange: CharacterChangeHandler;
  onJobChange: (job: JobId) => void;
};

type NumericFieldProps = {
  label: string;
  path: string;
  value: string;
  min: number;
  max: number;
  step?: number | "any";
  issues: readonly ValidationIssue[];
  onChange: (value: string) => void;
};

function errorFor(
  issues: readonly ValidationIssue[],
  path: string,
): ValidationIssue | undefined {
  return issues.find((issue) => issue.path === path && issue.severity === "error");
}

function pureStatPool(rawLevel: string): number {
  const level = Number(rawLevel);
  if (!Number.isInteger(level) || level < 1 || level > 200) return 0;
  return level * 5 + (level >= 120 ? 22 : level >= 70 ? 17 : 12);
}

function NumericField({
  label,
  path,
  value,
  min,
  max,
  step = "any",
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
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        data-field-path={path}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {error === undefined ? null : (
        <span id={errorId} className="field-error">
          <span className="field-error-icon" aria-hidden="true">!</span>
          <span>{error.message}</span>
        </span>
      )}
    </div>
  );
}

const GUILD_LEVELS = [0, 1, 2, 3, 4, 5] as const;

export function CharacterPanel({
  character,
  issues,
  onChange,
  onJobChange,
}: CharacterPanelProps) {
  const rule = JOB_RULES[character.job];

  return (
    <section className="panel character-panel" aria-labelledby="character-heading">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">캐릭터</p>
          <h2 id="character-heading">캐릭터 설정</h2>
        </div>
        <span className="job-chip">{rule.groupLabel}</span>
      </div>

      <div className="field-grid">
        <div className="field">
          <label htmlFor="character-job">직업</label>
          <select
            id="character-job"
            value={character.job}
            onChange={(event) => onJobChange(event.currentTarget.value as JobId)}
          >
            <option value="marksman">신궁</option>
            <option value="corsair">캡틴</option>
            <option value="night_lord">나이트로드</option>
          </select>
        </div>

        <NumericField
          label="레벨"
          path="character.level"
          value={character.level}
          min={1}
          max={200}
          step={1}
          issues={issues}
          onChange={(value) => onChange("level", value)}
        />

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
        <summary>상세 전투·길드 설정</summary>
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
          <NumericField
            label="순수 부스탯 수동값"
            path="character.manualPureSub"
            value={character.manualPureSub}
            min={0}
            max={pureStatPool(character.level)}
            step={1}
            issues={issues}
            onChange={(value) => onChange("manualPureSub", value)}
          />
          {character.job === "night_lord" ? (
            <NumericField
              label="나이트로드 스탯창 STR"
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

      <p className="panel-description">기타 데미지·방무에는 장비 옵션과 길드 스킬을 제외한 값만 입력하세요. 장비·길드 값은 별도 합산됩니다.</p>

      <fieldset className="settings-group">
        <legend>길드 스킬</legend>
        <div className="field-grid">
          {([
            ["guildBossLevel", "길드 보스 데미지 스킬 레벨"],
            ["guildIgnoreLevel", "길드 방어율 무시 스킬 레벨"],
          ] as const).map(([field, label]) => (
            <div className="field" key={field}>
              <label htmlFor={`character-${field}`}>{label}</label>
              <select
                id={`character-${field}`}
                value={character[field]}
                onChange={(event) => onChange(
                  field,
                  Number(event.currentTarget.value) as GuildSkillLevel,
                )}
              >
                {GUILD_LEVELS.map((level) => (
                  <option value={level} key={level}>{level}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <label className="check-field" htmlFor="character-guild-active-boss">
          <input
            id="character-guild-active-boss"
            type="checkbox"
            checked={character.guildActiveBoss}
            onChange={(event) => onChange("guildActiveBoss", event.currentTarget.checked)}
          />
          길드 액티브 보스 스킬 적용
        </label>
      </fieldset>
      </details>
    </section>
  );
}
