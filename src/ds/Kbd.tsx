import type { ReactNode } from 'react';
import './styles/spinnerkbd.css';

export interface KbdProps {
  /** Key symbol or combination (e.g. "⌘", "K", "Esc"). */
  children: ReactNode;
  className?: string;
}

/**
 * Canonical DS Kbd — keyboard shortcut badge.
 *
 * CSS classes carry all styling (tokens → styles/spinnerkbd.css). No inline
 * style for what a class can do.
 *
 * Spec: docs/components.md §15-2.
 */
export function Kbd({ children, className }: KbdProps) {
  const classes = ['ds-kbd', className ?? ''].filter(Boolean).join(' ');
  return <kbd className={classes}>{children}</kbd>;
}
