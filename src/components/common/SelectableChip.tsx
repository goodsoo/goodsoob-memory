import type { ReactNode } from "react";
import { Chip } from "./Chip";

// 토글 가능한 chip — 카테고리/태그 필터에서 공통. 포트폴리오 카테고리 row 패턴이
// 원본. 메모장 태그 chip 도 같은 시각.
//   - active: color 의 14% tint bg + 1px inset ring + primary 텍스트
//   - inactive: bg-surface-hover + secondary 텍스트, ring 없음
//   - count=0 + inactive 면 opacity 0.45 (없는 카테고리/태그 dim)
//   - 글꼴 굵기는 active/inactive 동일 — 토글 시 chip 너비 흔들림 방지.
// color 없으면 (예: 태그) tint/ring 도 fallback (text-secondary 톤).

type Props = {
  children: ReactNode;
  active: boolean;
  onToggle: () => void;
  // 카테고리 점 색 + active tint/ring 색. 없으면 dot 안 그리고 active 는 단색
  // border 로 표시 — 태그처럼 색 매핑 없는 경우 대응.
  color?: string;
  // count 표시 안 하지만, 0 이고 inactive 면 dim 처리에 사용.
  count?: number;
  title?: string;
  size?: "sm" | "md";
  className?: string;
};

export function SelectableChip({
  children,
  active,
  onToggle,
  color,
  count,
  title,
  size = "sm",
  className = "",
}: Props) {
  // color 있을 땐 카테고리 패턴 (tint + ring), 없을 땐 일반 border accent.
  const accent = color ?? "var(--sub)";
  const tintBg = color
    ? `color-mix(in srgb, ${color} 14%, var(--surface))`
    : "var(--surface-3)";

  return (
    <Chip
      size={size}
      dot={color}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      title={title}
      className={`cursor-pointer select-none ${className}`}
      style={{
        backgroundColor: active ? tintBg : "var(--surface-2)",
        color: active ? "var(--ink)" : "var(--sub)",
        boxShadow: active ? `inset 0 0 0 1px ${accent}` : undefined,
        opacity: count === 0 && !active ? 0.45 : 1,
      }}
    >
      {children}
    </Chip>
  );
}
