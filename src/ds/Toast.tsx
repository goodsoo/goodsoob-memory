import type { ReactNode } from 'react';
import './styles/toast.css';

export type ToastVariant = 'default' | 'info' | 'ok' | 'warn' | 'down';

export interface ToastProps {
  /** Message content. */
  message: ReactNode;
  /** Visual variant. Default: 'default'. */
  variant?: ToastVariant;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Additional class names. */
  className?: string;
}

/**
 * Canonical DS Toast — thin React wrapper over `.ds-toast` CSS classes.
 *
 * CSS classes carry all styling (tokens → styles/toast.css). No inline
 * style for what a class can do.
 *
 * Typically rendered inside a ToastRegion at a fixed screen position.
 * Spec: docs/components.md §9-3.
 */
export function Toast({ message, variant = 'default', icon, className }: ToastProps) {
  const classes = [
    'ds-toast',
    variant !== 'default' ? `ds-toast--${variant}` : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} role="status" aria-live="polite">
      {icon}
      <span>{message}</span>
    </div>
  );
}

export interface ToastRegionProps {
  children: ReactNode;
}

/**
 * Fixed-position host for Toast instances (bottom-right by default).
 * Wrap your toast stack in this at the app root.
 */
export function ToastRegion({ children }: ToastRegionProps) {
  return <div className="ds-toast-region">{children}</div>;
}
