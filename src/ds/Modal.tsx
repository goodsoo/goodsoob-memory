import type { ReactNode } from 'react';
import './styles/modal.css';

export interface ModalProps {
  /** Whether the modal is visible. */
  open: boolean;
  /** Called when backdrop or Escape is pressed. */
  onClose: () => void;
  /** Modal panel content. */
  children: ReactNode;
  /** Additional class names for the panel. */
  className?: string;
}

/**
 * Canonical DS Modal — thin React wrapper over `.ds-modal` CSS classes.
 *
 * CSS classes carry all styling (tokens → styles/modal.css). No inline
 * style for what a class can do.
 *
 * Spec: docs/components.md §9-1.
 */
export function Modal({ open, onClose, children, className }: ModalProps) {
  if (!open) return null;

  const panelClasses = ['ds-modal', className ?? ''].filter(Boolean).join(' ');

  function handleBackdropMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    // Only close when clicking directly on the backdrop (not dragging from panel)
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') onClose();
  }

  return (
    <div
      className="ds-modal__backdrop"
      onMouseDown={handleBackdropMouseDown}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <div className={panelClasses}>{children}</div>
    </div>
  );
}
