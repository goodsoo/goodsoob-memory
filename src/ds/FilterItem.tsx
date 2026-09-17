import './styles/filteritem.css';

export interface FilterItemProps {
  /** Display label. */
  label: string;
  /** Optional count badge rendered on the right. */
  count?: number;
  /** Whether this item is currently selected. Default: false. */
  active?: boolean;
  /** Muted style when count is 0. Default: false. */
  muted?: boolean;
  /** Called when the row is clicked. */
  onClick?: () => void;
  className?: string;
}

/**
 * Canonical DS FilterItem — sidebar filter row with optional count badge.
 *
 * CSS classes carry all styling (tokens → styles/filteritem.css). No inline
 * style for what a class can do.
 *
 * Spec: docs/components.md §12.
 */
export function FilterItem({
  label,
  count,
  active = false,
  muted = false,
  onClick,
  className,
}: FilterItemProps) {
  const classes = [
    'ds-filteritem',
    active ? 'ds-filteritem--active' : '',
    muted ? 'ds-filteritem--muted' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="ds-filteritem__label">{label}</span>
      {count !== undefined && (
        <span className="ds-filteritem__count">{count}</span>
      )}
    </button>
  );
}
