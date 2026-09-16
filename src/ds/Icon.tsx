import type { LucideIcon } from 'lucide-react';
import './styles/icon.css';

export type IconSize = 12 | 14 | 16 | 20 | 24;

export interface IconProps {
  /** Lucide icon component to render. */
  icon: LucideIcon;
  /**
   * Icon size in px, mapping to --icon-* tokens.
   * Also determines stroke-width tier (D14):
   *   12 | 14 → strokeWidth 2.0 (small, dense contexts)
   *   16 | 20 | 24 → strokeWidth 2.4 (default)
   * Default: 16.
   */
  size?: IconSize;
  className?: string;
  /** Accessible label. Omit for decorative icons (aria-hidden will be set). */
  label?: string;
}

/** Stroke-width tier map per D14. */
const strokeWidthMap: Record<IconSize, number> = {
  12: 2.0,
  14: 2.0,
  16: 2.4,
  20: 2.4,
  24: 2.4,
};

/**
 * Canonical DS Icon — lucide icon wrapper enforcing tiered stroke-width (D14)
 * and --icon-* size tokens.
 *
 * CSS classes carry layout (styles/icon.css). Size and strokeWidth are set
 * via props (lucide renders inline SVG — no class equivalent).
 *
 * Spec: docs/components.md §11.
 */
export function Icon({ icon: LucideComponent, size = 16, label, className }: IconProps) {
  const classes = ['ds-icon', className ?? ''].filter(Boolean).join(' ');

  return (
    <span
      className={classes}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      <LucideComponent
        size={size}
        strokeWidth={strokeWidthMap[size]}
      />
    </span>
  );
}
