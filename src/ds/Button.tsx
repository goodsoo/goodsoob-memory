import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant. Default: 'secondary'. */
  variant?: ButtonVariant;
  /** Size. Default: 'md'. */
  size?: ButtonSize;
  /** Icon rendered before the label text. Triggers icon-left padding adjustment. */
  leftIcon?: ReactNode;
  /** Icon rendered after the label text. Triggers icon-right padding adjustment. */
  rightIcon?: ReactNode;
  /** Render as a square icon-only button (no label). */
  iconOnly?: boolean;
  children?: ReactNode;
}

/**
 * Canonical DS Button — thin React wrapper over `.ds-btn` CSS classes.
 *
 * CSS classes carry all styling (tokens → ds-components.css). No inline
 * style for what a class can do.
 *
 * Spec: docs/components.md §4.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  leftIcon,
  rightIcon,
  iconOnly = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'ds-btn',
    `ds-btn--${variant}`,
    iconOnly ? 'ds-btn--icon' : `ds-btn--${size}`,
    !iconOnly && leftIcon  ? `ds-btn--icon-left`  : '',
    !iconOnly && rightIcon ? `ds-btn--icon-right` : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      aria-disabled={disabled}
      {...rest}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  );
}
