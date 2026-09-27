import { PENDANTS } from "../domain/pendants";

export function PendantSelect({ label, value, onChange, path, disabled }: {
  label: string; value?: string; onChange: (value: string) => void; path?: string; disabled?: boolean;
}) {
  return <label className="field">{label}<select aria-label={label} value={value ?? ""} data-field-path={path} disabled={disabled}
    onChange={event => onChange(event.currentTarget.value)}>
    <option value="">종류 확인 필요</option>
    {PENDANTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
  </select></label>;
}
