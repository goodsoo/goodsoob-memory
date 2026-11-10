// 녹음 탭 작업 파일 되돌리기 스택 — 순수 모듈. 상한 100.
export const HISTORY_LIMIT = 100;

export interface TextHistory {
  past: string[];
  future: string[];
}

export const emptyHistory = (): TextHistory => ({ past: [], future: [] });

/** 고치기 직전의 text 를 쌓는다. 새로 고치면 redo 는 비운다. 같은 값이거나 직전과 같으면 무시. */
export function push(h: TextHistory, prev: string): TextHistory {
  if (h.past[h.past.length - 1] === prev) return { past: h.past, future: [] };
  const past = [...h.past, prev];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, future: [] };
}

/** 되돌리기. 비었으면 null. */
export function undo(h: TextHistory, cur: string): { history: TextHistory; text: string } | null {
  if (h.past.length === 0) return null;
  const text = h.past[h.past.length - 1];
  return { text, history: { past: h.past.slice(0, -1), future: [...h.future, cur] } };
}

/** 다시 하기. 비었으면 null. */
export function redo(h: TextHistory, cur: string): { history: TextHistory; text: string } | null {
  if (h.future.length === 0) return null;
  const text = h.future[h.future.length - 1];
  return { text, history: { past: [...h.past, cur], future: h.future.slice(0, -1) } };
}
