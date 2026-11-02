// V0.7.1 race-fix 패턴: render 안에서 ref.current 갱신 + clearTimeout 이 의도된
// 동작. set+immediate flush 의 stale closure 문제 차단용. React Compiler 의
// `react-hooks/refs` 규칙은 일반적으로 옳지만 이 파일은 의도적 예외.
/* eslint-disable react-hooks/refs */
import { useCallback, useEffect, useRef, useState } from "react";

// committed = 마지막으로 onCommit 에 넘긴 값 (= 저장된 것으로 간주하는 baseline).
// onCommit(next, prevCommitted) 로 같이 넘겨 caller 가 "바뀐 칸만" 저장할 수 있게 한다.
type CachedState<T> = { value: T; history: T[]; pointer: number; committed: T };

// Module-level cache shared across all useStateHistory instances.
// Persists across component remounts so undo/redo survives navigation.
// cacheKey 는 영구 uid 기반 (`${uid}:doc` 등) — 같은 file path 를 다른 entity 가
// 차지해도 uid 다름 → cache 침범 없음.
const HISTORY_CACHE = new Map<string, CachedState<unknown>>();

// LRU 상한. 한 entry 는 메모 전체 스냅샷(본문+음성기록+요약) 을 최대 maxDepth 개
// 들고 있어 무겁다. 옛날엔 무한 증가(open 한 메모 수만큼 영구 잔류) — 큰 STT
// transcript 메모를 수십 개 돌아다닌 긴 세션에서 수십~수백 MB 까지 자랐다.
// 최근 사용 N개만 유지 (Map 삽입 순서 = recency, set 시 재삽입으로 갱신).
const MAX_HISTORY_KEYS = 12;
function cacheSet(key: string, state: CachedState<unknown>): void {
  HISTORY_CACHE.delete(key); // 재삽입으로 most-recently-used 위치로 이동
  HISTORY_CACHE.set(key, state);
  while (HISTORY_CACHE.size > MAX_HISTORY_KEYS) {
    const oldest = HISTORY_CACHE.keys().next().value;
    if (oldest === undefined) break;
    HISTORY_CACHE.delete(oldest);
  }
}

/**
 * 마운트 안 된 history stack 을 버린다 — 다음 mount 는 `initial`(디스크 값)부터 시작.
 * 마운트된 인스턴스는 unmount 시 다시 cache 에 쓰므로 그쪽은 `reset()` 을 써야 한다.
 */
export function dropStateHistory(cacheKey: string): void {
  HISTORY_CACHE.delete(cacheKey);
}

export type UseStateHistoryOptions<T> = {
  /** Initial value. Used on first mount and on cache miss. */
  initial: T;
  /**
   * Stable identity for this history stack. When it changes:
   *  - The outgoing key's state is saved to a module-level cache.
   *  - The incoming key's state is restored from cache (or `initial`).
   *  - Any pending debounced commit is flushed via `onCommit` using the
   *    callback that was active at transition time (so saves go to the
   *    correct outgoing entity).
   * Pass `undefined` to disable cache participation.
   */
  cacheKey?: string;
  onChange?: (next: T) => void;
  /**
   * debounce/flush/undo/redo 로 값이 확정될 때 호출. `prevCommitted` = 직전에
   * commit 된 값 (첫 commit 이면 initial/cache 에서 복원된 값) — 바뀐 부분만 저장용.
   */
  onCommit?: (next: T, prevCommitted: T) => void;
  commitMs?: number;
  maxDepth?: number;
  isEqual?: (a: T, b: T) => boolean;
};

export type HistoryTransition<T> = { from: T; to: T };

export type UseStateHistoryResult<T> = {
  value: T;
  set: (next: T) => void;
  /** Returns from/to for routing decisions (e.g. tab switch). null when at boundary. */
  undo: () => HistoryTransition<T> | null;
  redo: () => HistoryTransition<T> | null;
  /** Force commit any pending edit immediately. */
  flush: () => void;
  /**
   * 외부 변경(디스크) 반영용 — undo/redo stack 과 이 cacheKey 의 cache 를 버리고
   * `next` 하나로 다시 시작한다. Cmd+Z 는 이 경계 너머로 가지 않는다. pending
   * (debounce 중) 편집은 commit 없이 버려지므로 caller 는 외부 작업 전에 `flush()`
   * 하고, 작업 후의 디스크 값을 넘길 것. onCommit 은 부르지 않는다.
   */
  reset: (next: T) => void;
  canUndo: boolean;
  canRedo: boolean;
};

function defaultEq<T>(a: T, b: T): boolean {
  return a === b;
}

export function useStateHistory<T>(
  opts: UseStateHistoryOptions<T>,
): UseStateHistoryResult<T> {
  const {
    initial,
    cacheKey,
    onChange,
    onCommit,
    commitMs = 800,
    maxDepth = 100,
    isEqual = defaultEq,
  } = opts;

  // Initial state — restore from cache if available, else use `initial`.
  const initialState = (() => {
    if (cacheKey !== undefined) {
      const cached = HISTORY_CACHE.get(cacheKey) as
        | CachedState<T>
        | undefined;
      if (cached) return cached;
    }
    return { value: initial, history: [initial], pointer: 0, committed: initial };
  });
  const [boot] = useState(initialState);
  const [value, setValue] = useState<T>(boot.value);
  const [history, setHistory] = useState<T[]>(boot.history);
  const [pointer, setPointer] = useState(boot.pointer);
  // 마지막 commit 값. state 가 아니라 ref — 렌더와 무관한 저장 baseline.
  const committedRef = useRef<T>(boot.committed);

  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const isEqualRef = useRef(isEqual);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);
  useEffect(() => {
    isEqualRef.current = isEqual;
  }, [isEqual]);

  // Latest snapshots for unmount cleanup (closure-safe).
  const valueRef = useRef(value);
  const historyRef = useRef(history);
  const pointerRef = useRef(pointer);
  const cacheKeyRef = useRef(cacheKey);
  valueRef.current = value;
  historyRef.current = history;
  pointerRef.current = pointer;
  cacheKeyRef.current = cacheKey;

  const commitTimerRef = useRef<number | null>(null);
  const pendingTransitionFlushRef = useRef<
    {
      value: T;
      prev: T;
      onCommit: ((v: T, prev: T) => void) | undefined;
    } | null
  >(null);

  // 모든 commit 의 단일 경로 — committed baseline 갱신 + onCommit(next, prev).
  const commit = useCallback((v: T) => {
    const prev = committedRef.current;
    committedRef.current = v;
    onCommitRef.current?.(v, prev);
  }, []);

  // cacheKey transition: save outgoing, restore incoming (state-based).
  const [trackedKey, setTrackedKey] = useState(cacheKey);
  if (trackedKey !== cacheKey) {
    const pendingTimer = commitTimerRef.current;
    // 1) Save outgoing state. pending 은 아래 2) 에서 commit 되므로 committed = value.
    if (trackedKey !== undefined) {
      cacheSet(trackedKey, {
        value,
        history,
        pointer,
        committed: pendingTimer != null ? value : committedRef.current,
      });
    }
    // 2) Defer pending commit to effect (so outgoing onCommit fires).
    if (pendingTimer != null) {
      window.clearTimeout(pendingTimer);
      commitTimerRef.current = null;
      pendingTransitionFlushRef.current = {
        value,
        prev: committedRef.current,
        // onCommitRef still holds the previous render's callback —
        // the ref-update effect has not fired yet for this render.
        onCommit: onCommitRef.current,
      };
    }
    // 3) Restore incoming state.
    const cached =
      cacheKey !== undefined
        ? (HISTORY_CACHE.get(cacheKey) as CachedState<T> | undefined)
        : undefined;
    if (cached) {
      setValue(cached.value);
      setHistory(cached.history);
      setPointer(cached.pointer);
      committedRef.current = cached.committed;
    } else {
      setValue(initial);
      setHistory([initial]);
      setPointer(0);
      committedRef.current = initial;
    }
    setTrackedKey(cacheKey);
  }

  // Fire deferred transition flush.
  useEffect(() => {
    if (pendingTransitionFlushRef.current) {
      const { value: v, prev, onCommit: cb } = pendingTransitionFlushRef.current;
      pendingTransitionFlushRef.current = null;
      cb?.(v, prev);
    }
  }, [trackedKey]);

  // Unmount: persist final state + fire pending commit.
  useEffect(() => {
    return () => {
      const ck = cacheKeyRef.current;
      const pendingTimer = commitTimerRef.current;
      if (ck !== undefined) {
        cacheSet(ck, {
          value: valueRef.current,
          history: historyRef.current,
          pointer: pointerRef.current,
          committed: pendingTimer != null ? valueRef.current : committedRef.current,
        });
      }
      if (pendingTimer != null) {
        window.clearTimeout(pendingTimer);
        commitTimerRef.current = null;
        const prev = committedRef.current;
        committedRef.current = valueRef.current;
        onCommitRef.current?.(valueRef.current, prev);
      }
    };
  }, []);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      // valueRef 를 동기로 갱신 — 같은 turn 의 flush() 가 latest value 를 보도록.
      // setValue 는 비동기라 useCallback closure 의 value 만 봤다간 stale.
      valueRef.current = next;
      onChangeRef.current?.(next);
      if (commitTimerRef.current != null) {
        window.clearTimeout(commitTimerRef.current);
      }
      commitTimerRef.current = window.setTimeout(() => {
        commitTimerRef.current = null;
        setHistory((prev) => {
          const eq = isEqualRef.current;
          const truncated = prev.slice(0, pointer + 1);
          if (
            truncated.length > 0 &&
            eq(truncated[truncated.length - 1], next)
          ) {
            return prev;
          }
          const appended = [...truncated, next];
          const overflow = Math.max(0, appended.length - maxDepth);
          const trimmed = overflow > 0 ? appended.slice(overflow) : appended;
          setPointer(trimmed.length - 1);
          return trimmed;
        });
        commit(next);
      }, commitMs);
    },
    [commitMs, pointer, maxDepth, commit],
  );

  const undo = useCallback((): HistoryTransition<T> | null => {
    let workingHistory = history;
    let workingPointer = pointer;
    const eq = isEqualRef.current;
    if (commitTimerRef.current != null && !eq(history[pointer], value)) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
      const truncated = history.slice(0, pointer + 1);
      const appended = [...truncated, value];
      const overflow = Math.max(0, appended.length - maxDepth);
      workingHistory = overflow > 0 ? appended.slice(overflow) : appended;
      workingPointer = workingHistory.length - 1;
    }
    if (workingPointer <= 0) {
      if (workingHistory !== history) {
        setHistory(workingHistory);
        setPointer(workingHistory.length - 1);
      }
      return null;
    }
    const newPointer = workingPointer - 1;
    const newValue = workingHistory[newPointer];
    setHistory(workingHistory);
    setPointer(newPointer);
    setValue(newValue);
    valueRef.current = newValue;
    onChangeRef.current?.(newValue);
    commit(newValue);
    return { from: value, to: newValue };
  }, [history, pointer, value, maxDepth, commit]);

  const redo = useCallback((): HistoryTransition<T> | null => {
    if (pointer >= history.length - 1) return null;
    const newPointer = pointer + 1;
    const newValue = history[newPointer];
    setPointer(newPointer);
    setValue(newValue);
    valueRef.current = newValue;
    onChangeRef.current?.(newValue);
    commit(newValue);
    return { from: value, to: newValue };
  }, [history, pointer, value, commit]);

  const flush = useCallback(() => {
    if (commitTimerRef.current == null) return;
    const eq = isEqualRef.current;
    // 같은 turn 에 set(next) → flush() 호출 시 useCallback closure 의 value 는
    // setValue 비동기라 stale. valueRef 가 set 안에서 동기로 갱신되니 그걸 사용.
    const v = valueRef.current;
    window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
    setHistory((prev) => {
      const truncated = prev.slice(0, pointer + 1);
      if (
        truncated.length > 0 &&
        eq(truncated[truncated.length - 1], v)
      ) {
        return prev;
      }
      const appended = [...truncated, v];
      const overflow = Math.max(0, appended.length - maxDepth);
      const trimmed = overflow > 0 ? appended.slice(overflow) : appended;
      setPointer(trimmed.length - 1);
      return trimmed;
    });
    commit(v);
  }, [pointer, maxDepth, commit]);

  const reset = useCallback((next: T) => {
    // pending 편집은 버린다 (주석: UseStateHistoryResult.reset).
    if (commitTimerRef.current != null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const ck = cacheKeyRef.current;
    if (ck !== undefined) HISTORY_CACHE.delete(ck);
    setValue(next);
    setHistory([next]);
    setPointer(0);
    // 같은 turn 의 flush/unmount 가 옛 값을 보지 않도록 ref 동기 갱신.
    valueRef.current = next;
    historyRef.current = [next];
    pointerRef.current = 0;
    committedRef.current = next;
  }, []);

  const hasPendingEdit = !isEqual(history[pointer], value);

  return {
    value,
    set,
    undo,
    redo,
    flush,
    reset,
    canUndo: pointer > 0 || hasPendingEdit,
    canRedo: pointer < history.length - 1,
  };
}
