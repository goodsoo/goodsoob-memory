import type { HTMLAttributes, ReactNode } from 'react';
import './styles/card.css';

export type CardVariant = 'default' | 'compact' | 'large';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Visual size variant. Default: 'default'. */
  variant?: CardVariant;
  /** Adds --shadow-card elevation. Combinable with any variant. */
  raised?: boolean;
  children?: ReactNode;
}

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/**
 * Canonical DS Card — thin React wrapper over `.ds-card` CSS classes.
 *
 * CSS classes carry all styling (tokens → styles/card.css). No inline
 * style for what a class can do.
 *
 * Use Card.Header / Card.Body to split the card into header + body regions.
 * Or pass children directly for a single-padding card.
 *
 * Spec: docs/components.md §5.
 */
export function Card({
  variant = 'default',
  raised = false,
  className,
  children,
  ...rest
}: CardProps) {
  const classes = [
    'ds-card',
    variant !== 'default' ? `ds-card--${variant}` : '',
    raised ? 'ds-card--raised' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

/**
 * Card.Header — header region with bottom divider.
 * Padding: --space-12 --space-16.
 */
function CardHeader({ className, children, ...rest }: CardHeaderProps) {
  const classes = ['ds-card__header', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

/**
 * Card.Body — body region.
 * Padding: --space-16.
 */
function CardBody({ className, children, ...rest }: CardBodyProps) {
  const classes = ['ds-card__body', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

Card.Header = CardHeader;
Card.Body = CardBody;
