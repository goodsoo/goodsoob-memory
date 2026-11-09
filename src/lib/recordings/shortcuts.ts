// 녹음 탭 단축키 해석 — 순수 함수. 글자 키는 e.code 로만 판정한다(한글 자판에서 e.key 는 자모로 바뀜).

export type RecordingShortcutAction =
  | "toggle"
  | "back"
  | "forward"
  | "prevTurn"
  | "nextTurn"
  | "rateDown"
  | "rateUp"
  | "nextReview"
  | "prevReview"
  | "find"
  | "undo"
  | "redo"
  | "help";

/** KeyboardEvent 중 해석에 쓰는 필드만. */
export interface ShortcutEvent {
  code: string;
  key?: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  isComposing?: boolean;
}

export interface ShortcutContext {
  /** INPUT·TEXTAREA·SELECT·contentEditable 안. */
  inTextInput: boolean;
  /** role=dialog|menu|listbox 안 (열린 Modal, Popover, Dropdown). */
  inOverlay: boolean;
}

export function resolveShortcut(ev: ShortcutEvent, ctx: ShortcutContext): RecordingShortcutAction | null {
  const cmd = ev.metaKey || ev.ctrlKey;

  // ⌘F: 입력칸 안에서도.
  if (cmd && !ev.altKey && !ev.shiftKey && ev.code === "KeyF") return "find";

  // ⌥ 조합: 입력칸 안에서도, 조합 중에도 (⌥ 는 한글 조합에 들어가지 않음).
  if (ev.altKey && !cmd && !ev.shiftKey) {
    if (ev.code === "KeyK") return "toggle";
    if (ev.code === "KeyJ") return "back";
    if (ev.code === "KeyL") return "forward";
    return null;
  }

  if (ev.isComposing || ctx.inTextInput || ctx.inOverlay) return null;

  // ⌘Z / ⌘⇧Z
  if (cmd && !ev.altKey) {
    if (ev.code === "KeyZ") return ev.shiftKey ? "redo" : "undo";
    return null;
  }
  if (ev.altKey) return null;

  if (ev.shiftKey) {
    switch (ev.code) {
      case "Comma":
        return "rateDown";
      case "Period":
        return "rateUp";
      case "KeyN":
        return "prevReview";
      case "Slash":
        return "help";
      default:
        return null;
    }
  }

  switch (ev.code) {
    case "Space":
      return "toggle";
    case "ArrowLeft":
      return "back";
    case "ArrowRight":
      return "forward";
    case "ArrowUp":
      return "prevTurn";
    case "ArrowDown":
      return "nextTurn";
    case "KeyN":
      return "nextReview";
    default:
      return null;
  }
}

/** keydown 의 target 으로 ShortcutContext 를 만든다. */
export function shortcutContextFor(target: EventTarget | null): ShortcutContext {
  const el = target instanceof Element ? target : null;
  if (!el) return { inTextInput: false, inOverlay: false };
  const tag = el.tagName;
  const inTextInput =
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el instanceof HTMLElement && (el.isContentEditable === true || el.contentEditable === "true"));
  const inOverlay = el.closest('[role="dialog"],[role="menu"],[role="listbox"]') !== null;
  return { inTextInput, inOverlay };
}

export interface ShortcutHelpItem {
  keys: string[];
  label: string;
  note?: string;
}

export const RECORDING_SHORTCUTS: ShortcutHelpItem[] = [
  { keys: ["Space"], label: "재생 / 일시정지" },
  { keys: ["⌥", "K"], label: "재생 / 일시정지 (입력 중)", note: "고치는 중에도 동작" },
  { keys: ["←"], label: "5초 뒤로" },
  { keys: ["→"], label: "5초 앞으로" },
  { keys: ["⌥", "J"], label: "5초 뒤로 (입력 중)", note: "고치는 중에도 동작" },
  { keys: ["⌥", "L"], label: "5초 앞으로 (입력 중)", note: "고치는 중에도 동작" },
  { keys: ["↑"], label: "이전 문단", note: "1.5초 넘게 들었으면 현재 문단 처음" },
  { keys: ["↓"], label: "다음 문단" },
  { keys: ["⇧", ","], label: "배속 내리기" },
  { keys: ["⇧", "."], label: "배속 올리기" },
  { keys: ["N"], label: "다음 고칠 곳", note: "고칠 곳이 있을 때" },
  { keys: ["⇧", "N"], label: "이전 고칠 곳", note: "고칠 곳이 있을 때" },
  { keys: ["⌘", "F"], label: "본문 찾기", note: "입력 중에도 동작" },
  { keys: ["⌘", "Z"], label: "되돌리기", note: "문단을 고치는 중에는 브라우저 기본" },
  { keys: ["⌘", "⇧", "Z"], label: "다시 실행" },
  { keys: ["?"], label: "단축키 도움말" },
  { keys: ["Esc"], label: "고치기 취소 / 찾기 닫기" },
];
