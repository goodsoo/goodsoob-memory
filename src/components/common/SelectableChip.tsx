import type { ReactNode } from "react";
import { Chip } from "@goodsoob/ds";
import { chipDot } from "../../lib/chipDot";
import "./selectable-chip.css";

// 토글 필터칩 — 버튼/aria-pressed/키보드/focus 는 DS Chip 의 `selectable` 에 위임하고
// (semantics = DS 소유), 메모리 도메인 시각만 여기서 얹는 얇은 래퍼:
//   - active: color 의 14% tint bg + 1px inset ring + primary 텍스트 (DS 기본
//     selected 는 accent 블루라 카테고리 중립 톤과 달라 override — CSS 로 소유)
//   - inactive: surface-2 + secondary 텍스트
//   - count=0 + inactive → dim (opacity 0.45)
//   - color 있으면 좌측 색점(dot). 없으면(예: "전체") 점 없이 fallback 톤.
// ⚠️ DS 갭: DS Chip 은 selected 색을 파라미터화(카테고리 색)하거나 style 을
// passthrough 하지 않아 중립 tint/ring·dim 을 DS API 로 직접 표현 불가.
// 그래서 시각은 메모리 className(selectable-chip.css)으로 소유 — /ds-fix 제보 후보.
type Props = {
  children: ReactNode;
  active: boolean;
  onToggle: () => void;
  color?: string;
  count?: number;
  title?: string;
  className?: string;
};

export function SelectableChip({
  children,
  active,
  onToggle,
  color,
  count,
  className = "",
}: Props) {
  const classes = [
    "mem-selectable-chip",
    count === 0 && !active ? "is-dim" : "",
    color ? "" : "no-color",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Chip
      variant="neutral"
      size="sm"
      selectable
      selected={active}
      onClick={onToggle}
      icon={color ? chipDot(color) : undefined}
      className={classes}
    >
      {children}
    </Chip>
  );
}
