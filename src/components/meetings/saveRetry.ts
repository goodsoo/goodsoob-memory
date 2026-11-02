import type { MeetingUpdate } from "../../api/meetings";
import { fieldsPatch, patchFields, type DocField, type DocSnapshot } from "./docPatch";

// 메모별 "디스크에 아직 못 들어간 칸" 저장소 (D5 후속).
//
// 바뀐 칸만 저장(diffDocPatch)하는 모델에선 실패한 칸이 다음 diff 에서 빠지므로 여기
// 남겨 다음 저장·재시도에 강제로 포함한다. 그리고 **에러 표시의 진실 source** —
// useMutation 의 isError 는 마지막 call 만 반영해서 M1 실패 → M2 성공이면 꺼지고,
// unmount/remount 로 mutation 인스턴스가 바뀌어도 꺼진다. 모듈 레벨 + subscribe 로
// remount 후에도 같은 상태를 보여준다.

export type RetryEntry = {
  fields: ReadonlySet<DocField>;
  error: unknown;
  /** 사용자가 배너를 닫음 — 다음 실패 시 다시 false. indicator 는 계속 빨강. */
  dismissed: boolean;
  /** 진행 중 send 수 (mutation 은 메모 scope 로 직렬화). */
  inflight: number;
};

const EMPTY: RetryEntry = { fields: new Set(), error: null, dismissed: false, inflight: 0 };

export function createSaveRetryStore() {
  const entries = new Map<string, RetryEntry>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const put = (uid: string, e: RetryEntry) => {
    entries.set(uid, e);
    emit();
  };

  return {
    /** 불변 snapshot (useSyncExternalStore 용 — 변경 시에만 새 객체). */
    get(uid: string): RetryEntry {
      return entries.get(uid) ?? EMPTY;
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    begin(uid: string) {
      const e = this.get(uid);
      put(uid, { ...e, inflight: e.inflight + 1 });
    },
    fail(uid: string, sent: DocField[], error: unknown) {
      const e = this.get(uid);
      const fields = new Set(e.fields);
      for (const f of sent) fields.add(f);
      put(uid, { fields, error, dismissed: false, inflight: Math.max(0, e.inflight - 1) });
    },
    /**
     * 성공 — 보낸 칸은 디스크에 최신값이 들어갔으니 제거. 남은 칸(앞선 실패분)이 있고
     * 더 이상 진행 중 send 가 없으면 복구 대상으로 반환.
     */
    succeed(uid: string, sent: DocField[]): DocField[] {
      const e = this.get(uid);
      const fields = new Set(e.fields);
      for (const f of sent) fields.delete(f);
      const inflight = Math.max(0, e.inflight - 1);
      put(uid, { ...e, fields, error: fields.size ? e.error : null, inflight });
      return inflight === 0 ? [...fields] : [];
    },
    /** 외부 reset (디스크 fresh 로 doc 재시작) — 실패 칸 폐기. inflight 는 유지. */
    clear(uid: string) {
      const e = this.get(uid);
      put(uid, { ...EMPTY, inflight: e.inflight });
    },
    dismiss(uid: string) {
      const e = this.get(uid);
      if (e.fields.size) put(uid, { ...e, dismissed: true });
    },
  };
}

export type SaveRetryStore = ReturnType<typeof createSaveRetryStore>;

/** 에러 indicator: 실패 칸이 남아 있고 지금 보내는 중이 아님. */
export function isSaveErrorVisible(e: RetryEntry): boolean {
  return e.fields.size > 0 && e.inflight === 0;
}

/**
 * patch 1건 저장. 실패 → 칸을 store 에 남김. 성공 → 보낸 칸 제거 + 앞선 실패로 남은
 * 칸이 있으면 **현재 committed doc 값**으로 1회 복구 send (실패 시 거기서 멈춤 —
 * 다음 사용자 저장/재시도 버튼까지 대기, 무한 루프 없음).
 */
export async function runSave(
  store: SaveRetryStore,
  uid: string,
  patch: MeetingUpdate,
  send: (patch: MeetingUpdate) => Promise<unknown>,
  currentDoc: () => DocSnapshot | undefined,
): Promise<void> {
  const fields = patchFields(patch);
  if (fields.length === 0 && patch.title === undefined) return;
  store.begin(uid);
  try {
    await send(patch);
  } catch (err) {
    store.fail(uid, fields, err);
    return;
  }
  const remaining = store.succeed(uid, fields);
  if (remaining.length === 0) return;
  const doc = currentDoc();
  if (!doc) return;
  await runSave(store, uid, fieldsPatch(doc, remaining), send, currentDoc);
}
