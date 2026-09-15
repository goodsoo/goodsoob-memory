import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

type Variant = "primary" | "secondary" | "danger" | "info" | "ghost" | "icon";
type Size = "sm" | "md";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: Variant;
  size?: Size;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

// 디자인 토큰 기반 Button. 141 자리 raw <button> 흡수.
// variant — primary(filled black) / secondary(outlined) / danger(red) / info(blue) /
//           ghost(no fill, hover surface) / icon(아이콘 only)
// size sm = xs/px-2.5, md = sm/px-3 (default). icon 은 size 무시 + p-1.5 정사각.
// 자리마다 미세 override 가 필요한 경우 className + style 그대로 통과.
export function Button({
  variant = "secondary",
  size = "md",
  leftIcon,
  rightIcon,
  className = "",
  type = "button",
  style,
  children,
  ...rest
}: Props) {
  const sizeClass =
    variant === "icon"
      ? "p-1.5 text-sm"
      : size === "sm"
        ? "px-2.5 py-1 text-xs"
        : "px-3 py-1.5 text-sm";

  // icon variant 는 정사각 → 중앙 정렬. 다른 variant 는 default flex-start —
  // 사이드바 항목 / 메뉴 아이템 등 left-align 자리 className override 없이 동작.
  // 중앙 정렬 필요한 자리는 caller 가 className="justify-center text-center" 박음.
  // text-align: native button 의 default 가 center — flex children 의 inline 텍스트
  // (span > text) 가 inherit 받아 중앙 정렬됨. icon 외엔 text-left 박아서 truncate
  // span 안 텍스트가 left-align 되도록.
  const justify = variant === "icon" ? "justify-center text-center" : "text-left";

  const hover =
    variant === "primary" || variant === "danger" || variant === "info"
      ? "hover:opacity-90"
      : "hover:bg-[var(--surface-2)]";

  const variantStyle: React.CSSProperties =
    variant === "primary"
      ? { backgroundColor: "var(--btn-primary)", color: "var(--btn-primary-text)" }
      : variant === "danger"
        ? { backgroundColor: "var(--down)", color: "var(--text-inverse)" }
        : variant === "info"
          ? { backgroundColor: "var(--accent)", color: "var(--text-inverse)" }
          : variant === "secondary"
            ? {
                border: "1px solid var(--line)",
                color: "var(--sub)",
              }
            : { color: "var(--sub)" };

  return (
    <button
      type={type}
      className={`inline-flex items-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${justify} ${sizeClass} ${hover} ${className}`}
      style={{ minHeight: 0, ...variantStyle, ...style }}
      {...rest}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  );
}
