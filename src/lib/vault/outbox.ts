/**
 * capture outbox (T5) — 폰 오프라인 캡처의 durability 코어.
 *
 * 모든 MUTATION(write / delete / rename / mkdir)을 append-only op 으로 IndexedDB 에
 * 쌓는다. 오프라인·서버다운으로 fetch 가 실패하면 op 를 여기 append 하고 낙관적으로
 * resolve — 사용자 입력을 절대 버리거나 막지 않는다(design 실패모드 #1 = eviction 유실).
 *
 * 온라인 복귀(window "online") + 앱 포그라운드(visibilitychange→visible, iOS 는
 * Background Sync 없음)에서 seq 순(FIFO)으로 서버에 flush 하고, POST 성공한 op 만 삭제.
 * 실패 시 그 자리서 멈춰 순서를 보존(뒤 op 를 건너뛰지 않음 = 부분실패 안전).
 *
 * 의존성 0 — raw IndexedDB (growth 오프라인 스택과 동일 패턴). Workbox/idb lib 안 씀.
 *
 * 이 파일은 브라우저/http 경로 전용. Tauri 경로는 outbox 를 안 탄다(T8 까지 Tauri 어댑터 유지).
 */

const DB_NAME = "goodsoob-vault";
const DB_VERSION = 1;
const STORE = "outbox";
const SEQ_INDEX = "seq";

/** 서버 엔드포인트로 replay 가능한 append-only mutation op. */
export type OutboxOp =
  | { type: "write"; path: string; content: string }
  | { type: "delete"; path: string; recursive: boolean }
  | { type: "rename"; from: string; to: string }
  | { type: "mkdir"; path: string };

/** IndexedDB 에 저장되는 op 레코드. id = autoIncrement, seq = monotonic FIFO 키. */
export interface OutboxRecord {
  id?: number;
  /** monotonic 순서 키. flush 는 이 순서(FIFO)로 drain. */
  seq: number;
  /** enqueue 시각(표시·디버그용, 순서 판정엔 안 씀 — 서버 수신 순서가 권위). */
  createdAt: number;
  op: OutboxOp;
}

// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB 저수준

let dbPromise: Promise<IDBDatabase> | null = null;

function idbFactory(): IDBFactory | null {
  if (typeof indexedDB !== "undefined") return indexedDB;
  // SSR/구형 환경 — 없으면 outbox 비활성(호출부가 graceful degrade).
  return null;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const idb = idbFactory();
    if (!idb) {
      reject(new Error("IndexedDB 를 사용할 수 없습니다."));
      return;
    }
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex(SEQ_INDEX, "seq", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open 실패"));
  });
  return dbPromise;
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 요청 실패"));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// monotonic seq — 재기동 후에도 단조 증가하도록 마지막 seq + 1 에서 시작

let seqCounter: number | null = null;

async function nextSeq(db: IDBDatabase): Promise<number> {
  if (seqCounter === null) {
    // store 의 최대 seq 를 읽어 이어감(앱 재기동 후에도 단조 증가 보장).
    const store = tx(db, "readonly");
    const idx = store.index(SEQ_INDEX);
    const cursor = await reqToPromise(idx.openCursor(null, "prev"));
    seqCounter = cursor ? (cursor.value as OutboxRecord).seq : 0;
  }
  seqCounter += 1;
  return seqCounter;
}

// ─────────────────────────────────────────────────────────────────────────────
// 변경 알림 — useOutboxCount 가 구독. enqueue/flush 시 count 를 reactively 갱신.

type CountListener = (count: number) => void;
const listeners = new Set<CountListener>();

async function notify(): Promise<void> {
  if (listeners.size === 0) return;
  let count = 0;
  try {
    count = await countOps();
  } catch {
    count = 0;
  }
  for (const l of listeners) l(count);
}

export function subscribeOutbox(listener: CountListener): () => void {
  listeners.add(listener);
  // 구독 즉시 현재 count 를 push(초기값).
  countOps()
    .then((c) => listener(c))
    .catch(() => listener(0));
  return () => listeners.delete(listener);
}

// ─────────────────────────────────────────────────────────────────────────────
// public API

/** op 를 outbox 끝에 append. seq 부여 후 저장, count 리스너 알림. */
export async function enqueueOp(op: OutboxOp): Promise<OutboxRecord> {
  const db = await openDb();
  const seq = await nextSeq(db);
  const record: OutboxRecord = { seq, createdAt: Date.now(), op };
  const store = tx(db, "readwrite");
  const id = await reqToPromise(store.add(record));
  record.id = id as number;
  await notify();
  return record;
}

/** 미flush op 개수. UI 배지·durability 감시용. */
export async function countOps(): Promise<number> {
  const db = await openDb();
  const store = tx(db, "readonly");
  return reqToPromise(store.count());
}

/** seq 오름차순(FIFO)으로 전체 op 를 반환. flush 가 순서 보존 drain 에 사용. */
export async function listOps(): Promise<OutboxRecord[]> {
  const db = await openDb();
  const store = tx(db, "readonly");
  const idx = store.index(SEQ_INDEX);
  const all = await reqToPromise(idx.getAll());
  return (all as OutboxRecord[]).slice().sort((a, b) => a.seq - b.seq);
}

/** POST 성공한 op 를 삭제. */
export async function deleteOp(id: number): Promise<void> {
  const db = await openDb();
  const store = tx(db, "readwrite");
  await reqToPromise(store.delete(id));
  await notify();
}

/** 테스트용 — store 를 비우고 seq 카운터 리셋. */
export async function __clearOutbox(): Promise<void> {
  const db = await openDb();
  const store = tx(db, "readwrite");
  await reqToPromise(store.clear());
  seqCounter = null;
  await notify();
}

/** 테스트용 — DB 핸들 캐시 리셋(fake IDB 교체 시). */
export function __resetOutboxDb(): void {
  dbPromise = null;
  seqCounter = null;
}
