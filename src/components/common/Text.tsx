import type { ElementType, HTMLAttributes, ReactNode } from "react";

type Variant =
  | "display" // text-3xl, h1 (포트폴리오 헤더 등)
  | "h1" // text-2xl
  | "h2" // text-xl
  | "h3" // text-lg
  | "h4" // text-base, font-semibold
  | "body" // text-sm (default)
  | "caption" // text-xs
  | "label"; // text-sm, font-medium (form label)

type Color =
  | "primary"
  | "secondary"
  | "muted"
  | "inverse"
  | "danger"
  | "info"
  | "inherit";

type Weight = "normal" | "medium" | "semibold" | "bold";

type Props<E extends ElementType = "p"> = {
  variant?: Variant;
  color?: Color;
  weight?: Weight;
  truncate?: boolean;
  as?: E;
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "color">;

// 디자인 토큰 기반 Text. 270 자리 raw text utility 흡수.
// variant — size + 기본 weight. color — text token 매핑. as — 시맨틱 태그 override.
const variantClass: Record<Variant, string> = {
  display: "text-3xl font-bold",
  h1: "text-2xl font-bold",
  h2: "text-xl font-semibold",
  h3: "text-lg font-semibold",
  h4: "text-base font-semibold",
  body: "text-sm",
  caption: "text-xs",
  label: "text-sm font-medium",
};

const variantDefaultAs: Record<Variant, ElementType> = {
  display: "h1",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  body: "p",
  caption: "span",
  label: "label",
};

const colorVar: Record<Color, string | undefined> = {
  primary: "var(--ink)",
  secondary: "var(--sub)",
  muted: "var(--faint)",
  inverse: "var(--text-inverse)",
  danger: "var(--down-ink)",
  info: "var(--accent-ink)",
  inherit: undefined,
};

const weightClass: Record<Weight, string> = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
};

export function Text<E extends ElementType = "p">({
  variant = "body",
  color = "primary",
  weight,
  truncate = false,
  as,
  className = "",
  children,
  style,
  ...rest
}: Props<E>) {
  const Tag = (as ?? variantDefaultAs[variant]) as ElementType;
  const wClass = weight ? weightClass[weight] : "";
  const tClass = truncate ? "truncate" : "";
  const cVar = colorVar[color];

  return (
    <Tag
      className={`${variantClass[variant]} ${wClass} ${tClass} ${className}`.trim()}
      style={{ color: cVar, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
