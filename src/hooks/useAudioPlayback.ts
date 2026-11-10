import { useCallback, useEffect, useRef, useState, type AudioHTMLAttributes, type RefObject } from "react";
import { audioUrl } from "../api/recordings";
import { nextRate } from "../lib/recordings/playback";

export type PlaybackState = "ready" | "syncPending" | "missing" | "failed";

export interface RecordingPlayer {
  audioRef: RefObject<HTMLAudioElement | null>;
  /** 숨긴 `<audio ref={audioRef} {...audioProps} />` 에 펼칩니다. state 가 ready 일 때만 렌더하세요. */
  audioProps: AudioHTMLAttributes<HTMLAudioElement>;
  state: PlaybackState;
  playing: boolean;
  currentSec: number;
  durationSec: number;
  rate: number;
  /** retry() 요청이 진행 중. */
  retrying: boolean;
  toggle: () => void;
  /** play 기본값 false (재생 상태 유지). metadata 전이면 보류했다가 적용합니다. */
  seek: (sec: number, opts?: { play?: boolean }) => void;
  skip: (deltaSec: number) => void;
  setRate: (r: number) => void;
  cycleRate: (dir: 1 | -1) => void;
  retry: () => void;
}

export const RATE_STORAGE_KEY = "goodsoob:recordingRate";

function readRate(): number {
  try {
    const v = Number(localStorage.getItem(RATE_STORAGE_KEY));
    if (Number.isFinite(v) && v >= 0.5 && v <= 3) return v;
  } catch {
    /* 저장소 접근 불가 */
  }
  return 1;
}

function statusToState(status: number): PlaybackState {
  return status === 503 ? "syncPending" : status === 404 ? "missing" : "failed";
}

// 녹음 재생 — `<audio>` 가 /api/audio 를 직접 연다 (Range seek 는 서버 Bun.file 이 처리).
// `<audio>` 의 error 이벤트는 HTTP 상태를 안 알려주므로, 실패하면 한 번 더 요청해 503
// (iCloud 동기화 대기) / 404 (파일 없음) 를 구분한다.
export function useAudioPlayback({
  base,
  syncPending,
}: {
  base: string;
  syncPending: boolean;
}): RecordingPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<PlaybackState>(syncPending ? "syncPending" : "ready");
  const [playing, setPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [rate, setRateState] = useState(readRate);
  const [retrying, setRetrying] = useState(false);
  // metadata 로드 전 seek 는 보류했다가 loadedmetadata 에서 적용.
  const pendingSeek = useRef<{ sec: number; play: boolean } | null>(null);

  // 다른 녹음으로 바뀌면 초기화.
  useEffect(() => {
    setState(syncPending ? "syncPending" : "ready");
    setPlaying(false);
    setCurrentSec(0);
    setDurationSec(0);
    pendingSeek.current = null;
  }, [base, syncPending]);

  // 배속 적용 (audio 가 새로 마운트될 때도 loadedmetadata 에서 다시 적용).
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, state]);

  // 재생 중에는 rAF 로 진행 표시를 부드럽게.
  useEffect(() => {
    if (!playing || state !== "ready") return;
    let id = 0;
    const tick = () => {
      const el = audioRef.current;
      if (el) setCurrentSec(el.currentTime);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, state]);

  const diagnose = useCallback(async () => {
    setPlaying(false);
    try {
      const res = await fetch(audioUrl(base), { headers: { Range: "bytes=0-0" } });
      setState(statusToState(res.status));
    } catch {
      setState("failed");
    }
  }, [base]);

  const retry = useCallback(() => {
    setRetrying(true);
    void (async () => {
      try {
        // 이 요청이 서버에서 brctl download 를 건다. 200/206 이면 플레이어를 다시 띄운다.
        const res = await fetch(audioUrl(base), { headers: { Range: "bytes=0-0" } });
        setState(res.ok ? "ready" : statusToState(res.status));
      } catch {
        setState("failed");
      } finally {
        setRetrying(false);
      }
    })();
  }, [base]);

  const seek = useCallback((sec: number, opts?: { play?: boolean }) => {
    const play = opts?.play ?? false;
    const target = Math.max(0, sec);
    const el = audioRef.current;
    if (el && el.readyState >= 1) {
      const max = Number.isFinite(el.duration) ? el.duration : Infinity;
      const t = Math.min(target, max);
      el.currentTime = t;
      setCurrentSec(t);
      if (play) void el.play().catch(() => {});
    } else {
      pendingSeek.current = { sec: target, play };
      setCurrentSec(target);
    }
  }, []);

  const currentRef = useRef(0);
  currentRef.current = currentSec;
  const skip = useCallback(
    (delta: number) => {
      const el = audioRef.current;
      const cur = el && el.readyState >= 1 ? el.currentTime : currentRef.current;
      seek(cur + delta, { play: false });
    },
    [seek],
  );

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const setRate = useCallback((r: number) => {
    setRateState(r);
    try {
      localStorage.setItem(RATE_STORAGE_KEY, String(r));
    } catch {
      /* 저장소 접근 불가 */
    }
  }, []);

  const cycleRate = useCallback(
    (dir: 1 | -1) => setRate(nextRate(rate, dir)),
    [rate, setRate],
  );

  // 미디어키·AirPods: 최신 핸들러를 ref 로.
  const apiRef = useRef({ toggle, skip });
  useEffect(() => {
    apiRef.current = { toggle, skip };
  });
  useEffect(() => {
    if (state !== "ready") return;
    if (typeof navigator === "undefined" || !("mediaSession" in navigator) || !navigator.mediaSession) return;
    const ms = navigator.mediaSession;
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ["play", () => apiRef.current.toggle()],
      ["pause", () => apiRef.current.toggle()],
      ["seekbackward", () => apiRef.current.skip(-5)],
      ["seekforward", () => apiRef.current.skip(5)],
    ];
    const set: MediaSessionAction[] = [];
    for (const [action, fn] of handlers) {
      try {
        ms.setActionHandler(action, fn);
        set.push(action);
      } catch {
        /* 지원하지 않는 action */
      }
    }
    return () => {
      for (const action of set) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          /* 무시 */
        }
      }
    };
  }, [state]);

  const audioProps: AudioHTMLAttributes<HTMLAudioElement> = {
    src: audioUrl(base),
    preload: "metadata",
    onError: () => void diagnose(),
    onLoadedMetadata: (e) => {
      const el = e.currentTarget;
      el.playbackRate = rate;
      setDurationSec(Number.isFinite(el.duration) ? el.duration : 0);
      const p = pendingSeek.current;
      if (p) {
        pendingSeek.current = null;
        el.currentTime = p.sec;
        setCurrentSec(p.sec);
        if (p.play) void el.play().catch(() => {});
      }
    },
    onDurationChange: (e) => {
      const d = e.currentTarget.duration;
      setDurationSec(Number.isFinite(d) ? d : 0);
    },
    onTimeUpdate: (e) => setCurrentSec(e.currentTarget.currentTime),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
  };

  return {
    audioRef,
    audioProps,
    state,
    playing,
    currentSec,
    durationSec,
    rate,
    retrying,
    toggle,
    seek,
    skip,
    setRate,
    cycleRate,
    retry,
  };
}
