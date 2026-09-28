import type { ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { PageHeader } from "@goodsoob/ds";
import { useSidebarToggle } from "../../hooks/sidebarToggle";
import { Button } from "./Button";

type Props = {
  // 3-col grid 의 좌/가운데/우 slot. 빈 칸은 grid track 유지 → 가운데 viewport-center.
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  // 추가 className (drag region / 배경 override 등).
  className?: string;
  // default true. desktop flex-col 부모 (예: MeetingForm) 에서는 false — flex
  // item shrink-0 가 자동 고정해서 sticky 까지 박으면 헤더 height 만큼 scroll 발생.
  sticky?: boolean;
};

// 본문 페이지 헤더 — 메모/할 일/내 작업/캘린더 4 페이지 공통 패턴.
// DS PageHeader 로 chrome(높이·grid·frost·sticky·divider)을 위임하는 얇은 wrapper.
// left/center/right 3-slot API 는 memory 호출부 계약이라 유지하고 DS 의
// left/centeredTitle(title)/actions 로 매핑한다.
//   - centeredTitle: 3-col grid (1fr / auto / 1fr) — 좌/우 그룹 폭 변해도 가운데 center 유지.
//   - frost: --surface-frost + backdrop-blur (기존 --bg-overlay 손수 배경을 DS frost 로 통일).
//   - divider: 하단 1px --line (기존 --line-2 손수 선을 DS line 으로 통일).
// 사이드바 토글은 app-glue(useSidebarToggle context + ⌘\ 키힌트 + 데스크탑 전용)로
// left slot 에 유지 — DS 는 presentational chrome 만 갖고 상태/키바인딩은 consumer 소유.
export function PageHeaderBar({
  left,
  center,
  right,
  className = "",
  sticky = true,
}: Props) {
  const sidebarToggle = useSidebarToggle();
  return (
    <PageHeader
      centeredTitle
      sticky={sticky}
      frost
      divider
      className={className}
      left={
        <>
          {/* 사이드바 열기/닫기 토글 — left slot 왼쪽 고정. 데스크탑 전용(모바일은
              드로어). 열림=닫기 아이콘, 닫힘=열기 아이콘 — 자리 불변. */}
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
        </>
      }
      title={center}
      actions={right}
    />
  );
}
