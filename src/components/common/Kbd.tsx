import type { HTMLAttributes, ReactNode } from "react";

type Props = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  children?: ReactNode;
};

// 키보드 단축키 표시. PortfolioGuideModal / EmptyBodyCTA / ShortcutsSection 일관 styling.
// inline + font-mono + bg-surface-hover + border + small padding.
export function Kbd({ children, className = "", style, ...rest }: Props) {
  return (
    <kbd
      className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded px-1 py-px font-mono text-[11px] font-medium leading-none ${className}`}
      style={{
        backgroundColor: "var(--surface-2)",
        color: "var(--ink)",
        border: "1px solid var(--line)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </kbd>
  );
}
