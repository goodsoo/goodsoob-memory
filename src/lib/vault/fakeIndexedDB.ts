/**
 * fakeIndexedDB — outbox 테스트용 최소 in-memory IndexedDB 셰임.
 *
 * 프로젝트에 fake-indexeddb 의존이 없어(dependency-free 원칙) outbox.ts 가 실제로 쓰는
 * 부분집합만 구현한다: open/upgradeneeded, objectStore(keyPath+autoIncrement), createIndex,
 * add/count/getAll/delete/clear, index.openCursor(null,"prev"). 완전한 IDB 스펙 아님.
 *
 * 이건 T5 의 basic sanity 용. eviction/quota/부분실패 exhaustive 스위트는 T7.
 */

interface StoredRecord {
  [key: string]: unknown;
}

class FakeRequest<T = unknown> {
  result!: T;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;

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
  constructor(store: FakeObjectStore) {
    this.store = store;
  }
  getAll(): FakeRequest<StoredRecord[]> {
    const req = new FakeRequest<StoredRecord[]>();
    req._resolve(this.store._all());
    return req;
  }
  openCursor(
    _range: unknown,
    direction?: "next" | "prev",
  ): FakeRequest<FakeCursor | null> {
    const req = new FakeRequest<FakeCursor | null>();
    const all = this.store._all();
    if (all.length === 0) {
      req._resolve(null);
    } else {
      const rec = direction === "prev" ? all[all.length - 1] : all[0];
      req._resolve(new FakeCursor(rec));
    }
    return req;
  }
}

class FakeObjectStore {
  private data: Map<number, StoredRecord>;
  private meta: { autoInc: number; keyPath: string };
  constructor(
    data: Map<number, StoredRecord>,
    meta: { autoInc: number; keyPath: string },
  ) {
    this.data = data;
    this.meta = meta;
  }

  index(_name: string): FakeIndex {
    return new FakeIndex(this);
  }
  createIndex(_name: string, _keyPath: string, _opts?: unknown): void {
    /* no-op — seq 정렬은 _all() 이 담당 */
  }

  add(record: StoredRecord): FakeRequest<number> {
    const req = new FakeRequest<number>();
    const id = ++this.meta.autoInc;
    const stored = { ...record, [this.meta.keyPath]: id };
    this.data.set(id, stored);
    req._resolve(id);
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
  delete(id: number): FakeRequest<undefined> {
    const req = new FakeRequest<undefined>();
    this.data.delete(id);
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
    return [...this.data.values()].sort(
      (a, b) => (a.seq as number) - (b.seq as number),
    );
  }
}

class FakeTransaction {
  private data: Map<number, StoredRecord>;
  private meta: { autoInc: number; keyPath: string };
  constructor(
    data: Map<number, StoredRecord>,
    meta: { autoInc: number; keyPath: string },
  ) {
    this.data = data;
    this.meta = meta;
  }
  objectStore(_name: string): FakeObjectStore {
    return new FakeObjectStore(this.data, this.meta);
  }
}

class FakeDatabase {
  objectStoreNames = {
    _names: new Set<string>(),
    contains(n: string) {
      return this._names.has(n);
    },
  };
  private data = new Map<number, StoredRecord>();
  private meta = { autoInc: 0, keyPath: "id" };

  createObjectStore(
    name: string,
    opts: { keyPath: string; autoIncrement: boolean },
  ): FakeObjectStore {
    this.objectStoreNames._names.add(name);
    this.meta.keyPath = opts.keyPath;
    return new FakeObjectStore(this.data, this.meta);
  }
  transaction(_name: string, _mode: string): FakeTransaction {
    return new FakeTransaction(this.data, this.meta);
  }
}

export class FakeIDBFactory {
  private db = new FakeDatabase();

  open(_name: string, _version?: number): FakeRequest<FakeDatabase> {
    const req = new FakeRequest<FakeDatabase>();
    req.result = this.db;
    // upgradeneeded 를 먼저(store 생성) → success.
    queueMicrotask(() => {
      req.onupgradeneeded?.();
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
