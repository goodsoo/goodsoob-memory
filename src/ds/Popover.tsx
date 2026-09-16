import type { ReactNode } from 'react';
import { useState, useRef, useEffect } from 'react';
import './styles/popover.css';

export interface PopoverProps {
  /** Element that toggles the popover. */
  trigger: ReactNode;
  /** Popover panel content. */
  content: ReactNode;
  /** Additional class names for the panel. */
  className?: string;
}

/**
 * Canonical DS Popover — thin React wrapper over `.ds-popover` CSS classes.
 *
 * CSS classes carry all styling (tokens → styles/popover.css). No inline
 * style for what a class can do.
 *
 * Spec: docs/components.md §9-5.
 */
export function Popover({ trigger, content, className }: PopoverProps) {
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

  const panelClasses = ['ds-popover', className ?? ''].filter(Boolean).join(' ');

  return (
    <div className="ds-popover__wrapper" ref={wrapperRef}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && <div className={panelClasses}>{content}</div>}
    </div>
  );
}
