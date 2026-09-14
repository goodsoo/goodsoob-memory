import type { ReactNode } from "react";
import { Button } from "./Button";

type Props = {
  label: ReactNode;
  count?: number;
  // 12px wrapper 안에 들어가는 dot 또는 작은 아이콘. 없으면 wrapper 자체 안 그림.
  leading?: ReactNode;
  active?: boolean;
  // 미사용 / dimmed 항목용 (포트폴리오 "미사용" 카테고리 등). active 가 아닐 때 적용.
  muted?: boolean;
  onClick: () => void;
};

// 사이드바 공통 필터·버튼 항목. 옵시디안 톤 — px-2 py-1, 13px, compact.
// 포트폴리오 (project 필터) + 할 일 (status/category 필터) 두 사이드바가 공유.
// 캘린더 row 는 multi-line · checkbox 같은 복잡한 구조라 이 컴포넌트 쓰지 않고
// 같은 사이즈 룰만 따름 (시각 통일, 책임 분리).
export function FilterItem({
  label,
  count,
  leading,
  active,
  muted,
  onClick,
}: Props) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={`w-full justify-between gap-2 px-2 py-1 text-[13px] ${
        active ? "font-medium" : ""
      }`}
      style={{
        backgroundColor: active ? "var(--surface-3)" : undefined,
        color: muted
          ? "var(--faint)"
          : active
            ? "var(--ink)"
            : "var(--sub)",
      }}
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        {leading ? (
          <span
            aria-hidden
            className="inline-flex h-3 w-3 shrink-0 items-center justify-center"
          >
            {leading}
          </span>
        ) : null}
        <span className="truncate">{label}</span>
      </span>
      {typeof count === "number" ? (
        <span
          className="text-[11px] tabular-nums"
          style={{
            color: active ? "var(--sub)" : "var(--faint)",
          }}
        >
          {count}
        </span>
      ) : null}
    </Button>
  );
}
