// Adapter: delegates to canonical DS Spinner.
// Memory's SVGElement ...rest attrs are dropped (DS wraps in <span>).
// size mapping is identical: xs/sm/md.
import type { HTMLAttributes } from "react";
import { Spinner as DsSpinner, type SpinnerSize } from "../../ds/Spinner";

type Size = "xs" | "sm" | "md";

type Props = HTMLAttributes<SVGSVGElement> & {
  size?: Size;
};

export function Spinner({ size = "md", className }: Props) {
  return <DsSpinner size={size as SpinnerSize} className={className} />;
}
