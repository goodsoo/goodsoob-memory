import type { ChangeEventHandler } from 'react';
import './styles/toggle.css';

export type ToggleSize = 'sm' | 'md';

export interface ToggleProps {
  /** Controlled checked/on state. */
  checked: boolean;
  /** Change handler. */
  onChange: ChangeEventHandler<HTMLInputElement>;
  /** Size variant. Default: 'md'. */
  size?: ToggleSize;
  /** Disabled state. */
  disabled?: boolean;
  /** id forwarded to the <input>. */
  id?: string;
  /** aria-label for the toggle (required when there is no visible sibling label). */
  'aria-label'?: string;
  /** aria-labelledby for the toggle. */
  'aria-labelledby'?: string;
}

/**
 * Canonical DS Toggle — thin React wrapper over `.ds-toggle` CSS classes.
 *
 * CSS classes carry all styling (tokens → styles/toggle.css). No inline
 * style for what a class can do.
 *
 * Track and knob dimensions are contract-fixed raw px (no token equivalent):
 *   md: track 44×24 / knob 20  — sm: track 36×20 / knob 16.
 *
 * Spec: docs/components.md §10-3.
 */
export function Toggle({
  checked,
  onChange,
  size = 'md',
  disabled = false,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}: ToggleProps) {
  const classes = [
    'ds-toggle',
    `ds-toggle--${size}`,
    disabled ? 'ds-toggle--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes}>
      <input
        type="checkbox"
        role="switch"
        className="ds-toggle__input"
        id={id}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-disabled={disabled}
        aria-checked={checked}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
      />
      <span className="ds-toggle__track" aria-hidden="true">
        <span className="ds-toggle__knob" />
      </span>
    </span>
  );
}
