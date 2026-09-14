import type { HTMLAttributes, ReactNode } from "react";

type Variant = "default" | "outline" | "accent";
type Size = "sm" | "md";

type Props = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  variant?: Variant;
  size?: Size;
  // 좌측 color dot — 카테고리 / 상태 시그널.
  dot?: string;
  // 좌측 ReactNode (아이콘 등). dot 과 같이 못 박음.
  leading?: ReactNode;
  children?: ReactNode;
};

// 작은 라벨 chip — 카테고리 / 메타 / 상태 표시. 8+ 자리 산재 패턴 흡수.
// variant: default(surface-hover bg + secondary text) / outline(border only) / accent(bg-base + border)
// size: sm (text-[10px], px-1.5 py-0.5) / md (text-[11px], px-2 py-0.5)
// dot: hex 또는 var() — 좌측 1.5x1.5 rounded-full 색 (카테고리 시그널)
export function Chip({
  variant = "default",
  size = "md",
  dot,
  leading,
  className = "",
  style,
  children,
  ...rest
}: Props) {
  const sizeClass =
    size === "sm"
      ? "rounded px-1.5 py-0.5 text-[10px]"
      : "rounded-md px-1.5 py-0.5 text-[11px]";

  const variantStyle: React.CSSProperties =
    variant === "outline"
      ? {
          backgroundColor: "transparent",
          color: "var(--sub)",
          border: "1px solid var(--line)",
        }
      : variant === "accent"
        ? {
            backgroundColor: "var(--bg)",
            color: "var(--sub)",
            border: "1px solid var(--line)",
          }
        : {
            backgroundColor: "var(--surface-2)",
            color: "var(--sub)",
          };

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap ${sizeClass} ${className}`}
      style={{ ...variantStyle, ...style }}
      {...rest}
    >
      {dot ? (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: dot }}
        />
      ) : null}
      {leading}
      {children}
    </span>
  );
}
