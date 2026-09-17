import type { ChangeEventHandler } from 'react';
import './styles/checkbox.css';

export interface CheckboxProps {
  /** Controlled checked state. */
  checked: boolean;
  /** Change handler (receives the new boolean). */
  onChange: ChangeEventHandler<HTMLInputElement>;
  /** Label rendered to the right of the box. */
  label?: string;
  /** Disabled state. */
  disabled?: boolean;
  /** id forwarded to the <input> (auto-linked with <label> when set). */
  id?: string;
  /** name forwarded to the <input>. */
  name?: string;
  /** value forwarded to the <input>. */
  value?: string;
}

/**
 * Canonical DS Checkbox — thin React wrapper over `.ds-checkbox` CSS classes.
 *
 * CSS classes carry all styling (tokens → styles/checkbox.css). No inline
 * style for what a class can do.
 *
 * Spec: docs/components.md §10-4.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  id,
  name,
  value,
}: CheckboxProps) {
  return (
    <label
      className={['ds-checkbox', disabled ? 'ds-checkbox--disabled' : ''].filter(Boolean).join(' ')}
      htmlFor={id}
    >
      <input
        type="checkbox"
        className="ds-checkbox__input"
        id={id}
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-disabled={disabled}
      />
      <span className="ds-checkbox__box" aria-hidden="true" />
      {label && <span className="ds-checkbox__label">{label}</span>}
    </label>
  );
}
