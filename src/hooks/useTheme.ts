import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

type Theme = "light" | "dark";

type Origin = { x: number; y: number };

type ToggleOptions = { origin?: Origin };

const STORAGE_KEY = "goodsoob-theme";

// 디자인 토큰 `--bg` 의 light/dark 값과 동기. overlay 가 새 테마 색이어야
// wipe 끝 시점에 실제 data-theme 전환해도 사용자 시점에서 깜빡임 0.
const BG_BASE: Record<Theme, string> = {
  light: "#ffffff",
  dark: "#0c0f16",
};

const WIPE_MS = 350;

function applyTheme(theme: Theme) {
  // canonical: :root = 라이트 기본, 다크일 때만 data-theme="dark" 세팅(라이트는 속성 제거).
  if (theme === "dark") {
    document.documentElement.dataset.theme = "dark";
  } else {
    delete document.documentElement.dataset.theme;
  }
}

function radiusFrom(origin: Origin): number {
  const { innerWidth: w, innerHeight: h } = window;
  // 화면 4 모서리 중 가장 먼 곳까지 닿는 반지름 — wipe 가 끝까지 덮도록.
  const dx = Math.max(origin.x, w - origin.x);
  const dy = Math.max(origin.y, h - origin.y);
  return Math.hypot(dx, dy);
}

function runWipe(origin: Origin, nextTheme: Theme, onFinish: () => void) {
  const r = radiusFrom(origin);
  const overlay = document.createElement("div");
  overlay.style.cssText = [
    "position: fixed",
    "inset: 0",
    "z-index: 9999",
    "pointer-events: none",
    `background-color: ${BG_BASE[nextTheme]}`,
    `clip-path: circle(0px at ${origin.x}px ${origin.y}px)`,
    `transition: clip-path ${WIPE_MS}ms ease-out`,
    "will-change: clip-path",
  ].join(";");
  document.body.appendChild(overlay);

  // 두 번째 rAF 에서 clip-path 변경해야 transition 이 안정적으로 trigger.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.style.clipPath = `circle(${r}px at ${origin.x}px ${origin.y}px)`;
    });
  });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    onFinish();
    // overlay 가 화면 가득인 상태로 150ms 더 유지 — flushSync 로 React commit
    // 동기 강제했지만 그 다음 browser paint 가 큰 DOM 에선 한 프레임을 넘김.
    // 그 사이 overlay 가 변화를 가려 사용자 시점엔 깔끔.
    window.setTimeout(() => overlay.remove(), 250);
  };
  overlay.addEventListener("transitionend", cleanup, { once: true });
  // 안전망: transitionend 못 받으면 (브라우저 quirk) 시간으로 강제 cleanup.
  window.setTimeout(() => {
    if (overlay.isConnected) cleanup();
  }, WIPE_MS + 100);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored === "light" || stored === "dark") return stored;
    // 첫 방문: 시스템 설정 따르고 저장
    const system = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" as const
      : "light" as const;
    localStorage.setItem(STORAGE_KEY, system);
    return system;
  });

  const setTheme = useCallback((next: Theme, options?: ToggleOptions) => {
    const commit = () => {
      // wipe 끝 시점에 호출. flushSync 로 React 가 동기 commit 하도록 강제 →
      // setTimeout 안에 browser paint 까지 끝낼 시간 마진 확보. 안 그러면
      // React batching 으로 commit 이 다음 task 까지 미뤄져 overlay 사라진 뒤
      // 컴포넌트 변화가 보임.
      flushSync(() => setThemeState(next));
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
    };

    const origin = options?.origin;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!origin || prefersReducedMotion) {
      commit();
      return;
    }

    runWipe(origin, next, commit);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback((options?: ToggleOptions) => {
    setTheme(theme === "light" ? "dark" : "light", options);
  }, [theme, setTheme]);

  return { theme, setTheme, toggle };
}
