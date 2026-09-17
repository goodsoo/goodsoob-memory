// Adapter: delegates to canonical DS Button.
// Variant mapping:
//   "info"  → "accent"   (DS has no "info"; accent is closest blue)
//   "icon"  → iconOnly=true + variant="ghost"  (DS handles icon-only via iconOnly flag)
// All other variants ("primary", "secondary", "danger", "ghost") pass through unchanged.
// ref forwarding: DS ButtonProps extends ButtonHTMLAttributes, ref works natively.
import type { ComponentPropsWithRef, ReactNode } from "react";
import { Button as DsButton, type ButtonVariant } from "../../ds/Button";

type MemoryVariant = "primary" | "secondary" | "danger" | "info" | "ghost" | "icon";
type Size = "sm" | "md";

type Props = Omit<ComponentPropsWithRef<"button">, "children"> & {
  variant?: MemoryVariant;
  size?: Size;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  children?: ReactNode;
};

export function Button({
  variant = "secondary",
  size = "md",
  leftIcon,
  rightIcon,
  children,
  ...rest
}: Props) {
  const isIconOnly = variant === "icon";
  const dsVariant: ButtonVariant = isIconOnly
    ? "ghost"
    : variant === "info"
      ? "accent"
      : (variant as ButtonVariant);

  return (
    <DsButton
      variant={dsVariant}
      size={size}
      iconOnly={isIconOnly}
      leftIcon={leftIcon}
      rightIcon={rightIcon}
      {...rest}
    >
      {children}
    </DsButton>
  );
}
