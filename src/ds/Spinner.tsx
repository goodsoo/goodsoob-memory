import { Loader2 } from 'lucide-react';
import './styles/spinnerkbd.css';

export type SpinnerSize = 'xs' | 'sm' | 'md';

export interface SpinnerProps {
  /** Size variant mapping to --icon-12/14/16. Default: 'md'. */
  size?: SpinnerSize;
  className?: string;
}

const sizeMap: Record<SpinnerSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
};

/**
 * Canonical DS Spinner — Loader2 rotating 0.8s infinite.
 *
 * CSS classes carry all styling (tokens → styles/spinnerkbd.css). No inline
 * style for what a class can do.
 *
 * Spec: docs/components.md §15-1.
 */
export function Spinner({ size = 'md', className }: SpinnerProps) {
  const classes = [
    'ds-spinner',
    `ds-spinner--${size}`,
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} role="status" aria-label="로딩 중">
      <Loader2 size={sizeMap[size]} strokeWidth={size === 'md' ? 2.4 : 2.0} />
    </span>
  );
}
