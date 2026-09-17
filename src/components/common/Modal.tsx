// Adapter: wraps canonical DS Modal panel chrome via CSS tokens.
//
// DS Modal (src/ds/Modal.tsx) provides panel chrome (.ds-modal: surface, border,
// radius, shadow) but its backdrop is hardwired to --bg-overlay and its ESC/backdrop
// dismiss cannot be disabled externally. We therefore:
//   - render our own backdrop (z-[60], portal to body, scrim/overlay colour)
//   - handle ESC via window keydown (not focus-dependent)
//   - handle backdrop dismiss via mousedown target check
//   - replicate .ds-modal panel tokens inline on our own panel div
//
// All 19 call-sites see the identical ModalProps API — no changes needed there.
//
// Mapping summary:
//   size        → max-w-* class + height inline style (lg/xl)
//   orientation → flex / flex-col class on panel (lg/xl only)
//   backdrop    → inline backgroundColor (scrim = rgba black, overlay = --bg-overlay)
//   dismissOnEscape    → window keydown guard
//   dismissOnBackdrop  → mousedown e.target === e.currentTarget guard
//   maxWidth    → overrides size's default max-w-* class (width only, height intact)
//   ariaLabel / ariaLabelledBy → aria-label / aria-labelledby on role="dialog" div

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Size = "sm" | "md" | "lg" | "xl";
type Orientation = "vertical" | "horizontal";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  // 4-tier 크기 토큰. sm/md = content-driven height, lg/xl = fixed (viewport 캡).
  size: Size;
  // lg/xl 에서만 효과 — wrapper 의 flex direction.
  // vertical (default) = header/body/footer 스택, horizontal = aside | content 분할.
  orientation?: Orientation;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  // scrim = 어두운 backdrop (rgba(0,0,0,0.4), 기본)
  // overlay = 토큰 기반 frost (var(--bg-overlay))
  backdrop?: "scrim" | "overlay";
  // 기본 true. confirm 중첩 등 Escape 를 다른 핸들러가 먹어야 하는 케이스 false.
  dismissOnEscape?: boolean;
  // 기본 true.
  dismissOnBackdrop?: boolean;
  // 옵션 — size 의 기본 max-width 를 override. 같은 size 토큰의 height/flex 는 유지하고
  // 가로 폭만 좁혀야 할 때 (예: 일기 lg). Tailwind max-w-* 클래스 문자열.
  maxWidth?: string;
};

// 4-tier size 토큰. width 는 max-w 로 캡, height 는 lg/xl 만 viewport-aware 고정값.
const SIZE: Record<
  Size,
  { maxW: string; height?: string; isContainer: boolean }
> = {
  sm: { maxW: "max-w-sm", isContainer: false },
  md: { maxW: "max-w-md", isContainer: false },
  lg: { maxW: "max-w-3xl", height: "min(560px, 80vh)", isContainer: true },
  xl: { maxW: "max-w-5xl", height: "min(640px, 85vh)", isContainer: true },
};

// backdrop close: mousedown 시작점이 backdrop 자체일 때만 닫음.
// Portal 로 body 에 mount — 부모 stacking context / transform 가 fixed 좌표 깨는 케이스 회피.
export function Modal({
  open,
  onClose,
  children,
  size,
  orientation = "vertical",
  ariaLabel,
  ariaLabelledBy,
  backdrop = "scrim",
  dismissOnEscape = true,
  dismissOnBackdrop = true,
  maxWidth,
}: ModalProps) {
  // window-level ESC — not focus-dependent, survives nested focus traps.
  useEffect(() => {
    if (!open || !dismissOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismissOnEscape, onClose]);

  if (!open) return null;

  const cfg = SIZE[size];

  const backdropColor =
    backdrop === "overlay" ? "var(--bg-overlay)" : "rgba(0,0,0,0.4)";

  // lg/xl containers get flex direction. sm/md are content-driven.
  const flexClass = cfg.isContainer
    ? orientation === "vertical"
      ? "flex flex-col"
      : "flex"
    : "";

  const effectiveMaxW = maxWidth ?? cfg.maxW;

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (!dismissOnBackdrop) return;
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ backgroundColor: backdropColor }}
    >
      {/* Panel — DS Modal chrome tokens applied inline to match .ds-modal exactly */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={`w-full overflow-hidden ${effectiveMaxW} ${flexClass}`.trim()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-16)",
          boxShadow: "var(--shadow-modal)",
          ...(cfg.height ? { height: cfg.height } : {}),
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
