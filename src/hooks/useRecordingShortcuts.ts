import { useEffect, useRef } from "react";
import {
  resolveShortcut,
  shortcutContextFor,
  type RecordingShortcutAction,
} from "../lib/recordings/shortcuts";

export type RecordingShortcutHandlers = Partial<Record<RecordingShortcutAction, () => void>>;

/**
 * 녹음 상세가 떠 있는 동안 window keydown 을 한 번만 등록한다.
 * 최신 핸들러는 ref 로 받는다(MeetingForm 패턴). 해당 action 의 핸들러가 없으면
 * preventDefault 도 하지 않아 브라우저 기본 동작이 그대로 간다.
 */
export function useRecordingShortcuts(handlers: RecordingShortcutHandlers): void {
  const ref = useRef<RecordingShortcutHandlers>(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const action = resolveShortcut(e, shortcutContextFor(e.target));
      if (!action) return;
      const fn = ref.current[action];
      if (!fn) return;
      e.preventDefault();
      fn();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
