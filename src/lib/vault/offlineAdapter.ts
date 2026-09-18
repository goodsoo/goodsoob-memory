/**
 * createOfflineAdapter (T5 + T6) — http 어댑터를 감싼 capture-first 오프라인 어댑터.
 *
 * 동작:
 *  - 읽기(list/read): 온라인 성공 시 읽기 캐시(IndexedDB `readcache`)에 저장.
 *    오프라인(네트워크 실패) 시 캐시 HIT → 캐시 콘텐츠 반환, MISS → OfflineCacheMissError.
 *    단, pending outbox write op 가 있는 path 는 캐시에서 서빙하지 않는다
 *    (design doc "replica refresh vs dirty buffer" — pending 편집이 있는 노트에
 *    오래된 캐시를 덮지 않음. outbox 에 큐잉된 op 의 content 를 직접 반환하는 것보다
 *    OfflineCacheMissError 를 던지는 것이 더 안전 — stale 캐시를 silent 서빙하지 않음).
 *  - readMeta/exists/watch: 온라인 전용 위임(T6 범위 밖).
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
import {
  cacheRead,
  cacheList,
  getCachedRead,
  getCachedList,
  OfflineCacheMissError,
} from "./readCache";

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

    // ── 읽기: 캐시 통합(T6) ──
    async list(subdir: string): Promise<string[]> {
      try {
        const result = await inner.list(subdir);
        // 성공 시 캐시 갱신(subdir="" 의 최상위 list 만 캐싱 — 사이드바 오프라인용).
        if (subdir === "") {
          void cacheList(result);
        }
        return result;
      } catch (e) {
        if (isNetworkFailure(e) && subdir === "") {
          const cached = await getCachedList();
          if (cached) return cached.paths;
        }
        throw e;
      }
    },
    listRecursive: (subdir) => inner.listRecursive(subdir),
    listFoldersRecursive: (subdir) => inner.listFoldersRecursive(subdir),

    async read(relPath: string): Promise<string> {
      // pending outbox write 여부 확인 — 있으면 캐시 서빙 금지(dirty buffer 원칙).
      // 비동기 조회지만 read-path 이므로 outbox listOps() 는 가볍다(IDB read-only).
      let hasPendingWrite = false;
      try {
        const ops = await listOps();
        hasPendingWrite = ops.some(
          (r) => r.op.type === "write" && r.op.path === relPath,
        );
      } catch {
        // listOps 실패 시 안전쪽으로 — 캐시 서빙 안 함.
        hasPendingWrite = true;
      }

      try {
        const content = await inner.read(relPath);
        // 성공 시 캐시 갱신(mtime = 서버 응답 기준 이상적이지만 readMeta 별도 호출
        // 비용이 있어 Date.now() 로 대체 — 정렬용 mtime 이 아니라 캐시 관리용).
        void cacheRead(relPath, content, Date.now());
        return content;
      } catch (e) {
        if (isNetworkFailure(e)) {
          // pending write 있으면 stale 캐시를 절대 서빙하지 않음.
          if (hasPendingWrite) {
            throw new OfflineCacheMissError(relPath);
          }
          const cached = await getCachedRead(relPath);
          if (cached) return cached.content;
          throw new OfflineCacheMissError(relPath);
        }
        throw e;
      }
    },

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

    // scanAll — inner(http) 로 위임. 오프라인 시 캐시 미지원(batch 특성상 캐싱 복잡도 높음).
    // 포트폴리오 탭은 온라인 전용으로 간주 — 실패 시 throw 그대로 전파.
    scanAll: (dir) => inner.scanAll(dir),

    flush,
  };
}
