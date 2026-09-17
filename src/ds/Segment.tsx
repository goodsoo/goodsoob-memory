import type { ReactNode } from 'react';
import './styles/segment.css';

export type SegmentActiveStyle = 'primary' | 'accent';

export interface SegmentOption {
  /** Unique value for this segment. */
  value: string;
  /** Display label or icon node. */
  label: ReactNode;
  /** aria-label for accessibility (required when label is an icon). */
  ariaLabel?: string;
}

export interface SegmentProps {
  /** Segment options to render. */
  options: SegmentOption[];
  /** Currently selected value. */
  value: string;
  /** Called with the value of the clicked segment. */
  onChange: (value: string) => void;
  /** Style of the active segment. Default: 'primary'. */
  activeStyle?: SegmentActiveStyle;
  /** aria-label for the group. */
  groupLabel?: string;
  className?: string;
}

/**
 * Canonical DS Segment — housed segmented toggle for local view switching.
 *
 * CSS classes carry all styling (tokens → styles/segment.css). No inline
 * style for what a class can do.
 *
 * Spec: docs/components.md §13.
 */
export function Segment({
  options,
  value,
  onChange,
  activeStyle = 'primary',
  groupLabel,
  className,
}: SegmentProps) {
  const trackClass = ['ds-segment', className ?? ''].filter(Boolean).join(' ');

  return (
    <div className={trackClass} role="group" aria-label={groupLabel}>
      {options.map((opt) => {
        const isActive = opt.value === value;
        const itemClass = [
          'ds-segment__item',
          isActive
            ? activeStyle === 'accent'
              ? 'ds-segment__item--active-accent'
              : 'ds-segment__item--active'
            : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={opt.value}
            type="button"
            className={itemClass}
            aria-pressed={isActive}
            aria-label={opt.ariaLabel}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
