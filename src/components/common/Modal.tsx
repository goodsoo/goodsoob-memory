// Thin wrapper over the canonical DS Modal (@goodsoob/ds).
//
// The DS Modal now owns ALL modal chrome — portal, backdrop, ESC, body-scroll-lock,
// size tiers (sm/md/lg/xl), and the `scrim` backdrop (via --bg-scrim). This adapter
// no longer replicates any of that; it only maps memory's local ModalProps onto the
// DS API so the ~18 call-sites stay unchanged.
//
// Two memory-specific concerns the DS Modal doesn't cover directly:
//
//   1. Panel padding — memory's call-sites bring their OWN header/body divs and
//      expect a flush, padding-free, overflow-hidden panel. DS Modal's `flush`
//      prop provides exactly that — no app-side `!p-0` utility override (adoption
//      원칙 1: DS 컴포넌트를 utility 로 개조하지 않는다).
//
//   2. `orientation` — DS Modal has no orientation. For lg/xl containers we
//      reproduce the flex panel behavior app-side by wrapping children in a
//      full-height flex box (row for horizontal, column for vertical). sm/md are
//      content-driven and pass children through untouched.
//
// Mapping summary:
//   size                → DS size (same names, same values)
//   backdrop (def scrim) → DS backdrop (memory defaults to scrim; DS defaults to overlay)
//   dismissOnEscape      → DS dismissOnEscape (same)
//   dismissOnBackdrop    → DS closeOnBackdrop
//   ariaLabel/By         → DS ariaLabel / ariaLabelledBy (same)
//   orientation          → app-side flex wrapper around children (lg/xl only)
//   maxWidth             → extra Tailwind max-w-* class on the DS panel

import type { ReactNode } from "react";
import { Modal as DsModal } from "@goodsoob/ds";

type Size = "sm" | "md" | "lg" | "xl";
type Orientation = "vertical" | "horizontal";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  // 4-tier 크기 토큰. sm/md = content-driven height, lg/xl = fixed (viewport 캡).
  size: Size;
  // lg/xl 에서만 효과 — 패널 flex direction.
  // vertical (default) = header/body/footer 스택, horizontal = aside | content 분할.
  orientation?: Orientation;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  // scrim = 어두운 backdrop (var(--bg-scrim), 기본)
  // overlay = 토큰 기반 frost (var(--bg-overlay))
  backdrop?: "scrim" | "overlay";
  // 기본 true. confirm 중첩 등 Escape 를 다른 핸들러가 먹어야 하는 케이스 false.
  dismissOnEscape?: boolean;
  // 기본 true.
  dismissOnBackdrop?: boolean;
  // 옵션 — size 의 기본 max-width 를 override. 같은 size 토큰의 height/flex 는 유지하고
  // 가로 폭만 좁혀야 할 때 (예: 요약 lg). Tailwind max-w-* 클래스 문자열.
  maxWidth?: string;
};

const isContainer = (size: Size) => size === "lg" || size === "xl";

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
  // maxWidth (Tailwind max-w-*) narrows the panel below the size tier's default.
  // Flush panel padding is owned by DS Modal's `flush` prop (not a utility override).
  const panelClass = [maxWidth].filter(Boolean).join(" ");

  // lg/xl containers get the flex layout the old adapter applied on the panel; we
  // reproduce it on a full-height wrapper since DS has no orientation and sites use
  // their own header/body divs (not DS slots). sm/md pass through (content-driven).
  const content = isContainer(size) ? (
    <div
      className={
        orientation === "horizontal"
          ? "flex h-full min-h-0"
          : "flex flex-col h-full min-h-0"
      }
    >
      {children}
    </div>
  ) : (
    children
  );

  return (
    <DsModal
      open={open}
      onClose={onClose}
      size={size}
      backdrop={backdrop}
      dismissOnEscape={dismissOnEscape}
      closeOnBackdrop={dismissOnBackdrop}
      flush
      ariaLabel={ariaLabel}
      ariaLabelledBy={ariaLabelledBy}
      className={panelClass}
    >
      {content}
    </DsModal>
  );
}
