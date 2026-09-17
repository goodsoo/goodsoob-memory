import type { HTMLAttributes, ReactNode } from 'react';
import './styles/empty-state.css';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /**
   * Optional decorative icon. Standard size = --icon-24 (24px).
   * For large decorative icons (40px) pass a pre-sized element.
   * Rendered with color --faint via .ds-empty__icon.
   */
  icon?: ReactNode;
  /** Heading (h3 variant). Required — describes the empty situation. */
  title: ReactNode;
  /** Body text (--sub). Guides the user toward next action. */
  description?: ReactNode;
  /** CTA slot. Render a <Button> here (primary sm or md per spec). */
  action?: ReactNode;
  children?: ReactNode;
}

/**
 * Canonical DS EmptyState — thin React wrapper over `.ds-empty` CSS classes.
 *
 * CSS classes carry all styling (tokens → styles/empty-state.css). No inline
 * style for what a class can do.
 *
 * Voice / tone (§10-5):
 *   title      = situation diagnosis  "메모가 없습니다"
 *   description = next-step guidance  "첫 메모를 만들어 기록을 시작하세요"
 *   action     = imperative verb CTA  <Button>새 메모</Button>
 *
 * Spec: docs/components.md §10-5.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  children,
  ...rest
}: EmptyStateProps) {
  const classes = ['ds-empty', className ?? ''].filter(Boolean).join(' ');

  return (
    <div className={classes} {...rest}>
      {icon != null && (
        <span className="ds-empty__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <h3 className="ds-empty__title">{title}</h3>
      {description != null && (
        <p className="ds-empty__description">{description}</p>
      )}
      {action != null && (
        <div className="ds-empty__action">{action}</div>
      )}
      {children}
    </div>
  );
}
