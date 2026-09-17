import type { HTMLAttributes, ReactNode } from 'react';
import './styles/nav-item.css';

export interface NavItemProps extends HTMLAttributes<HTMLElement> {
  /** Icon rendered in the leading slot (--icon-16). */
  icon?: ReactNode;
  /** Marks the item as the current active route. */
  active?: boolean;
  children: ReactNode;
  /** Renders as <a> when provided; otherwise <button>. */
  href?: string;
}

/**
 * Canonical DS NavItem — thin React wrapper. Spec: docs/components.md §17.
 */
export function NavItem({
  icon,
  active = false,
  children,
  href,
  className,
  ...rest
}: NavItemProps) {
  const classes = [
    'ds-nav-item',
    active ? 'ds-nav-item--active' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      {icon && (
        <span className="ds-nav-item__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </>
  );

  if (href) {
    return (
      <a
        {...rest}
        href={href}
        className={classes}
        aria-current={active ? 'page' : undefined}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      {...rest}
      className={classes}
      aria-current={active ? 'page' : undefined}
    >
      {content}
    </button>
  );
}
