import type { HTMLAttributes, ReactNode } from 'react';
import './styles/header.css';

export interface HeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Center title. Accepts string or any ReactNode. */
  title?: ReactNode;
  /** Right-side action cluster. Renders inside .ds-header__actions. */
  actions?: ReactNode;
  /** Frost / sticky-blur variant (--surface-frost + backdrop-blur). */
  frost?: boolean;
  /** Arbitrary content rendered inside the header (alongside title/actions). */
  children?: ReactNode;
}

/**
 * Canonical DS Header — thin React wrapper over `.ds-header` CSS classes.
 *
 * CSS classes carry all styling (tokens → styles/header.css). No inline
 * style for what a class can do.
 *
 * Renders as a <header> element. Supply `title` and/or `actions` for the
 * standard layout; use `children` for fully custom content.
 *
 * Spec: docs/components.md §6.
 */
export function Header({
  title,
  actions,
  frost = false,
  className,
  children,
  ...rest
}: HeaderProps) {
  const classes = [
    'ds-header',
    frost ? 'ds-header--frost' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <header className={classes} {...rest}>
      {title != null && (
        <div className="ds-header__title">{title}</div>
      )}
      {children}
      {actions != null && (
        <div className="ds-header__actions">{actions}</div>
      )}
    </header>
  );
}
