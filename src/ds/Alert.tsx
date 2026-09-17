import type { ReactNode } from 'react';
import './styles/alert.css';

export type AlertVariant = 'info' | 'ok' | 'warn' | 'down';

export interface AlertProps {
  /** Semantic variant — controls color scheme. */
  variant: AlertVariant;
  /** Optional leading icon (e.g. lucide <Info size={16} />). */
  icon?: ReactNode;
  /** Optional bold title line. */
  title?: ReactNode;
  /** Body / description content. */
  children: ReactNode;
  /** Additional class names. */
  className?: string;
}

/**
 * Canonical DS Alert — thin React wrapper over `.ds-alert` CSS classes.
 *
 * CSS classes carry all styling (tokens → styles/alert.css). No inline
 * style for what a class can do.
 *
 * Spec: docs/components.md §10-1.
 */
export function Alert({ variant, icon, title, children, className }: AlertProps) {
  const classes = ['ds-alert', `ds-alert--${variant}`, className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} role="alert">
      {icon && <span className="ds-alert__icon">{icon}</span>}
      <div className="ds-alert__content">
        {title && <div className="ds-alert__title">{title}</div>}
        <div className="ds-alert__body">{children}</div>
      </div>
    </div>
  );
}
