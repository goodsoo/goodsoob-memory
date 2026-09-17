import {
  useEffect,
  useRef,
  type ReactNode,
} from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  // trigger element 가 popover 의 anchor 가 됨. trigger 도 자식으로 받음.
  trigger: ReactNode;
  // popover panel content. open 일 때만 렌더.
  children: ReactNode;
  // panel className + style — 위치/너비/배경 caller 결정.
  panelClassName?: string;
  panelStyle?: React.CSSProperties;
  // wrapper className (relative inline-flex default).
  className?: string;
  // ESC / 외부 클릭 닫기 default on.
  dismissOnEscape?: boolean;
  dismissOnOutside?: boolean;
};

// Adapter: 동작(open/onClose/ESC/외부클릭)은 그대로, 패널 시각을 DS 토큰으로 정합.
//
// DS Popover(src/ds/Popover.tsx)는 내부 useState 토글 + content prop 구조라
// 직접 교체 불가. 대신 .ds-popover 의 패널 토큰을 인라인으로 복제:
//   background : var(--surface)
//   border     : 1px solid var(--line)
//   border-radius : var(--radius-8)
//   box-shadow : var(--shadow-popover)
//   padding    : var(--space-12)
//   top offset : calc(100% + var(--space-4))   ← absolute 위치; className 에 적용
//
// 기본 panelStyle 로 DS 토큰을 내장하되, caller 의 panelStyle 이 spread 로 override
// 가능 — 6곳 사용처는 수정 없이 각자 토큰을 유지하거나 override한다.
// 사용처가 panelClassName 으로 rounded-*/shadow-* Tailwind 를 명시한 경우
// 해당 클래스가 덮어쓰므로 시각 회귀 없음.

// 외부 클릭 / ESC 자동 닫기 boilerplate 흡수. 6 자리 (SidePanel SortMenu /
// MeetingContextMenu / FolderContextMenu / TaskRow 연결 메모 / MeetingPicker /
// CategoryPicker) 의 useEffect + mousedown + keydown listener 통합.
//
// trigger 는 wrapper 안 렌더, panel 은 open 일 때만 trigger 아래 절대 위치.
// caller 가 trigger 의 click handler 직접 — open state 토글 / mutation 다 caller.

// DS Popover 패널 기본 토큰 — .ds-popover 와 동일 값.
const DS_PANEL_STYLE = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-8)",
  boxShadow: "var(--shadow-popover)",
  padding: "var(--space-12)",
};

export function Popover({
  open,
  onClose,
  trigger,
  children,
  panelClassName = "",
  panelStyle,
  className = "relative inline-flex",
  dismissOnEscape = true,
  dismissOnOutside = true,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!dismissOnOutside) return;
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (!dismissOnEscape) return;
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, dismissOnEscape, dismissOnOutside, onClose]);

  return (
    <div ref={wrapRef} className={className}>
      {trigger}
      {open ? (
        <div
          className={panelClassName}
          style={{ ...DS_PANEL_STYLE, ...panelStyle }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
