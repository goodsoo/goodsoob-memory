import { useEffect, useState } from "react";

export type BodyViewMode = "edit" | "view";

const KEY = "goodsoob:bodyViewMode";

function readKey(key: string): BodyViewMode {
  if (typeof localStorage === "undefined") return "edit";
  const v = localStorage.getItem(key);
  return v === "view" ? "view" : "edit";
}

/**
 * 전역 viewMode 를 localStorage 에 직접 기록. 새 메모 생성처럼 MeetingForm
 * mount "전에" 초기값을 정해야 하는 경우용 — mount 후 setState 는 useViewMode 의
 * key 초기화 effect 와 race 라 안 먹는다. 다음 mount 의 useState 초기값으로 반영됨.
 */
export function setStoredViewMode(mode: BodyViewMode): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, mode);
}

export function useViewMode() {
  const key = KEY;
  const [mode, setMode] = useState<BodyViewMode>(() => readKey(key));
  useEffect(() => {
    setMode(readKey(key));
  }, [key]);
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, mode);
  }, [key, mode]);
  return [mode, setMode] as const;
}
