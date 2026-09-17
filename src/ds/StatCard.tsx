import type { ReactNode } from 'react';
import './styles/stat-card.css';

export interface StatCardProps {
  /** Short label above the value (e.g. "총 회원수"). */
  label: string;
  /** Primary KPI value. Can be a string, number, or ReactNode. */
  value: ReactNode;
  /** Optional delta text (e.g. "+12%", "↑ 3"). */
  delta?: string;
  /** Direction of the delta — controls colour. 'up' = ok green, 'down' = red. */
  deltaDir?: 'up' | 'down';
  className?: string;
}

/**
 * Canonical DS StatCard — thin React wrapper. Spec: docs/components.md §18.
 */
export function StatCard({
  label,
  value,
  delta,
  deltaDir,
  className,
}: StatCardProps) {
  const classes = [
    'ds-stat-card',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const deltaClasses = [
    'ds-stat-card__delta',
    deltaDir ? `ds-stat-card__delta--${deltaDir}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <span className="ds-stat-card__label">{label}</span>
      <span className="ds-stat-card__value">{value}</span>
      {delta && <span className={deltaClasses}>{delta}</span>}
    </div>
  );
}
