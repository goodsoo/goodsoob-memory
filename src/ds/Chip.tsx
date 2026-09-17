import type { ReactNode } from 'react';
import './styles/chip.css';

export type ChipVariant = 'neutral' | 'outline' | 'accent' | 'ok' | 'warn' | 'down';

export interface ChipProps {
  /** Visual variant. Default: 'neutral'. */
  variant?: ChipVariant;
  /** Icon rendered before the label (--icon-12). */
  icon?: ReactNode;
  /** Called when the remove (✕) button is clicked. Renders the button when provided. */
  onRemove?: () => void;
  /** aria-label for the remove button. Defaults to "제거". */
  removeLabel?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * Canonical DS Chip — pill label for categories, meta, filters.
 *
 * CSS classes carry all styling (tokens → styles/chip.css). No inline
 * style for what a class can do.
 *
 * Spec: docs/components.md §8.
 */
export function Chip({
  variant = 'neutral',
  icon,
  onRemove,
  removeLabel = '제거',
  className,
  children,
}: ChipProps) {
  const classes = [
    'ds-chip',
    `ds-chip--${variant}`,
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes}>
      {icon && <span className="ds-chip__icon" aria-hidden="true">{icon}</span>}
      {children}
      {onRemove && (
        <button
          type="button"
          className="ds-chip__remove"
          onClick={onRemove}
          aria-label={removeLabel}
        >
          ✕
        </button>
      )}
    </span>
  );
}
