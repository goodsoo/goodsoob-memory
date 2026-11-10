import { describe, expect, it } from "vitest";
import { emptyHistory, HISTORY_LIMIT, push, redo, undo } from "./textHistory";

describe("textHistory", () => {
  it("push 후 undo/redo 왕복", () => {
    let h = push(emptyHistory(), "a");
    h = push(h, "b");
    const u = undo(h, "c")!;
    expect(u.text).toBe("b");
    const u2 = undo(u.history, u.text)!;
    expect(u2.text).toBe("a");
    expect(undo(u2.history, u2.text)).toBeNull();
    const r = redo(u2.history, u2.text)!;
    expect(r.text).toBe("b");
    const r2 = redo(r.history, r.text)!;
    expect(r2.text).toBe("c");
    expect(redo(r2.history, r2.text)).toBeNull();
  });
  it("새 push 는 redo 를 비운다", () => {
    const h = push(emptyHistory(), "a");
    const u = undo(h, "b")!;
    expect(u.history.future).toEqual(["b"]);
    expect(push(u.history, "x").future).toEqual([]);
  });
  it("직전과 같은 값은 쌓지 않는다", () => {
    const h = push(push(emptyHistory(), "a"), "a");
    expect(h.past).toEqual(["a"]);
  });
  it("상한 100", () => {
    let h = emptyHistory();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = push(h, String(i));
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe("20");
  });
  it("빈 스택은 null", () => {
    expect(undo(emptyHistory(), "x")).toBeNull();
    expect(redo(emptyHistory(), "x")).toBeNull();
  });
});
