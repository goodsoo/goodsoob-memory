import type { ChangeEventHandler } from 'react';
import './styles/radio.css';

export interface RadioProps {
  /** Controlled checked state. */
  checked: boolean;
  /** Change handler (receives the change event). */
  onChange: ChangeEventHandler<HTMLInputElement>;
  /** Label rendered to the right of the circle. */
  label?: string;
  /** Radio group name (required for browser grouping behavior). */
  name?: string;
  /** Value forwarded to the <input>. */
  value?: string;
  /** Disabled state. */
  disabled?: boolean;
  /** id forwarded to the <input> (auto-linked with <label>). */
  id?: string;
}

/**
 * Canonical DS Radio — thin React wrapper over `.ds-radio` CSS classes.
 *
 * CSS classes carry all styling (tokens → styles/radio.css). No inline
 * style for what a class can do.
 *
 * Spec: docs/components.md §10-4.
 */
export function Radio({
  checked,
  onChange,
  label,
  name,
  value,
  disabled = false,
  id,
}: RadioProps) {
  return (
    <label
      className={['ds-radio', disabled ? 'ds-radio--disabled' : ''].filter(Boolean).join(' ')}
      htmlFor={id}
    >
      <input
        type="radio"
        className="ds-radio__input"
        id={id}
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-disabled={disabled}
      />
      <span className="ds-radio__circle" aria-hidden="true" />
      {label && <span className="ds-radio__label">{label}</span>}
    </label>
  );
}
