// Adapter: delegates to canonical DS FilterItem.
// Props mapping:
//   label: ReactNode → string (DS accepts string only; ReactNode callers pass string in practice)
//   leading: dropped (DS has no leading icon slot)
//   onClick: required in memory → optional in DS, safe to pass through
import type { ReactNode } from "react";
import { FilterItem as DsFilterItem } from "../../ds/FilterItem";

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
  // DS label is string — cast safely (callers pass string or simple ReactNode)
  const labelStr = typeof label === "string" ? label : String(label ?? "");
  return (
    <DsFilterItem
      label={labelStr}
      count={count}
      active={active}
      muted={muted}
      onClick={onClick}
      className={className}
    />
  );
}
