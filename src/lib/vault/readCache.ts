/**
 * readCache (T6) — 오프라인 읽기 캐시.
 *
 * outbox.ts 가 소유한 `goodsoob-vault` DB(v2) 안의 `readcache` / `listcache` store 를
 * 사용한다. DB open 은 outbox.openDb() 를 공유 — 같은 DB 를 서로 다른 버전으로 열어
 * 충돌하는 일이 없다.
 *
 * 설계 결정:
 *  - N = 50 (최근 50개 노트). 노트당 ≈2~5kB × 50 = 최대 250kB — iOS IndexedDB
 *    eviction 리스크 없음. reversible: N 을 올리면 더 많이, 내리면 적게 캐시.
 *    eviction 기준 = cachedAt(캐시에 올라온 시각) 오름차순 LRU-ish.
 *  - list() 결과(경로 배열)도 별도 단일 항목(`__list__`)으로 캐시.
 *  - pending outbox write 가 있는 경로는 캐시에서 절대 서빙하지 않는다
 *    (design doc "replica refresh vs dirty buffer" 규칙). 이 판정은 offlineAdapter.ts
 *    의 read() 가 담당 — readCache 자체는 put/get 만 담당.
 *
 * 의존성 0 — raw IndexedDB, outbox.openDb() 공유.
 */

import { openDb } from "./outbox";

const CACHE_STORE = "readcache";
const LIST_STORE = "listcache";
/** list 캐시의 단일 키(store 에 한 항목만 저장). */
const LIST_KEY = "__list__";

/** 최대 캐시 항목 수. 초과하면 가장 오래된(cachedAt 기준) 항목 evict. */
export const READ_CACHE_MAX_N = 50;

// ─────────────────────────────────────────────────────────────────────────────
// 타입

export interface ReadCacheEntry {
  /** vault 상대 경로 (primary key). */
  path: string;
  content: string;
  /** 서버에서 받은 파일 mtime(ms). */
  mtime: number;
  /** 캐시에 올라온 시각(ms). eviction 판정 기준. */
  cachedAt: number;
}

export interface ListCacheEntry {
  key: string; // always LIST_KEY
  paths: string[];
  cachedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 오프라인 캐시 미스 신호

/** 오프라인 상태이고 해당 경로가 캐시에 없을 때 throw. */
export class OfflineCacheMissError extends Error {
  path: string;
  constructor(path: string) {
    super(`오프라인 — 이 노트는 온라인에서 불러올 수 있습니다.`);
    this.name = "OfflineCacheMissError";
    this.path = path;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 유틸

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 요청 실패"));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 캐시 write (온라인 read 성공 후 저장)

/** 단일 노트를 캐시에 저장. 초과 항목은 cachedAt 기준 오래된 것부터 evict. */
export async function cacheRead(
  path: string,
  content: string,
  mtime: number,
): Promise<void> {
  try {
    const db = await openDb();
    const entry: ReadCacheEntry = { path, content, mtime, cachedAt: Date.now() };

    // put(upsert) — 이미 있으면 cachedAt 갱신.
    const putTx = db.transaction(CACHE_STORE, "readwrite");
    await reqToPromise(putTx.objectStore(CACHE_STORE).put(entry));

    // 초과 eviction: cachedAt 오름차순으로 정렬해 제일 오래된 것 삭제.
    await evictOldest(db);
  } catch {
    // 캐시 쓰기 실패는 silent — 온라인 읽기 반환값에 영향 없음.
  }
}

async function evictOldest(db: IDBDatabase): Promise<void> {
  const store = db
    .transaction(CACHE_STORE, "readonly")
    .objectStore(CACHE_STORE);
  const all = (await reqToPromise(
    store.index("cachedAt").getAll(),
  )) as ReadCacheEntry[];

  if (all.length <= READ_CACHE_MAX_N) return;

  // cachedAt 오름차순(index 정렬) — 앞쪽이 가장 오래됨.
  const toDelete = all.slice(0, all.length - READ_CACHE_MAX_N);
  const delTx = db.transaction(CACHE_STORE, "readwrite");
  const delStore = delTx.objectStore(CACHE_STORE);
  for (const entry of toDelete) {
    await reqToPromise(delStore.delete(entry.path));
  }
}

/** list() 결과 전체를 단일 항목으로 캐시. */
export async function cacheList(paths: string[]): Promise<void> {
  try {
    const db = await openDb();
    const entry: ListCacheEntry = {
      key: LIST_KEY,
      paths,
      cachedAt: Date.now(),
    };
    const tx = db.transaction(LIST_STORE, "readwrite");
    await reqToPromise(tx.objectStore(LIST_STORE).put(entry));
  } catch {
    // silent
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 캐시 read (오프라인 폴백)

/** path 에 대한 캐시 항목을 반환. 없으면 null. */
export async function getCachedRead(
  path: string,
): Promise<ReadCacheEntry | null> {
  try {
    const db = await openDb();
    const store = db
      .transaction(CACHE_STORE, "readonly")
      .objectStore(CACHE_STORE);
    const result = await reqToPromise(
      store.get(path) as IDBRequest<ReadCacheEntry | undefined>,
    );
    return result ?? null;
  } catch {
    return null;
  }
}

/** list 캐시를 반환. 없으면 null. */
export async function getCachedList(): Promise<ListCacheEntry | null> {
  try {
    const db = await openDb();
    const store = db
      .transaction(LIST_STORE, "readonly")
      .objectStore(LIST_STORE);
    const result = await reqToPromise(
      store.get(LIST_KEY) as IDBRequest<ListCacheEntry | undefined>,
    );
    return result ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트용 유틸

/** 테스트용 — readcache + listcache 를 비운다. */
export async function __clearReadCache(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([CACHE_STORE, LIST_STORE], "readwrite");
  await reqToPromise(tx.objectStore(CACHE_STORE).clear());
  await reqToPromise(tx.objectStore(LIST_STORE).clear());
}

/** 테스트용 — DB 핸들 캐시 리셋(outbox __resetOutboxDb 와 함께 호출). */
export function __resetReadCacheDb(): void {
  // openDb 는 outbox 의 dbPromise 를 공유하므로, outbox 의 __resetOutboxDb() 를
  // 함께 호출해야 DB 핸들이 완전히 리셋된다. 이 함수는 대칭 인터페이스 용으로만 존재.
  // 실제 리셋은 __resetOutboxDb() 가 담당.
}
