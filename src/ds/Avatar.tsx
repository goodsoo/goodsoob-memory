import './styles/avatar.css';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  /** Image URL. Renders <img> when provided; falls back to initials otherwise. */
  src?: string;
  /** alt text for the image (pass empty string for decorative). */
  alt?: string;
  /** Initials shown when no src. Typically 1–2 chars. */
  initials?: string;
  /** Size variant. Default: 'md' (32px). */
  size?: AvatarSize;
  className?: string;
}

/**
 * Canonical DS Avatar — thin React wrapper. Spec: docs/components.md §16.
 */
export function Avatar({
  src,
  alt = '',
  initials,
  size = 'md',
  className,
}: AvatarProps) {
  const classes = [
    'ds-avatar',
    `ds-avatar--${size}`,
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes}>
      {src ? (
        <img className="ds-avatar__img" src={src} alt={alt} />
      ) : (
        <span className="ds-avatar__initials" aria-hidden={!initials}>
          {initials ?? ''}
        </span>
      )}
    </span>
  );
}
