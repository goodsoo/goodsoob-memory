import type { ReactNode } from 'react';
import { useState, useRef, useEffect } from 'react';
import './styles/dropdown.css';

export interface DropdownItem {
  /** Unique key for this item. */
  key: string;
  /** Display label. */
  label: ReactNode;
  /** Whether this item is currently selected. */
  selected?: boolean;
  /** Called when the item is clicked. */
  onSelect?: () => void;
  /** Disable this item. */
  disabled?: boolean;
}

export interface DropdownProps {
  /** Element that toggles the dropdown. */
  trigger: ReactNode;
  /** List of items. Pass either items OR children, not both. */
  items?: DropdownItem[];
  /** Free-form panel content (alternative to items). */
  children?: ReactNode;
  /** Additional class names for the panel. */
  className?: string;
}

/**
 * Canonical DS Dropdown — thin React wrapper over `.ds-dropdown` CSS classes.
 *
 * CSS classes carry all styling (tokens → styles/dropdown.css). No inline
 * style for what a class can do.
 *
 * Spec: docs/components.md §9-2.
 */
export function Dropdown({ trigger, items, children, className }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const panelClasses = ['ds-dropdown', className ?? ''].filter(Boolean).join(' ');

  return (
    <div className="ds-dropdown__wrapper" ref={wrapperRef}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && (
        <div className={panelClasses} role="menu">
          {items
            ? items.map((item) => (
                <button
                  key={item.key}
                  className={[
                    'ds-dropdown__item',
                    item.selected ? 'ds-dropdown__item--selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  role="menuitem"
                  aria-selected={item.selected}
                  disabled={item.disabled}
                  onClick={() => {
                    item.onSelect?.();
                    setOpen(false);
                  }}
                >
                  {item.label}
                </button>
              ))
            : children}
        </div>
      )}
    </div>
  );
}
