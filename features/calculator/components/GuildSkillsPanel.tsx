import type { CharacterInput, ValidationIssue } from "../domain/types";
import type { CharacterChangeHandler } from "./CharacterPanel";

type Props = { character: CharacterInput; issues: readonly ValidationIssue[]; onChange: CharacterChangeHandler };

export function GuildSkillsPanel({ character, issues, onChange }: Props) {
  const fields = [
    { field: "guildBossPercent", label: "길드 보스 공격력", unit: "%", max: 5, fallback: character.guildBossLevel },
    { field: "guildIgnorePercent", label: "길드 방어율 무시", unit: "%", max: 10, fallback: character.guildIgnoreLevel * 2 },
    { field: "guildAccuracyFlat", label: "길드 명중률", unit: "", max: 30, fallback: 0 },
    { field: "guildAttackFlat", label: "길드 공격력", unit: "", max: 5, fallback: character.guildAttackLevel },
  ] as const;
  return <section className="panel guild-skills-panel" aria-labelledby="guild-skills-heading">
    <div className="panel-heading"><div><h2 id="guild-skills-heading">길드 스킬</h2></div></div>
    <div className="guild-skills-fields">{fields.map(({ field, label, unit, max, fallback }) => {
      const error = issues.find(issue => issue.path === `character.${field}` && issue.severity === "error");
      return <div className="field" key={field}><label htmlFor={`guild-${field}`}>{label}{unit && ` (${unit})`}</label>
        <input id={`guild-${field}`} type="number" min={0} max={max} step={1} value={character[field] ?? String(fallback)}
          data-field-path={`character.${field}`} aria-invalid={error ? true : undefined} aria-describedby={error ? `guild-${field}-error` : undefined}
          onChange={event => onChange(field, event.currentTarget.value)} />
        <small>0~{max}{unit}</small>{error && <span className="field-error" id={`guild-${field}-error`}>{error.message}</span>}
      </div>;
    })}</div>
    <label className="check-field"><input type="checkbox" checked={character.guildActiveBoss} onChange={event => onChange("guildActiveBoss", event.currentTarget.checked)} />길드 액티브 보스 스킬 적용 (+10%)</label>
  </section>;
}
