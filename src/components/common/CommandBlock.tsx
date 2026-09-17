// Adapter: delegates to canonical DS CommandBlock.
// Props mapping:
//   caption → label (DS uses "label" for the caption above the block)
//   size    → className (ds-commandblock--sm modifier if needed; DS has no size prop)
import { CommandBlock as DsCommandBlock } from "../../ds/CommandBlock";

type Props = {
  command: string;
  caption?: string;
  size?: "md" | "sm";
  className?: string;
};

export function CommandBlock({ command, caption, size, className = "" }: Props) {
  const sizeClass = size === "sm" ? "ds-commandblock--sm" : "";
  const combined = [sizeClass, className].filter(Boolean).join(" ");
  return (
    <DsCommandBlock
      command={command}
      label={caption}
      className={combined || undefined}
    />
  );
}
