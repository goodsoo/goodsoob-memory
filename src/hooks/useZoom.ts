import { useSyncExternalStore } from "react";

// 앱 화면 배율 (글자 가독성용 확대/축소). 모듈 단일 store —
// App.tsx 의 단축키 핸들러는 imperative 함수로, Settings UI 는 useZoom 훅으로 같은
// 상태를 공유한다 (prop drilling 없이).
//
// 적용 방식: CSS zoom (document.documentElement.style.zoom).

const STORAGE_KEY = "goodsoob:zoom";

export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 1.8;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 1;
const EPS = 1e-9;

function clamp(z: number): number {
  // 0.1 step 으로 반올림 + 범위 clamp. float drift (1.0000000002) 차단.
  const rounded = Math.round(z * 10) / 10;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rounded));
}

function readStored(): number {
  if (typeof localStorage === "undefined") return ZOOM_DEFAULT;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw == null) return ZOOM_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(n) : ZOOM_DEFAULT;
}

let current = readStored();
const listeners = new Set<() => void>();

function apply(factor: number): void {
  if (typeof document !== "undefined") {
    document.documentElement.style.zoom = String(factor);
  }
}

/** 앱 부팅 시 1회 — 저장된 배율을 첫 페인트 시점에 적용 (main.tsx). */
export function applyStoredZoom(): void {
  apply(current);
}

function commit(next: number): void {
  const z = clamp(next);
  current = z;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, String(z));
  }
  apply(z);
  listeners.forEach((l) => l());
}

export function zoomIn(): void {
  commit(current + ZOOM_STEP);
}

export function zoomOut(): void {
  commit(current - ZOOM_STEP);
}

export function resetZoom(): void {
  commit(ZOOM_DEFAULT);
}

export function setZoomFactor(z: number): void {
  commit(z);
}

export function getZoom(): number {
  return current;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useZoom() {
  const zoom = useSyncExternalStore(subscribe, getZoom, getZoom);
  return {
    zoom,
    percent: Math.round(zoom * 100),
    zoomIn,
    zoomOut,
    reset: resetZoom,
    setZoom: setZoomFactor,
    canZoomIn: zoom < ZOOM_MAX - EPS,
    canZoomOut: zoom > ZOOM_MIN + EPS,
    isDefault: Math.abs(zoom - ZOOM_DEFAULT) < EPS,
  };
}
