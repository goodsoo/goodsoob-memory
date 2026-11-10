import { describe, expect, it } from "vitest";
import {
  RECORDING_SHORTCUTS,
  resolveShortcut,
  shortcutContextFor,
  type ShortcutContext,
  type ShortcutEvent,
} from "./shortcuts";

const OUT: ShortcutContext = { inTextInput: false, inOverlay: false };
const IN: ShortcutContext = { inTextInput: true, inOverlay: false };

function ev(code: string, over: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return { code, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, isComposing: false, ...over };
}

describe("resolveShortcut", () => {
  it("입력칸 밖 Space = toggle", () => {
    expect(resolveShortcut(ev("Space"), OUT)).toBe("toggle");
  });
  it("textarea 안 Space = null", () => {
    expect(resolveShortcut(ev("Space"), IN)).toBeNull();
  });
  it("textarea 안 ⌥K = toggle, ⌥J/⌥L 도 동작", () => {
    expect(resolveShortcut(ev("KeyK", { altKey: true }), IN)).toBe("toggle");
    expect(resolveShortcut(ev("KeyJ", { altKey: true }), IN)).toBe("back");
    expect(resolveShortcut(ev("KeyL", { altKey: true }), IN)).toBe("forward");
  });
  it("e.key 가 ˚ 이거나 자모여도 code 로 toggle", () => {
    expect(resolveShortcut(ev("KeyK", { altKey: true, key: "˚" }), IN)).toBe("toggle");
    expect(resolveShortcut(ev("KeyK", { altKey: true, key: "ㅏ" }), OUT)).toBe("toggle");
  });
  it("⌥K 는 조합 중에도 동작", () => {
    expect(resolveShortcut(ev("KeyK", { altKey: true, isComposing: true }), IN)).toBe("toggle");
  });
  it("조합 중 Space = null", () => {
    expect(resolveShortcut(ev("Space", { isComposing: true }), OUT)).toBeNull();
  });
  it("⌘1 = null", () => {
    expect(resolveShortcut(ev("Digit1", { metaKey: true }), OUT)).toBeNull();
  });
  it("meta/ctrl 이 눌린 꾸밈 없는 키는 무시", () => {
    expect(resolveShortcut(ev("Space", { ctrlKey: true }), OUT)).toBeNull();
    expect(resolveShortcut(ev("ArrowLeft", { metaKey: true }), OUT)).toBeNull();
  });
  it("⇧Slash = help", () => {
    expect(resolveShortcut(ev("Slash", { shiftKey: true }), OUT)).toBe("help");
    expect(resolveShortcut(ev("Slash", { shiftKey: true }), IN)).toBeNull();
  });
  it("overlay 안 Space = null", () => {
    expect(resolveShortcut(ev("Space"), { inTextInput: false, inOverlay: true })).toBeNull();
  });
  it("화살표", () => {
    expect(resolveShortcut(ev("ArrowLeft"), OUT)).toBe("back");
    expect(resolveShortcut(ev("ArrowRight"), OUT)).toBe("forward");
    expect(resolveShortcut(ev("ArrowUp"), OUT)).toBe("prevTurn");
    expect(resolveShortcut(ev("ArrowDown"), OUT)).toBe("nextTurn");
    expect(resolveShortcut(ev("ArrowLeft"), IN)).toBeNull();
  });
  it("배속과 고칠 곳", () => {
    expect(resolveShortcut(ev("Comma", { shiftKey: true }), OUT)).toBe("rateDown");
    expect(resolveShortcut(ev("Period", { shiftKey: true }), OUT)).toBe("rateUp");
    expect(resolveShortcut(ev("KeyN"), OUT)).toBe("nextReview");
    expect(resolveShortcut(ev("KeyN", { shiftKey: true }), OUT)).toBe("prevReview");
    expect(resolveShortcut(ev("KeyN"), IN)).toBeNull();
  });
  it("⌘F 는 입력칸 안에서도", () => {
    expect(resolveShortcut(ev("KeyF", { metaKey: true }), IN)).toBe("find");
    expect(resolveShortcut(ev("KeyF", { ctrlKey: true }), OUT)).toBe("find");
  });
  it("⌘Z / ⌘⇧Z 는 입력칸 밖에서만", () => {
    expect(resolveShortcut(ev("KeyZ", { metaKey: true }), OUT)).toBe("undo");
    expect(resolveShortcut(ev("KeyZ", { metaKey: true, shiftKey: true }), OUT)).toBe("redo");
    expect(resolveShortcut(ev("KeyZ", { metaKey: true }), IN)).toBeNull();
  });
  it("그 밖의 ⌥ 조합은 null", () => {
    expect(resolveShortcut(ev("Tab", { altKey: true }), IN)).toBeNull();
    expect(resolveShortcut(ev("ArrowUp", { altKey: true }), OUT)).toBeNull();
  });
});

describe("shortcutContextFor", () => {
  it("textarea·dialog 안을 구분", () => {
    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog");
    const btn = document.createElement("button");
    dlg.appendChild(btn);
    const ta = document.createElement("textarea");
    document.body.append(dlg, ta);
    expect(shortcutContextFor(btn)).toEqual({ inTextInput: false, inOverlay: true });
    expect(shortcutContextFor(ta)).toEqual({ inTextInput: true, inOverlay: false });
    expect(shortcutContextFor(null)).toEqual({ inTextInput: false, inOverlay: false });
    dlg.remove();
    ta.remove();
  });
});

describe("RECORDING_SHORTCUTS", () => {
  it("라벨+키 조합이 겹치지 않는다", () => {
    const ids = RECORDING_SHORTCUTS.map((s) => `${s.label}|${s.keys.join("")}`);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
