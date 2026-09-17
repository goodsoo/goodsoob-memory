import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import './styles/select.css';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Structured options — alternative to passing <option> children directly. */
  options?: SelectOption[];
  /** Error state — border-color switches to --down. */
  error?: boolean;
}

/**
 * Canonical DS Select — thin React wrapper over `.ds-select` CSS classes.
 *
 * CSS classes carry all styling (tokens → styles/select.css). No inline
 * style for what a class can do.
 *
 * Spec: docs/components.md §7.
 */
export function Select({
  options,
  error = false,
  className,
  disabled,
  children,
  ...rest
}: SelectProps) {
  const classes = [
    'ds-select',
    error ? 'ds-select--error' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className="ds-select-wrap">
      <select
        className={classes}
        disabled={disabled}
        aria-disabled={disabled}
        aria-invalid={error || undefined}
        {...rest}
      >
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          : children}
      </select>
      <ChevronDown className="ds-select-chevron" aria-hidden="true" />
    </span>
  );
}
