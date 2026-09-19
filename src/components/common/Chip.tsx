// Adapter: delegates to canonical DS Chip.
// Props mapping:
//   variant "default" → "neutral"
//   variant "outline" | "accent" — same names, pass through
//   size: dropped (DS has no size prop; CSS handles sizing)
//   dot: string hex/var → rendered as a 6px colored dot node, passed as icon
//   leading: ReactNode → icon (DS icon slot)
import type { HTMLAttributes, ReactNode } from "react";
import { Chip as DsChip, type ChipVariant } from "@goodsoob/ds";

type Variant = "default" | "outline" | "accent";
type Size = "sm" | "md";

type Props = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  variant?: Variant;
  size?: Size;
  dot?: string;
  leading?: ReactNode;
  children?: ReactNode;
};

const variantMap: Record<Variant, ChipVariant> = {
  default: "neutral",
  outline: "outline",
  accent: "accent",
};

export function Chip({
  variant = "default",
  size: _size,
  dot,
  leading,
  className,
  children,
  ...rest
}: Props) {
  // Build icon: dot takes priority over leading
  let icon: ReactNode = leading;
  if (dot) {
    icon = (
      <span
        style={{
          display: "inline-block",
          width: "6px",
          height: "6px",
          borderRadius: "9999px",
          backgroundColor: dot,
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <DsChip
      variant={variantMap[variant]}
      icon={icon}
      className={className}
      {...(rest as object)}
    >
      {children}
    </DsChip>
  );
}
