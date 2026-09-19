// Adapter: delegates to canonical DS FilterItem.
// Props mapping:
//   label: ReactNode — DS now accepts ReactNode directly; passed through as-is
//   leading: dropped (DS has no leading icon slot)
//   onClick: required in memory → optional in DS, safe to pass through
import type { ReactNode } from "react";
import { FilterItem as DsFilterItem } from "@goodsoob/ds";

type Props = {
  label: ReactNode;
  count?: number;
  leading?: ReactNode;
  active?: boolean;
  muted?: boolean;
  onClick: () => void;
  className?: string;
};

export function FilterItem({
  label,
  count,
  leading: _leading,
  active,
  muted,
  onClick,
  className,
}: Props) {
  return (
    <DsFilterItem
      label={label}
      count={count}
      active={active}
      muted={muted}
      onClick={onClick}
      className={className}
    />
  );
}
