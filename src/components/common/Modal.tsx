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

// 4-tier size 토큰. width 는 max-w 로 캡, height 는 lg/xl 만 viewport-aware 고정값
// — content 변화에 흔들리지 않는 시각 안정감. sm/md 는 자유 (내부 list 가 자체 cap).
const SIZE: Record<
  Size,
  { maxW: string; height?: string; radius: string; isContainer: boolean }
> = {
  sm: { maxW: "max-w-sm", radius: "rounded-lg", isContainer: false },
  md: { maxW: "max-w-md", radius: "rounded-xl", isContainer: false },
  lg: {
    maxW: "max-w-3xl",
    height: "min(560px, 80vh)",
    radius: "rounded-xl",
    isContainer: true,
  },
  xl: {
    maxW: "max-w-5xl",
    height: "min(640px, 85vh)",
    radius: "rounded-xl",
    isContainer: true,
  },
};

// backdrop close: mousedown 시작점이 backdrop 자체일 때만 닫음 — inner 안에서 시작한
// 드래그가 바깥에서 mouseup 되어 click 이 backdrop 으로 발사되는 케이스 차단.
// Portal 로 body 에 mount — 부모 chain 의 stacking context / transform 가 fixed 좌표
// 깨는 케이스 회피. 타이틀바 영역 (z-50) 포함 viewport 전체 덮음 (z-[60]).
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
  const backgroundColor =
    backdrop === "overlay" ? "var(--bg-overlay)" : "rgba(0,0,0,0.4)";
  // lg/xl 만 flex container — sm/md 는 content-driven 이라 flex 불필요.
  const flexClass = cfg.isContainer
    ? orientation === "vertical"
      ? "flex flex-col"
      : "flex"
    : "";

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (!dismissOnBackdrop) return;
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ backgroundColor }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={`w-full overflow-hidden shadow-xl ${maxWidth ?? cfg.maxW} ${cfg.radius} ${flexClass}`}
        style={{
          backgroundColor: "var(--surface)",
          border: "1px solid var(--line)",
          ...(cfg.height ? { height: cfg.height } : {}),
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
