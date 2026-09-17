import type { ReactNode } from 'react';
import { useState, useRef } from 'react';
import './styles/tooltip.css';

export interface TooltipProps {
  /** Tooltip text or content. */
  content: ReactNode;
  /** The element that triggers the tooltip. */
  children: ReactNode;
  /** Additional class names for the tooltip panel. */
  className?: string;
}

/**
 * Canonical DS Tooltip — thin React wrapper over `.ds-tooltip` CSS classes.
 *
 * CSS classes carry all styling (tokens → styles/tooltip.css). No inline
 * style for what a class can do.
 *
 * Hover shows tooltip after 250ms delay; chain-hover is immediate.
 * Spec: docs/components.md §9-4.
 */
export function Tooltip({ content, children, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show() {
    timerRef.current = setTimeout(() => setVisible(true), 250);
  }

  function hide() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }

  const tipClasses = ['ds-tooltip', className ?? ''].filter(Boolean).join(' ');

  return (
    <span
      className="ds-tooltip__wrapper"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span className={tipClasses} role="tooltip">
          {content}
        </span>
      )}
    </span>
  );
}
