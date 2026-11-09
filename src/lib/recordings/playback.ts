// 녹음 재생 순수 로직 — 배속 단계, 문단 시작 시각 기반 이동, 시간 표기.

export const RATES: readonly number[] = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** 현재 배속에서 한 단계 올리기(1) / 내리기(-1). 목록 밖 값은 가장 가까운 단계 기준. 양 끝은 고정. */
export function nextRate(cur: number, dir: 1 | -1): number {
  let nearest = 0;
  for (let i = 1; i < RATES.length; i++) {
    if (Math.abs(RATES[i] - cur) < Math.abs(RATES[nearest] - cur)) nearest = i;
  }
  const idx = Math.min(RATES.length - 1, Math.max(0, nearest + dir));
  return RATES[idx];
}

/**
 * sec 에 재생 중인 문단 번호. starts 는 오름차순 시작 시각(초).
 * -1 = 첫 문단 시작 전(또는 문단 없음). 이분 탐색.
 */
export function activeTurnAt(starts: readonly number[], sec: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= sec) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** 현재 문단 시작에서 이 시간(초)보다 더 지났으면 "이전"이 현재 문단 시작으로 간다. */
export const PREV_TURN_GRACE_SEC = 1.5;

/** ↑: 현재 문단 시작에서 1.5초 넘게 지났으면 현재 문단 시작, 아니면 그 앞 문단 시작(첫 문단이면 그 시작, 문단 전이면 0). */
export function prevTurnTarget(starts: readonly number[], sec: number, active: number): number {
  if (starts.length === 0 || active < 0) return 0;
  if (sec - starts[active] > PREV_TURN_GRACE_SEC) return starts[active];
  return active > 0 ? starts[active - 1] : starts[0];
}

/** ↓: 다음 문단 시작(초). 마지막 문단이면 null. 첫 문단 전(-1)이면 첫 문단. */
export function nextTurnTarget(starts: readonly number[], active: number): number | null {
  const i = active + 1;
  return i >= 0 && i < starts.length ? starts[i] : null;
}

/** "m:ss" 또는 한 시간 이상이면 "h:mm:ss". 음수·NaN 은 0. */
export function formatPlayTime(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
