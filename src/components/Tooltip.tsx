import { useEffect, useRef, useState } from "react";

type Placement = "top" | "bottom" | "left" | "right";

type Pos = {
  text: string;
  top: number;
  left: number;
  placement: Placement;
};

const SHOW_DELAY = 600;
const EDGE_THRESHOLD = 60; // 화면 가장자리 감지 픽셀
const ARROW_SIZE = 5;
const GAP = 8; // 트리거와 tooltip 사이 간격

// 페이지 전체에서 title="..."가 있는 요소에 hover하면 빠르고 예쁘게 커스텀 툴팁 표시.
// title은 dataset.tooltip으로 옮기고 (native 안 보이게), aria-label 자동 보강.
export function GlobalTooltip() {
  const [pos, setPos] = useState<Pos | null>(null);
  const timerRef = useRef<number | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const hasShownRef = useRef(false);

  useEffect(() => {
    function clearTimer() {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function compute(el: HTMLElement, text: string): Pos {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // 좌측 가장자리 → 오른쪽으로 띄움
      if (rect.left < EDGE_THRESHOLD) {
        return {
          text,
          top: rect.top + rect.height / 2,
          left: rect.right + GAP,
          placement: "right",
        };
      }
      // 우측 가장자리 → 왼쪽으로
      if (rect.right > vw - EDGE_THRESHOLD) {
        return {
          text,
          top: rect.top + rect.height / 2,
          left: rect.left - GAP,
          placement: "left",
        };
      }
      // 기본: 위쪽 공간 우선, 없으면 아래
      const above = rect.top > 48;
      const top = above ? rect.top - GAP : rect.bottom + GAP;
      return {
        text,
        top,
        left: rect.left + rect.width / 2,
        placement: above && top < vh ? "top" : "bottom",
      };
    }

    function arm(el: HTMLElement, text: string) {
      if (targetRef.current === el) return;
      targetRef.current = el;
      clearTimer();
      // 직전에 다른 tooltip 이 떠 있던 chain hover 면 즉시 표시
      const delay = hasShownRef.current ? 0 : SHOW_DELAY;
      timerRef.current = window.setTimeout(() => {
        hasShownRef.current = true;
        setPos(compute(el, text));
      }, delay);
    }

    function onOver(e: MouseEvent) {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      // title을 dataset.tooltip로 한 번 마이그레이션 + aria-label 보강
      if (el.title) {
        if (!el.dataset.tooltip) {
          el.dataset.tooltip = el.title;
          if (!el.getAttribute("aria-label")) {
            el.setAttribute("aria-label", el.title);
          }
        }
        el.title = "";
      }
      const text = el.dataset.tooltip;
      if (text) {
        arm(el, text);
        return;
      }
      // 같은 요소에서 자식으로 mouseover 이동 시 target은 자식. 부모로 거슬러 찾기.
      const parent = el.closest("[data-tooltip]") as HTMLElement | null;
      if (!parent) return;
      const parentText = parent.dataset.tooltip;
      if (!parentText) return;
      arm(parent, parentText);
    }

    function onOut(e: MouseEvent) {
      const to = e.relatedTarget as HTMLElement | null;
      const current = targetRef.current;
      if (!current) return;
      // 같은 트리거 element 안에서의 이동은 무시
      if (to && current.contains(to)) return;
      // 다른 [data-tooltip] 요소로 바로 넘어가는 경우엔 hasShownRef 유지
      const nextTooltipEl =
        to && (to.closest("[data-tooltip]") as HTMLElement | null);
      clearTimer();
      targetRef.current = null;
      setPos(null);
      if (!nextTooltipEl) {
        // 진짜 빈 곳으로 나가면 chain 끊김 → delay 다시 적용
        hasShownRef.current = false;
      }
    }

    function onScroll() {
      clearTimer();
      targetRef.current = null;
      hasShownRef.current = false;
      setPos(null);
    }

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onScroll);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onScroll);
      clearTimer();
    };
  }, []);

  if (!pos) return null;

  const containerTransform = (
    {
      top: "translate(-50%, -100%)",
      bottom: "translate(-50%, 0)",
      left: "translate(-100%, -50%)",
      right: "translate(0, -50%)",
    } as const
  )[pos.placement];

  return (
    <div
      role="tooltip"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        transform: containerTransform,
        zIndex: 1000,
        pointerEvents: "none",
        backgroundColor: "var(--surface-3)",
        color: "var(--ink)",
        border: "1px solid var(--line)",
        borderRadius: "0.375rem",
        padding: "0.25rem 0.5rem",
        fontSize: "0.75rem",
        lineHeight: 1.3,
        maxWidth: "20rem",
        whiteSpace: "normal",
        wordBreak: "keep-all",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.12)",
        opacity: 1,
        transition: "opacity 100ms ease-out",
      }}
    >
      {pos.text}
      <span style={arrowStyle(pos.placement)} />
    </div>
  );
}

function arrowStyle(placement: Placement): React.CSSProperties {
  const c = "var(--surface-3)";
  const base: React.CSSProperties = {
    position: "absolute",
    width: 0,
    height: 0,
  };
  if (placement === "top") {
    return {
      ...base,
      bottom: -ARROW_SIZE,
      left: "50%",
      marginLeft: -ARROW_SIZE,
      borderLeft: `${ARROW_SIZE}px solid transparent`,
      borderRight: `${ARROW_SIZE}px solid transparent`,
      borderTop: `${ARROW_SIZE}px solid ${c}`,
    };
  }
  if (placement === "bottom") {
    return {
      ...base,
      top: -ARROW_SIZE,
      left: "50%",
      marginLeft: -ARROW_SIZE,
      borderLeft: `${ARROW_SIZE}px solid transparent`,
      borderRight: `${ARROW_SIZE}px solid transparent`,
      borderBottom: `${ARROW_SIZE}px solid ${c}`,
    };
  }
  if (placement === "left") {
    return {
      ...base,
      right: -ARROW_SIZE,
      top: "50%",
      marginTop: -ARROW_SIZE,
      borderTop: `${ARROW_SIZE}px solid transparent`,
      borderBottom: `${ARROW_SIZE}px solid transparent`,
      borderLeft: `${ARROW_SIZE}px solid ${c}`,
    };
  }
  return {
    ...base,
    left: -ARROW_SIZE,
    top: "50%",
    marginTop: -ARROW_SIZE,
    borderTop: `${ARROW_SIZE}px solid transparent`,
    borderBottom: `${ARROW_SIZE}px solid transparent`,
    borderRight: `${ARROW_SIZE}px solid ${c}`,
  };
}
