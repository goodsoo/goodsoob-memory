import { useCallback, useEffect, useRef, useState } from "react";

const BAND_LOW = 0.2;
const BAND_HIGH = 0.8;

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * 재생 따라 스크롤. 활성 문단 row 는 scrollEl 안의 `[data-active="true"]` 로 찾는다.
 * - 활성 문단이 바뀌었고 스크롤 영역 20~80% 구간 밖이면 가운데로 이동.
 * - 스크롤 영역의 wheel·touchmove·PageUp/PageDown/Home/End → following=false.
 * - resume() → following=true + 즉시 활성 문단으로 이동.
 * - suspended(문단 고치는 중)에는 이동만 멈춥니다. following 값은 그대로.
 */
export function useFollowPlayback({
  scrollEl,
  activeIndex,
  suspended,
}: {
  scrollEl: HTMLElement | null;
  activeIndex: number;
  suspended: boolean;
}): { following: boolean; resume: () => void } {
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(following);
  followingRef.current = following;

  const scrollToActive = useCallback(
    (force: boolean) => {
      if (!scrollEl) return;
      const row = scrollEl.querySelector<HTMLElement>('[data-active="true"]');
      if (!row) return;
      if (!force) {
        const box = scrollEl.getBoundingClientRect();
        const r = row.getBoundingClientRect();
        if (box.height > 0) {
          const center = (r.top + r.height / 2 - box.top) / box.height;
          if (center >= BAND_LOW && center <= BAND_HIGH) return;
        }
      }
      row.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    },
    [scrollEl],
  );

  // 활성 문단이 바뀔 때.
  useEffect(() => {
    if (activeIndex < 0 || !following || suspended) return;
    scrollToActive(false);
  }, [activeIndex, following, suspended, scrollToActive]);

  // 사용자가 직접 스크롤하면 따라가기를 끊는다.
  useEffect(() => {
    if (!scrollEl) return;
    const stop = () => setFollowing(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "PageUp" || e.key === "PageDown" || e.key === "Home" || e.key === "End") stop();
    };
    scrollEl.addEventListener("wheel", stop, { passive: true });
    scrollEl.addEventListener("touchmove", stop, { passive: true });
    scrollEl.addEventListener("keydown", onKey);
    return () => {
      scrollEl.removeEventListener("wheel", stop);
      scrollEl.removeEventListener("touchmove", stop);
      scrollEl.removeEventListener("keydown", onKey);
    };
  }, [scrollEl]);

  const resume = useCallback(() => {
    setFollowing(true);
    scrollToActive(true);
  }, [scrollToActive]);

  return { following, resume };
}
