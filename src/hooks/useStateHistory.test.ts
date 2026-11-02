import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useStateHistory } from "./useStateHistory";

type Doc = { title: string; body: string };
const EMPTY: Doc = { title: "", body: "" };
const REAL: Doc = { title: "회의록", body: "본문 있음" };

describe("useStateHistory cacheKey transition", () => {
  // Regression: MeetingForm calls useStateHistory before TanStack data arrives.
  // First render: initial=EMPTY, cacheKey=undefined. Second render: initial=REAL,
  // cacheKey=id. The undefined→id transition must reset value to the real doc,
  // otherwise the form silently shows empty fields and a single keystroke writes
  // NULLs to DB.
  it("resets value when cacheKey transitions from undefined to a defined id", () => {
    const { result, rerender } = renderHook(
      ({ initial, cacheKey }: { initial: Doc; cacheKey: string | undefined }) =>
        useStateHistory<Doc>({ initial, cacheKey }),
      { initialProps: { initial: EMPTY, cacheKey: undefined as string | undefined } },
    );

    expect(result.current.value).toEqual(EMPTY);

    rerender({ initial: REAL, cacheKey: "meeting-undef-to-defined" });

    expect(result.current.value).toEqual(REAL);
  });

  it("does not reset when cacheKey identity is stable across re-renders", () => {
    const cacheKey = "meeting-stable";
    const { result, rerender } = renderHook(
      ({ initial }: { initial: Doc }) =>
        useStateHistory<Doc>({ initial, cacheKey }),
      { initialProps: { initial: REAL } },
    );

    act(() => {
      result.current.set({ title: "edited", body: "edited body" });
    });
    rerender({ initial: REAL });

    expect(result.current.value).toEqual({ title: "edited", body: "edited body" });
  });

  // The core P1 fix: switching cacheKey A → B → A must restore A's state
  // (value + history), so undo/redo on a previously edited memo still works
  // after navigating away and back.
  it("restores prior state when returning to a previously seen cacheKey", () => {
    const KEY_A = "memo-A-roundtrip";
    const KEY_B = "memo-B-roundtrip";
    const EDITED_A: Doc = { title: "A edited", body: "A body" };

    const { result, rerender } = renderHook(
      ({ cacheKey, initial }: { cacheKey: string; initial: Doc }) =>
        useStateHistory<Doc>({ cacheKey, initial }),
      { initialProps: { cacheKey: KEY_A, initial: REAL } },
    );

    // Edit on A — commits via internal timer; force it via flush.
    act(() => {
      result.current.set(EDITED_A);
      result.current.flush();
    });
    expect(result.current.value).toEqual(EDITED_A);
    expect(result.current.canUndo).toBe(true);

    // Switch to B with a different initial. State should reset to B's initial.
    rerender({ cacheKey: KEY_B, initial: EMPTY });
    expect(result.current.value).toEqual(EMPTY);
    expect(result.current.canUndo).toBe(false);

    // Return to A — should restore EDITED_A and its undo history.
    rerender({ cacheKey: KEY_A, initial: REAL });
    expect(result.current.value).toEqual(EDITED_A);
    expect(result.current.canUndo).toBe(true);
  });
});

describe("useStateHistory LRU eviction", () => {
  // Memory guard: the module cache used to grow unbounded — every opened memo's
  // full-document undo stack stayed resident forever. With an LRU cap, a memo
  // not touched for many switches gets evicted and falls back to `initial`.
  it("evicts the least-recently-used key once many keys are opened", () => {
    const EDITED: Doc = { title: "오래된 메모", body: "편집됨" };
    const KEY = (i: number) => `lru-${i}`;

    const { result, rerender } = renderHook(
      ({ cacheKey, initial }: { cacheKey: string; initial: Doc }) =>
        useStateHistory<Doc>({ cacheKey, initial }),
      { initialProps: { cacheKey: KEY(0), initial: REAL } },
    );

    // Edit the first memo, then open 19 more (each switch saves the outgoing to
    // cache). 20 distinct keys » the cap → the very first must be evicted.
    act(() => {
      result.current.set(EDITED);
      result.current.flush();
    });
    for (let i = 1; i < 20; i++) {
      rerender({ cacheKey: KEY(i), initial: EMPTY });
    }

    // Return to the long-untouched first memo: evicted → shows `initial`, no undo.
    rerender({ cacheKey: KEY(0), initial: REAL });
    expect(result.current.value).toEqual(REAL);
    expect(result.current.canUndo).toBe(false);
  });

  it("keeps recently-used keys restorable", () => {
    const RECENT: Doc = { title: "최근", body: "방금 편집" };
    const KEY = (i: number) => `lru-recent-${i}`;

    const { result, rerender } = renderHook(
      ({ cacheKey, initial }: { cacheKey: string; initial: Doc }) =>
        useStateHistory<Doc>({ cacheKey, initial }),
      { initialProps: { cacheKey: KEY(0), initial: EMPTY } },
    );

    // Open a few, edit the last one, switch away once, then return to it.
    for (let i = 1; i < 5; i++) {
      rerender({ cacheKey: KEY(i), initial: EMPTY });
    }
    act(() => {
      result.current.set(RECENT);
      result.current.flush();
    });
    rerender({ cacheKey: KEY(99), initial: EMPTY });
    rerender({ cacheKey: KEY(4), initial: EMPTY });
    expect(result.current.value).toEqual(RECENT);
    expect(result.current.canUndo).toBe(true);
  });
});

describe("useStateHistory reset", () => {
  // D5: 외부 변경(녹음 link 등) 뒤 디스크 값으로 다시 시작 — Cmd+Z 가 경계를 못 넘는다.
  it("reset discards undo/redo so undo cannot cross the reset boundary", () => {
    const FRESH: Doc = { title: "회의록", body: "디스크에서 새로 읽음" };
    const { result, rerender } = renderHook(
      ({ cacheKey }: { cacheKey: string }) =>
        useStateHistory<Doc>({ cacheKey, initial: REAL }),
      { initialProps: { cacheKey: "reset-boundary" } },
    );
    act(() => {
      result.current.set({ title: "회의록", body: "편집 1" });
      result.current.flush();
    });
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.reset(FRESH));
    expect(result.current.value).toEqual(FRESH);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    let t: unknown = "unset";
    act(() => {
      t = result.current.undo();
    });
    expect(t).toBeNull();
    expect(result.current.value).toEqual(FRESH);

    // 다른 key 로 갔다 와도 reset 이전 stack 이 되살아나지 않는다.
    rerender({ cacheKey: "reset-boundary-other" });
    rerender({ cacheKey: "reset-boundary" });
    expect(result.current.value).toEqual(FRESH);
    expect(result.current.canUndo).toBe(false);
  });

  it("reset becomes the commit baseline (onCommit prev = reset value)", () => {
    const FRESH: Doc = { title: "회의록", body: "fresh" };
    const commits: Array<{ next: Doc; prev: Doc }> = [];
    const { result } = renderHook(() =>
      useStateHistory<Doc>({
        cacheKey: "reset-baseline",
        initial: REAL,
        onCommit: (next, prev) => commits.push({ next, prev }),
      }),
    );
    act(() => result.current.reset(FRESH));
    act(() => {
      result.current.set({ title: "회의록", body: "fresh+1" });
      result.current.flush();
    });
    expect(commits).toEqual([
      { next: { title: "회의록", body: "fresh+1" }, prev: FRESH },
    ]);
  });

  it("onCommit prev tracks the last committed value across commits and undo", () => {
    const commits: Array<{ next: Doc; prev: Doc }> = [];
    const A: Doc = { title: "t", body: "a" };
    const B: Doc = { title: "t", body: "b" };
    const { result } = renderHook(() =>
      useStateHistory<Doc>({
        cacheKey: "commit-prev",
        initial: REAL,
        onCommit: (next, prev) => commits.push({ next, prev }),
      }),
    );
    act(() => {
      result.current.set(A);
      result.current.flush();
    });
    act(() => {
      result.current.set(B);
      result.current.flush();
    });
    act(() => {
      result.current.undo();
    });
    expect(commits).toEqual([
      { next: A, prev: REAL },
      { next: B, prev: A },
      { next: A, prev: B },
    ]);
  });
});
