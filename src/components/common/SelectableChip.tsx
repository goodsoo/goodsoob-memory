import type { ReactNode } from "react";
import { Chip } from "@goodsoob/ds";
import { chipDot } from "../../lib/chipDot";
import "./selectable-chip.css";

// 토글 필터칩 — 버튼/aria-pressed/키보드/focus 는 DS Chip 의 `selectable` 에 위임하고
// (semantics = DS 소유), 메모리 도메인 시각만 여기서 얹는 얇은 래퍼:
//   - active: DS variant-aware selected — neutral → surface-3 bg + ink + line-3 ring
//   - inactive: surface-2 + secondary 텍스트
//   - count=0 + inactive → dim (opacity 0.45)
//   - color 있으면 좌측 색점(dot). 없으면(예: "전체") 점 없이.
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
