/**
 * fakeIndexedDB — outbox + readcache 테스트용 최소 in-memory IndexedDB 셰임.
 *
 * 프로젝트에 fake-indexeddb 의존이 없어(dependency-free 원칙) outbox.ts / readCache.ts 가
 * 실제로 쓰는 부분집합만 구현한다: open/upgradeneeded, objectStore(keyPath+autoIncrement
 * 또는 plain keyPath), createIndex, add/put/count/getAll/get/delete/clear,
 * index.openCursor(null,"prev"), 멀티 store, 멀티 store 트랜잭션.
 *
 * T5/T7 의 outbox + T6 의 readcache 를 동일 FakeIDBFactory 로 커버.
 */

interface StoredRecord {
  [key: string]: unknown;
}

class FakeRequest<T = unknown> {
  result!: T;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: ((ev: IDBVersionChangeEvent) => void) | null = null;

  _resolve(value: T): void {
    this.result = value;
    queueMicrotask(() => this.onsuccess?.());
  }
  _reject(err: unknown): void {
    this.error = err;
    queueMicrotask(() => this.onerror?.());
  }
}

class FakeCursor {
  value: StoredRecord;
  constructor(value: StoredRecord) {
    this.value = value;
  }
}

class FakeIndex {
  private store: FakeObjectStore;
  private indexField: string;
  constructor(store: FakeObjectStore, indexField: string) {
    this.store = store;
    this.indexField = indexField;
  }
  getAll(): FakeRequest<StoredRecord[]> {
    const req = new FakeRequest<StoredRecord[]>();
    // indexField 기준 오름차순 정렬
    const sorted = this.store._all().slice().sort((a, b) => {
      const av = a[this.indexField] as number;
      const bv = b[this.indexField] as number;
      return av - bv;
    });
    req._resolve(sorted);
    return req;
  }
  openCursor(
    _range: unknown,
    direction?: "next" | "prev",
  ): FakeRequest<FakeCursor | null> {
    const req = new FakeRequest<FakeCursor | null>();
    const sorted = this.store._all().slice().sort((a, b) => {
      const av = a[this.indexField] as number;
      const bv = b[this.indexField] as number;
      return av - bv;
    });
    if (sorted.length === 0) {
      req._resolve(null);
    } else {
      const rec = direction === "prev" ? sorted[sorted.length - 1] : sorted[0];
      req._resolve(new FakeCursor(rec));
    }
    return req;
  }
}

class FakeObjectStore {
  /** data 맵 참조 — 부모 FakeStoreData 와 공유. */
  private data: Map<unknown, StoredRecord>;
  private meta: { autoInc: number; keyPath: string; autoIncrement: boolean };
  private indexes: Map<string, string>; // name → keyPath

  constructor(
    data: Map<unknown, StoredRecord>,
    meta: { autoInc: number; keyPath: string; autoIncrement: boolean },
    indexes: Map<string, string>,
  ) {
    this.data = data;
    this.meta = meta;
    this.indexes = indexes;
  }

  index(name: string): FakeIndex {
    const field = this.indexes.get(name) ?? name;
    return new FakeIndex(this, field);
  }

  createIndex(name: string, keyPath: string, _opts?: unknown): void {
    this.indexes.set(name, keyPath);
  }

  add(record: StoredRecord): FakeRequest<unknown> {
    const req = new FakeRequest<unknown>();
    if (this.meta.autoIncrement) {
      const id = ++this.meta.autoInc;
      const stored = { ...record, [this.meta.keyPath]: id };
      this.data.set(id, stored);
      req._resolve(id);
    } else {
      const key = record[this.meta.keyPath] as unknown;
      this.data.set(key, { ...record });
      req._resolve(key);
    }
    return req;
  }

  put(record: StoredRecord): FakeRequest<unknown> {
    const req = new FakeRequest<unknown>();
    if (this.meta.autoIncrement) {
      // autoIncrement store 에 put 은 기존 id 가 있으면 update, 없으면 insert.
      const existingId = record[this.meta.keyPath] as number | undefined;
      if (existingId !== undefined && this.data.has(existingId)) {
        this.data.set(existingId, { ...record });
        req._resolve(existingId);
      } else {
        const id = ++this.meta.autoInc;
        const stored = { ...record, [this.meta.keyPath]: id };
        this.data.set(id, stored);
        req._resolve(id);
      }
    } else {
      const key = record[this.meta.keyPath] as unknown;
      this.data.set(key, { ...record });
      req._resolve(key);
    }
    return req;
  }

  get(key: unknown): FakeRequest<StoredRecord | undefined> {
    const req = new FakeRequest<StoredRecord | undefined>();
    req._resolve(this.data.get(key));
    return req;
  }

  count(): FakeRequest<number> {
    const req = new FakeRequest<number>();
    req._resolve(this.data.size);
    return req;
  }

  getAll(): FakeRequest<StoredRecord[]> {
    const req = new FakeRequest<StoredRecord[]>();
    req._resolve(this._all());
    return req;
  }

  delete(key: unknown): FakeRequest<undefined> {
    const req = new FakeRequest<undefined>();
    this.data.delete(key);
    req._resolve(undefined);
    return req;
  }

  clear(): FakeRequest<undefined> {
    const req = new FakeRequest<undefined>();
    this.data.clear();
    req._resolve(undefined);
    return req;
  }

  _all(): StoredRecord[] {
    return [...this.data.values()];
  }
}

/** FakeDatabase 내 store 의 실제 저장 단위. */
interface FakeStoreData {
  data: Map<unknown, StoredRecord>;
  meta: { autoInc: number; keyPath: string; autoIncrement: boolean };
  indexes: Map<string, string>;
}

class FakeTransaction {
  private stores: Map<string, FakeStoreData>;
  constructor(stores: Map<string, FakeStoreData>) {
    this.stores = stores;
  }
  objectStore(name: string): FakeObjectStore {
    const sd = this.stores.get(name);
    if (!sd) throw new Error(`FakeIDB: unknown store "${name}"`);
    return new FakeObjectStore(sd.data, sd.meta, sd.indexes);
  }
}

class FakeDatabase {
  objectStoreNames: DOMStringList & { _names: Set<string> } = (() => {
    const s = new Set<string>();
    return {
      _names: s,
      contains(n: string) { return s.has(n); },
      item(i: number) { return [...s][i] ?? null; },
      get length() { return s.size; },
      [Symbol.iterator]() { return s[Symbol.iterator](); },
    } as DOMStringList & { _names: Set<string> };
  })();

  private stores = new Map<string, FakeStoreData>();

  createObjectStore(
    name: string,
    opts: { keyPath: string; autoIncrement?: boolean },
  ): FakeObjectStore {
    this.objectStoreNames._names.add(name);
    const sd: FakeStoreData = {
      data: new Map(),
      meta: {
        autoInc: 0,
        keyPath: opts.keyPath,
        autoIncrement: opts.autoIncrement === true,
      },
      indexes: new Map(),
    };
    this.stores.set(name, sd);
    return new FakeObjectStore(sd.data, sd.meta, sd.indexes);
  }

  transaction(
    storeNames: string | string[],
    _mode?: string,
  ): FakeTransaction {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const txStores = new Map<string, FakeStoreData>();
    for (const n of names) {
      const sd = this.stores.get(n);
      if (!sd) throw new Error(`FakeIDB: unknown store "${n}"`);
      txStores.set(n, sd);
    }
    return new FakeTransaction(txStores);
  }
}

export class FakeIDBFactory {
  private db = new FakeDatabase();

  open(_name: string, _version?: number): FakeRequest<FakeDatabase> {
    const req = new FakeRequest<FakeDatabase>();
    req.result = this.db;
    // upgradeneeded 를 먼저(store 생성) → success.
    // IDBVersionChangeEvent 형태로 oldVersion=0 을 넘겨 실제 upgradeneeded 핸들러가
    // oldVersion 을 읽을 수 있게 한다(outbox.ts 의 v1/v2 분기).
    queueMicrotask(() => {
      const fakeEvt = { oldVersion: 0 } as IDBVersionChangeEvent;
      req.onupgradeneeded?.(fakeEvt);
      req.onsuccess?.();
    });
    return req;
  }
}

/** 전역 indexedDB 를 fresh fake 로 설치하고 복원 함수를 반환. */
export function installFakeIndexedDB(): () => void {
  const g = globalThis as unknown as { indexedDB?: unknown };
  const prev = g.indexedDB;
  g.indexedDB = new FakeIDBFactory() as unknown as IDBFactory;
  return () => {
    g.indexedDB = prev as IDBFactory;
  };
}
