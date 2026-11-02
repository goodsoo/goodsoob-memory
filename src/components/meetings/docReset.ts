import type { Meeting } from "../../api/meetings";
import { dropStateHistory } from "../../hooks/useStateHistory";

// 외부 변경(녹음 link·unlink·apply 등 서버가 사이드카를 고친 경우) 후 메모 폼의
// doc history 를 디스크 값으로 다시 시작시키는 신호. MeetingForm 이 마운트돼 있으면
// 그 폼의 reset 을 부르고, 아니면 history cache 만 버려 다음 mount 가 디스크에서 시작.
// (D5, docs/designs/recording-tab.md — "열린 폼과의 충돌")

type ResetListener = (fresh: Meeting) => void;
const LISTENERS = new Map<string, ResetListener>();

export function docHistoryKey(uid: string): string {
  return `${uid}:doc`;
}

/** MeetingForm 전용 — 마운트된 폼의 reset 등록. 반환값 = 해제 함수. */
export function registerDocReset(uid: string, fn: ResetListener): () => void {
  LISTENERS.set(uid, fn);
  return () => {
    if (LISTENERS.get(uid) === fn) LISTENERS.delete(uid);
  };
}

/**
 * 서버가 메모 사이드카/frontmatter 를 바꾼 직후 호출 (`fresh` = 그 뒤 디스크에서 읽은
 * Meeting). undo stack 은 이 경계에서 끊긴다. 폼의 pending 편집은 버려지므로 외부 작업
 * 전에 폼을 flush 해 두는 건 호출 측 책임 (useStateHistory.reset 주석 참고).
 */
export function resetMeetingDoc(uid: string, fresh: Meeting): void {
  const fn = LISTENERS.get(uid);
  if (fn) fn(fresh);
  else dropStateHistory(docHistoryKey(uid));
}

// ── flush 신호 (녹음 link·unlink 전에 열린 폼의 debounce 중 편집을 먼저 저장 큐에) ──
//
// 순서 보장: 폼의 저장(useUpdateMeeting)과 녹음 link/unlink mutation 은 같은 TanStack
// scope(`VAULT_WRITE_SCOPE`, useMeetings.ts) 라 enqueue 순서대로 실행된다. 그래서 link 를
// mutate 하기 **직전에** flush 를 동기로 불러 pending 편집을 저장 mutation 으로 먼저
// enqueue 시키면 서버의 사이드카 수정이 항상 그 저장 뒤에 일어난다.
// 등록자가 없으면(폼이 안 열려 있음 — 탭 전환으로 unmount 되면 useStateHistory 가 unmount
// 시 이미 flush 해 저장이 큐에 있다) no-op.

type FlushListener = () => void;
const FLUSHERS = new Map<string, FlushListener>();

/** MeetingForm 전용 — 마운트된 폼의 동기 flush 등록 (예: `() => docHistory.flush()`). 반환값 = 해제 함수. */
export function registerDocFlush(uid: string, fn: FlushListener): () => void {
  FLUSHERS.set(uid, fn);
  return () => {
    if (FLUSHERS.get(uid) === fn) FLUSHERS.delete(uid);
  };
}

/** 열린 폼이 있으면 pending 편집을 동기로 commit(→ 저장 mutation enqueue). 없으면 no-op. */
export function flushMeetingDoc(uid: string): void {
  FLUSHERS.get(uid)?.();
}
