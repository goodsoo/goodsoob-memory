// Adapter: delegates to canonical DS Kbd.
// Memory's Props (HTMLAttributes + children) maps cleanly — style/rest are dropped
// because DS uses .ds-kbd CSS classes for all styling.
import type { HTMLAttributes, ReactNode } from "react";
import { Kbd as DsKbd } from "../../ds/Kbd";

type Props = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  children?: ReactNode;
};

export function Kbd({ children, className }: Props) {
  return <DsKbd className={className}>{children}</DsKbd>;
}
