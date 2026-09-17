// Adapter: delegates to canonical DS EmptyState.
// Props mapping:
//   title: optional in memory → required in DS; default to "" when absent
//   className: memory had a long default class string — DS handles layout via .ds-empty
//              caller-provided className still forwarded
import type { ReactNode } from "react";
import { EmptyState as DsEmptyState } from "../../ds/EmptyState";

type Props = {
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  icon,
  title = "",
  description,
  action,
  className,
}: Props) {
  return (
    <DsEmptyState
      icon={icon}
      title={title}
      description={description}
      action={action}
      className={className}
    />
  );
}
