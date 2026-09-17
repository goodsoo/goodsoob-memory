import './styles/tabs.css';

export interface TabItem {
  /** Unique key identifying this tab. */
  key: string;
  /** Display label. */
  label: string;
}

export interface TabsProps {
  /** Tab definitions in display order. */
  items: TabItem[];
  /** Key of the currently active tab. */
  active: string;
  /** Called with the key of the clicked tab. */
  onChange: (key: string) => void;
  className?: string;
  /** Active 탭 밑줄색 override. 없으면 CSS 기본값 var(--accent). */
  accentColor?: string;
}

/**
 * Canonical DS Tabs — page-level view switcher.
 *
 * CSS classes carry all styling (tokens → styles/tabs.css). No inline
 * style for what a class can do.
 *
 * Spec: docs/components.md §10-2.
 */
export function Tabs({ items, active, onChange, className, accentColor }: TabsProps) {
  const containerClass = ['ds-tabs', className ?? ''].filter(Boolean).join(' ');

  return (
    <div className={containerClass} role="tablist">
      {items.map((item) => {
        const isActive = item.key === active;
        const itemClass = [
          'ds-tabs__item',
          isActive ? 'ds-tabs__item--active' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            className={itemClass}
            aria-selected={isActive}
            onClick={() => onChange(item.key)}
            style={isActive && accentColor ? { borderBottomColor: accentColor } : undefined}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
