import type { InputHTMLAttributes } from 'react';
import './styles/input.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Error state — border-color switches to --down. */
  error?: boolean;
}

/**
 * Canonical DS Input — thin React wrapper over `.ds-input` CSS classes.
 *
 * CSS classes carry all styling (tokens → styles/input.css). No inline
 * style for what a class can do.
 *
 * Spec: docs/components.md §7.
 */
export function Input({
  error = false,
  className,
  disabled,
  ...rest
}: InputProps) {
  const classes = [
    'ds-input',
    error ? 'ds-input--error' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <input
      className={classes}
      disabled={disabled}
      aria-disabled={disabled}
      aria-invalid={error || undefined}
      {...rest}
    />
  );
}
