import type { ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSidebarToggle } from "../../hooks/sidebarToggle";
import { Button } from "./Button";

type Props = {
  // 3-col grid 의 좌/가운데/우 slot. 빈 칸은 빈 div 자동 채움 (grid track 유지 → 가운데 viewport-center).
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  // 추가 className (drag region / 배경 override 등). default 패턴은 wrapper 가 다 제공.
  className?: string;
  // default true. desktop flex-col 부모 (예: MeetingForm) 에서는 false — flex
  // item shrink-0 가 자동 고정해서 sticky 까지 박으면 헤더 height 만큼 scroll 발생.
  sticky?: boolean;
};

// 본문 페이지 헤더 — 메모/할 일/내 작업/캘린더 4 페이지 공통 패턴.
// height = var(--page-header-h) (52px, 사이드바 헤더와 통일).
// grid 3-col (1fr / auto / 1fr) — 좌/우 그룹 너비 변해도 가운데 viewport-center 유지.
// sticky top-0 z-20 (default) — fragment 부모 (PortfolioPage / TasksPage) 에서
//   유일한 고정 방법. flex-col 부모 (MeetingForm) 는 sticky=false + lg:shrink-0
//   조합으로 flex item 자동 고정.
export function PageHeaderBar({
  left,
  center,
  right,
  className = "",
  sticky = true,
}: Props) {
  const position = sticky ? "sticky top-0 z-20" : "";
  const sidebarToggle = useSidebarToggle();
  return (
    <div
      className={`${position} grid items-center gap-2 overflow-hidden px-3 backdrop-blur lg:shrink-0 ${className}`}
      style={{
        height: "var(--page-header-h)",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, auto) minmax(0, 1fr)",
        backgroundColor: "var(--bg-overlay)",
        borderBottom: "1px solid var(--line-2)",
      }}
    >
      <div className="flex shrink-0 items-center gap-2 justify-self-start">
        {/* 사이드바 열기/닫기 토글 — undo/redo 등 left slot 왼쪽 고정. 데스크탑 전용
            (모바일은 드로어). 열림=닫기 아이콘, 닫힘=열기 아이콘 — 자리 불변. */}
        {sidebarToggle ? (
          <Button
            variant="icon"
            onClick={sidebarToggle.toggle}
            title={sidebarToggle.collapsed ? "사이드바 열기 (⌘\\)" : "사이드바 닫기 (⌘\\)"}
            aria-label={sidebarToggle.collapsed ? "사이드바 열기" : "사이드바 닫기"}
            className="hidden lg:inline-flex"
            style={{ color: "var(--sub)" }}
          >
            {sidebarToggle.collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        ) : null}
        {left}
      </div>
      <div className="justify-self-center">{center}</div>
      <div className="flex shrink-0 items-center gap-1 justify-self-end">
        {right}
      </div>
    </div>
  );
}
