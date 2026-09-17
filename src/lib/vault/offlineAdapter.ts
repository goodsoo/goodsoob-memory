/**
 * createOfflineAdapter (T5) — http 어댑터를 감싼 capture-first 오프라인 어댑터.
 *
 * 동작:
 *  - 읽기(list/read/meta/exists/watch): http 어댑터에 그대로 위임(온라인 전용, T6 이 캐시 추가).
 *  - 쓰기(write/delete/rename/mkdir): http 어댑터로 먼저 시도 → fetch 가 FAIL(오프라인/서버다운)
 *    하면 op 를 outbox 에 append 하고 낙관적으로 resolve. 절대 throw 로 사용자 입력을 버리지 않음.
 *  - flush: window "online" + visibilitychange→visible(iOS Background Sync 없음) 에서
 *    outbox 를 seq 순(FIFO)으로 drain. 각 op POST 성공 시에만 삭제, 실패 시 그 자리서 멈춤
 *    (뒤 op 를 건너뛰지 않음 = 순서·부분실패 안전).
 *  - durability: navigator.storage.persist() 요청(guarded)으로 iOS eviction 저항.
 *
 * 브라우저/http 경로 전용. Tauri 는 이 어댑터를 안 탄다(selectAdapter 가 분기).
 */

import type { VaultAdapter, VaultWatchEvent, FileMeta } from "./adapter";
import {
  enqueueOp,
  listOps,
  deleteOp,
  type OutboxOp,
} from "./outbox";

export interface OfflineAdapterOptions {
  /** 감쌀 대상(보통 createHttpAdapter()). 테스트에선 memory adapter 주입 가능. */
  inner: VaultAdapter;
  /** flush 트리거 자동 등록 여부(기본 true). 테스트에선 false 로 두고 수동 flush. */
  installTriggers?: boolean;
}

/** fetch 실패(오프라인/서버다운)인지 판별. HttpError(4xx/5xx)는 서버가 응답한 것이라
 *  outbox 로 보내지 않는다 — 진짜 네트워크/연결 실패만 큐잉한다. */
function isNetworkFailure(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }
  const err = e as { name?: string; status?: number; message?: string };
  // httpAdapter 의 HttpError 는 status 를 갖는다(서버 응답) → 네트워크 실패 아님.
  if (typeof err?.status === "number") return false;
  const msg = err?.message ?? "";
  // httpAdapter.request 는 연결/타임아웃 실패를 "vault 서버 연결 실패"/"타임아웃"으로 래핑.
  return (
    err?.name === "AbortError" ||
    err?.name === "TypeError" || // fetch 네트워크 실패의 표준 name
    msg.includes("연결 실패") ||
    msg.includes("타임아웃") ||
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError")
  );
}

/** outbox 를 seq 순으로 drain. 성공한 op 만 삭제, 실패 시 멈춤(순서 보존). */
export async function flushOutbox(inner: VaultAdapter): Promise<{
  flushed: number;
  remaining: number;
  stoppedOn?: unknown;
}> {
  const ops = await listOps();
  let flushed = 0;
  for (const rec of ops) {
    try {
      await applyOp(inner, rec.op);
    } catch (e) {
      // 부분 실패: 여기서 멈춤. 뒤 op 를 건너뛰면 순서가 깨진다.
      return { flushed, remaining: ops.length - flushed, stoppedOn: e };
    }
    if (rec.id !== undefined) await deleteOp(rec.id);
    flushed += 1;
  }
  return { flushed, remaining: 0 };
}

/** op 를 inner 어댑터의 mutation 으로 replay. */
async function applyOp(inner: VaultAdapter, op: OutboxOp): Promise<void> {
  switch (op.type) {
    case "write":
      await inner.write(op.path, op.content);
      return;
    case "delete":
      await inner.delete(op.path, { recursive: op.recursive });
      return;
    case "rename":
      await inner.rename(op.from, op.to);
      return;
    case "mkdir":
      await inner.mkdir(op.path);
      return;
  }
}

/** iOS eviction 저항 — persistent storage 요청(guarded, best-effort). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.storage &&
      typeof navigator.storage.persist === "function"
    ) {
      // 이미 persisted 면 재요청 안 함.
      if (typeof navigator.storage.persisted === "function") {
        const already = await navigator.storage.persisted();
        if (already) return true;
      }
      return await navigator.storage.persist();
    }
  } catch {
    /* persist 미지원/거부 — 미sync 표시가 안전망 */
  }
  return false;
}

export function createOfflineAdapter(
  opts: OfflineAdapterOptions,
): VaultAdapter & { flush(): Promise<void> } {
  const inner = opts.inner;
  const installTriggers = opts.installTriggers ?? true;

  let flushing = false;
  async function flush(): Promise<void> {
    if (flushing) return; // 동시 flush 방지(순서 보존)
    flushing = true;
    try {
      await flushOutbox(inner);
    } catch {
      /* flush 실패는 다음 트리거에서 재시도 */
    } finally {
      flushing = false;
    }
  }

  if (installTriggers && typeof window !== "undefined") {
    window.addEventListener("online", () => void flush());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void flush();
    });
    // 부트 시 durability 확보 + 남아있던 미sync op flush 시도.
    void requestPersistence();
    void flush();
  }

  return {
    setRoot(absPath: string) {
      inner.setRoot(absPath);
    },
    getRoot() {
      return inner.getRoot();
    },

    // ── 읽기: 온라인 전용 위임(T6 이 캐시 추가) ──
    list: (subdir) => inner.list(subdir),
    listRecursive: (subdir) => inner.listRecursive(subdir),
    listFoldersRecursive: (subdir) => inner.listFoldersRecursive(subdir),
    read: (relPath) => inner.read(relPath),
    readMeta: (relPath) => inner.readMeta(relPath),
    exists: (relPath) => inner.exists(relPath),
    watch: (cb: (e: VaultWatchEvent) => void) => inner.watch(cb),

    // ── 쓰기: 실패 시 outbox 로 낙관 큐잉 ──
    async write(
      relPath: string,
      content: string,
      expectedMtime?: number,
    ): Promise<FileMeta> {
      try {
        return await inner.write(relPath, content, expectedMtime);
      } catch (e) {
        if (isNetworkFailure(e)) {
          await enqueueOp({ type: "write", path: relPath, content });
          // 낙관 응답 — mtime = 로컬 큐잉 시각(design: offline mtime = IndexedDB 쓰기 시각).
          return { mtime: Date.now(), size: content.length };
        }
        throw e;
      }
    },

    async writeBinary(relPath: string, bytes: Uint8Array): Promise<FileMeta> {
      // 바이너리(스크린샷 등)는 outbox 미지원 — content 를 큐에 담기 부적합(용량·eviction).
      // capture-first 핵심은 텍스트 메모라 바이너리는 온라인 전용(실패 시 throw).
      return inner.writeBinary(relPath, bytes);
    },

    async delete(
      relPath: string,
      options?: { recursive?: boolean },
    ): Promise<void> {
      try {
        await inner.delete(relPath, options);
      } catch (e) {
        if (isNetworkFailure(e)) {
          await enqueueOp({
            type: "delete",
            path: relPath,
            recursive: options?.recursive === true,
          });
          return;
        }
        throw e;
      }
    },

    async rename(fromRel: string, toRel: string): Promise<void> {
      try {
        await inner.rename(fromRel, toRel);
      } catch (e) {
        if (isNetworkFailure(e)) {
          await enqueueOp({ type: "rename", from: fromRel, to: toRel });
          return;
        }
        throw e;
      }
    },

    async mkdir(relPath: string): Promise<void> {
      try {
        await inner.mkdir(relPath);
      } catch (e) {
        if (isNetworkFailure(e)) {
          await enqueueOp({ type: "mkdir", path: relPath });
          return;
        }
        throw e;
      }
    },

    flush,
  };
}
