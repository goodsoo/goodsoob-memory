// Adapter: delegates to canonical DS Toggle.
// Key difference:
//   memory:  onChange(next: boolean)        — value-based callback
//   DS:      onChange: ChangeEventHandler   — event-based callback
// → wrap: convert memory's boolean callback to ChangeEvent handler.
// ariaLabel → aria-label, title is dropped (DS has no title prop).
import { Toggle as DsToggle, type ToggleSize } from "@goodsoob/ds";

type Size = "sm" | "md";

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  size?: Size;
  ariaLabel?: string;
  title?: string;
  className?: string;
  id?: string;
};

export function Toggle({
  checked,
  onChange,
  disabled = false,
  size = "md",
  ariaLabel,
  id,
}: Props) {
  return (
    <DsToggle
      checked={checked}
      onChange={(e) => onChange(e.currentTarget.checked)}
      size={size as ToggleSize}
      disabled={disabled}
      id={id}
      aria-label={ariaLabel}
    />
  );
}
