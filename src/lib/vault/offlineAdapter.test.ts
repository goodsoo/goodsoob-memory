/**
 * offlineAdapter + outbox — T7 exhaustive data-loss test suite.
 *
 * 커버리지:
 *  #1  재기동 후 영속 (eviction defense — CRITICAL)
 *  #2  persist() 거부/미지원 시 미sync 카운트 정상 노출
 *  #3  오프라인 → 재연결 flush E2E
 *  #4  write/rename/delete/mkdir 인터리브 순서 보존
 *  #5  부분 실패 — K 성공, K+1 실패 → K 삭제, 나머지 순서 보존
 *  #6  4xx/5xx → outbox 에 안 들어감(propagate)
 *  #7  seq 단조 증가 — 재기동 후 max+1 에서 재개(충돌 없음)
 *  #8  동시 flush guard — double-send 없음
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installFakeIndexedDB } from "./fakeIndexedDB";
import {
  enqueueOp,
  listOps,
  countOps,
  __clearOutbox,
  __resetOutboxDb,
} from "./outbox";
import {
  createOfflineAdapter,
  flushOutbox,
  requestPersistence,
} from "./offlineAdapter";
import type { VaultAdapter, FileMeta, VaultWatchEvent } from "./adapter";

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼 — mock inner 어댑터

type CallRecord = { method: string; args: unknown[] };

/**
 * 완전한 VaultAdapter stub.
 * - write/delete/rename/mkdir 는 제어 가능한 배열(`behaviors`)에서 순서대로 결과를 꺼냄.
 *   배열이 비었으면 기본 성공.
 * - 호출 내역은 `calls` 배열에 축적.
 */
function makeInner(
  opts: {
    /** mutation 마다 순서대로 꺼낼 결과. 배열 소진 후엔 모두 성공. */
    behaviors?: Array<"ok" | { throw: Error }>;
  } = {},
): VaultAdapter & { calls: CallRecord[] } {
  const behaviors = [...(opts.behaviors ?? [])];
  const calls: CallRecord[] = [];

  async function next(method: string, args: unknown[]): Promise<void> {
    calls.push({ method, args });
    const b = behaviors.shift();
    if (!b || b === "ok") return;
    throw b.throw;
  }

  return {
    calls,
    setRoot(_p: string) {},
    getRoot() { return null; },
    list(_s: string) { return Promise.resolve([]); },
    listRecursive(_s: string) { return Promise.resolve([]); },
    listFoldersRecursive(_s: string) { return Promise.resolve([]); },
    read(_p: string) { return Promise.resolve(""); },
    readMeta(_p: string) { return Promise.resolve({ mtime: 0, size: 0 }); },
    exists(_p: string) { return Promise.resolve(false); },
    watch(_cb: (e: VaultWatchEvent) => void) { return Promise.resolve(() => {}); },
    async write(_p: string, content: string): Promise<FileMeta> {
      await next("write", [_p, content]);
      return { mtime: Date.now(), size: content.length };
    },
    async writeBinary(_p: string, bytes: Uint8Array): Promise<FileMeta> {
      calls.push({ method: "writeBinary", args: [_p] });
      return { mtime: Date.now(), size: bytes.length };
    },
    async delete(p: string, opts?: { recursive?: boolean }): Promise<void> {
      await next("delete", [p, opts]);
    },
    async rename(from: string, to: string): Promise<void> {
      await next("rename", [from, to]);
    },
    async mkdir(p: string): Promise<void> {
      await next("mkdir", [p]);
    },
  };
}

/** 네트워크 실패 에러(isNetworkFailure = true). */
function netErr(msg = "vault 서버 연결 실패: network") {
  return new Error(msg);
}

/** HttpError 시뮬레이션(isNetworkFailure = false — status 프로퍼티가 핵심). */
function httpErr(status: number) {
  const e = new Error(`HTTP ${status}`) as Error & { status: number };
  (e as { status: number }).status = status;
  return e;
}

// ─────────────────────────────────────────────────────────────────────────────
// 각 테스트 전 fresh fake IDB 설치 + outbox 모듈 상태 리셋

let restore: () => void;

beforeEach(() => {
  restore = installFakeIndexedDB();
  __resetOutboxDb();
});

afterEach(async () => {
  await __clearOutbox().catch(() => {});
  restore();
});

// ─────────────────────────────────────────────────────────────────────────────
// #1 — 재기동 후 영속 (CRITICAL: eviction defense)
// 앱 reload = dbPromise 캐시 drop + seqCounter null → 재open. 같은 FakeDatabase
// 인스턴스를 유지하면서 모듈 캐시만 리셋해 "앱 재기동" 시뮬레이션.

describe("#1 재기동 후 영속 (eviction defense)", () => {
  it("enqueue 후 DB 핸들을 리셋해도 op 가 남아있고 flush 가 성공한다", async () => {
    // [재기동 전] 3개 enqueue
    await enqueueOp({ type: "write", path: "meetings/a.md", content: "A" });
    await enqueueOp({ type: "write", path: "meetings/b.md", content: "B" });
    await enqueueOp({ type: "mkdir", path: "meetings/sub" });

    expect(await countOps()).toBe(3);

    // DB 핸들·seq 캐시만 리셋(FakeIDBFactory 인스턴스는 그대로 → 데이터 살아있음).
    __resetOutboxDb();

    // [재기동 후] 재조회 → 여전히 3개
    const afterRestart = await listOps();
    expect(afterRestart).toHaveLength(3);
    expect(afterRestart.map((r) => r.op.type)).toEqual([
      "write",
      "write",
      "mkdir",
    ]);

    // flush → 모두 drain
    const inner = makeInner();
    const result = await flushOutbox(inner);
    expect(result.flushed).toBe(3);
    expect(result.remaining).toBe(0);
    expect(await countOps()).toBe(0);
    // inner 에 write·write·mkdir 순서로 전달됐는지 검증
    expect(inner.calls.map((c) => c.method)).toEqual([
      "write",
      "write",
      "mkdir",
    ]);
  });

  it("flush 후 재기동하면 outbox 가 비어있다", async () => {
    await enqueueOp({ type: "write", path: "n.md", content: "hi" });
    const inner = makeInner();
    await flushOutbox(inner);

    // 재기동 시뮬레이션
    __resetOutboxDb();
    expect(await countOps()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #2 — persist() 거부·미지원 시에도 카운트 정상 노출

describe("#2 persist() 거부/미지원 시 미sync 카운트", () => {
  it("navigator.storage.persist 가 없어도 countOps 가 pending 개수를 반환한다", async () => {
    // navigator.storage 전체 없음 시뮬레이션
    const origNav = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: true },
      configurable: true,
      writable: true,
    });

    try {
      await enqueueOp({ type: "write", path: "x.md", content: "x" });
      await enqueueOp({ type: "delete", path: "y.md", recursive: false });

      // requestPersistence 는 navigator.storage 없으면 조용히 false 반환
      const persisted = await requestPersistence();
      expect(persisted).toBe(false);

      // persist 실패와 무관하게 카운트 노출
      expect(await countOps()).toBe(2);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: origNav,
        configurable: true,
        writable: true,
      });
    }
  });

  it("navigator.storage.persist 가 false 를 반환해도 카운트는 정확하다", async () => {
    const origNav = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: {
        onLine: true,
        storage: {
          persist: async () => false,
          persisted: async () => false,
        },
      },
      configurable: true,
      writable: true,
    });

    try {
      await enqueueOp({ type: "rename", from: "a.md", to: "b.md" });
      const persisted = await requestPersistence();
      expect(persisted).toBe(false);
      expect(await countOps()).toBe(1);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: origNav,
        configurable: true,
        writable: true,
      });
    }
  });

  it("navigator.storage.persist 가 예외를 던져도 카운트는 정확하다", async () => {
    const origNav = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: {
        onLine: true,
        storage: {
          persist: async () => { throw new Error("NotAllowedError"); },
          persisted: async () => false,
        },
      },
      configurable: true,
      writable: true,
    });

    try {
      await enqueueOp({ type: "mkdir", path: "notes" });
      const persisted = await requestPersistence();
      expect(persisted).toBe(false);
      expect(await countOps()).toBe(1);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: origNav,
        configurable: true,
        writable: true,
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #3 — 오프라인 → 재연결 E2E flush

describe("#3 오프라인 → 재연결 flush E2E", () => {
  it("N번 네트워크 실패 → 모두 큐잉 → inner 성공 전환 → flush 가 전부 drain 한다", async () => {
    // 3번 모두 네트워크 실패하는 inner
    const failingInner = makeInner({
      behaviors: [
        { throw: netErr() },
        { throw: netErr() },
        { throw: netErr() },
      ],
    });
    const adapter = createOfflineAdapter({
      inner: failingInner,
      installTriggers: false,
    });
    adapter.setRoot("/vault");

    // 오프라인 상태에서 3개 쓰기 — 모두 낙관 resolve
    await adapter.write("notes/1.md", "first");
    await adapter.write("notes/2.md", "second");
    await adapter.write("notes/3.md", "third");

    expect(await countOps()).toBe(3);

    // 재연결 — 성공하는 inner 로 교체 후 flush
    const onlineInner = makeInner(); // 모두 성공
    const result = await flushOutbox(onlineInner);

    expect(result.flushed).toBe(3);
    expect(result.remaining).toBe(0);
    expect(await countOps()).toBe(0);
  });

  it("오프라인 큐잉된 op 가 flush 후 재큐잉되지 않는다", async () => {
    const inner = makeInner({ behaviors: [{ throw: netErr() }] });
    const adapter = createOfflineAdapter({ inner, installTriggers: false });
    adapter.setRoot("/vault");

    await adapter.write("notes/x.md", "content");
    expect(await countOps()).toBe(1);

    // flush 성공
    const successInner = makeInner();
    await flushOutbox(successInner);
    expect(await countOps()).toBe(0);

    // 다시 flush 해도 아무 op 도 전송되지 않음
    const secondFlush = await flushOutbox(successInner);
    expect(secondFlush.flushed).toBe(0);
    // successInner 에는 첫 flush 의 1회 호출만 있어야 함
    expect(successInner.calls.filter((c) => c.method === "write")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #4 — 인터리브 순서 보존

describe("#4 인터리브 write/rename/delete/mkdir seq 순서", () => {
  it("write → rename → delete → mkdir → write 순서대로 inner 를 호출한다", async () => {
    await enqueueOp({ type: "write", path: "a.md", content: "A" });
    await enqueueOp({ type: "rename", from: "a.md", to: "b.md" });
    await enqueueOp({ type: "delete", path: "old.md", recursive: false });
    await enqueueOp({ type: "mkdir", path: "folder" });
    await enqueueOp({ type: "write", path: "folder/c.md", content: "C" });

    const inner = makeInner();
    const result = await flushOutbox(inner);

    expect(result.flushed).toBe(5);
    expect(inner.calls.map((c) => c.method)).toEqual([
      "write",
      "rename",
      "delete",
      "mkdir",
      "write",
    ]);
  });

  it("seq 값이 정확히 FIFO 오름차순임을 보장한다", async () => {
    await enqueueOp({ type: "mkdir", path: "p1" });
    await enqueueOp({ type: "write", path: "p2.md", content: "x" });
    await enqueueOp({ type: "delete", path: "p3.md", recursive: true });

    const ops = await listOps();
    const seqs = ops.map((o) => o.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #5 — 부분 실패

describe("#5 부분 실패 — K 성공 K+1 실패 나머지 보존", () => {
  it("K=2 성공, K+1=3번째 실패 → 2개 삭제, 3번째부터 남고 순서 유지", async () => {
    await enqueueOp({ type: "write", path: "1.md", content: "one" });
    await enqueueOp({ type: "write", path: "2.md", content: "two" });
    await enqueueOp({ type: "write", path: "3.md", content: "three" });
    await enqueueOp({ type: "write", path: "4.md", content: "four" });

    const inner = makeInner({
      behaviors: ["ok", "ok", { throw: netErr("fail at 3") }, "ok"],
    });

    const result = await flushOutbox(inner);
    expect(result.flushed).toBe(2);
    expect(result.remaining).toBe(2);

    const remaining = await listOps();
    expect(remaining).toHaveLength(2);
    // 3번째·4번째가 순서 그대로 남아있어야 함
    expect(remaining[0].op).toMatchObject({ type: "write", path: "3.md" });
    expect(remaining[1].op).toMatchObject({ type: "write", path: "4.md" });
  });

  it("1번째부터 실패하면 아무것도 삭제하지 않는다", async () => {
    await enqueueOp({ type: "write", path: "a.md", content: "a" });
    await enqueueOp({ type: "write", path: "b.md", content: "b" });

    const inner = makeInner({
      behaviors: [{ throw: netErr("immediate fail") }],
    });

    const result = await flushOutbox(inner);
    expect(result.flushed).toBe(0);
    expect(result.remaining).toBe(2);
    expect(await countOps()).toBe(2);
  });

  it("부분 실패 후 재시도 flush 는 K+1 번째부터 재개한다", async () => {
    await enqueueOp({ type: "write", path: "1.md", content: "one" });
    await enqueueOp({ type: "write", path: "2.md", content: "two" });
    await enqueueOp({ type: "write", path: "3.md", content: "three" });

    // 첫 번째 flush: 2번째에서 실패
    const firstInner = makeInner({
      behaviors: ["ok", { throw: netErr() }],
    });
    const first = await flushOutbox(firstInner);
    expect(first.flushed).toBe(1);
    expect(first.remaining).toBe(2);

    // 재시도: 2번째·3번째 flush
    const secondInner = makeInner(); // 모두 성공
    const second = await flushOutbox(secondInner);
    expect(second.flushed).toBe(2);
    expect(second.remaining).toBe(0);

    // 2번째·3번째 write 가 순서대로 전달됐는지 확인
    expect(secondInner.calls.map((c) => c.args[0])).toEqual(["2.md", "3.md"]);
    expect(await countOps()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #6 — 4xx/5xx NOT queued (서버 거부 → propagate, outbox 안 들어감)

describe("#6 4xx/5xx NOT queued — 서버 거부는 propagate", () => {
  it("write 에서 status=404 에러 → throw 이고 outbox 에 안 쌓인다", async () => {
    const inner = makeInner({
      behaviors: [{ throw: httpErr(404) }],
    });
    const adapter = createOfflineAdapter({ inner, installTriggers: false });
    adapter.setRoot("/vault");

    await expect(adapter.write("missing.md", "data")).rejects.toMatchObject({
      status: 404,
    });
    expect(await countOps()).toBe(0);
  });

  it("write 에서 status=500 에러 → throw 이고 outbox 에 안 쌓인다", async () => {
    const inner = makeInner({
      behaviors: [{ throw: httpErr(500) }],
    });
    const adapter = createOfflineAdapter({ inner, installTriggers: false });
    adapter.setRoot("/vault");

    await expect(adapter.write("file.md", "content")).rejects.toMatchObject({
      status: 500,
    });
    expect(await countOps()).toBe(0);
  });

  it("delete 에서 status=403 → throw, outbox 에 안 쌓인다", async () => {
    const inner = makeInner({
      behaviors: [{ throw: httpErr(403) }],
    });
    const adapter = createOfflineAdapter({ inner, installTriggers: false });
    adapter.setRoot("/vault");

    await expect(
      adapter.delete("protected.md", { recursive: false }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await countOps()).toBe(0);
  });

  it("rename 에서 status=409 → throw, outbox 에 안 쌓인다", async () => {
    const inner = makeInner({
      behaviors: [{ throw: httpErr(409) }],
    });
    const adapter = createOfflineAdapter({ inner, installTriggers: false });
    adapter.setRoot("/vault");

    await expect(
      adapter.rename("old.md", "new.md"),
    ).rejects.toMatchObject({ status: 409 });
    expect(await countOps()).toBe(0);
  });

  it("mkdir 에서 status=400 → throw, outbox 에 안 쌓인다", async () => {
    const inner = makeInner({
      behaviors: [{ throw: httpErr(400) }],
    });
    const adapter = createOfflineAdapter({ inner, installTriggers: false });
    adapter.setRoot("/vault");

    await expect(adapter.mkdir("bad-path")).rejects.toMatchObject({
      status: 400,
    });
    expect(await countOps()).toBe(0);
  });

  it("네트워크 실패(status 없음)는 outbox 에 쌓인다(대조군)", async () => {
    const inner = makeInner({
      behaviors: [{ throw: netErr("Failed to fetch") }],
    });
    const adapter = createOfflineAdapter({ inner, installTriggers: false });
    adapter.setRoot("/vault");

    // throw 해선 안 됨 — 낙관 resolve
    await expect(adapter.write("note.md", "hi")).resolves.toBeDefined();
    expect(await countOps()).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #7 — seq 단조 증가 — 재기동 후 max+1 에서 재개

describe("#7 seq 단조 증가 — 재기동 후 충돌 없음", () => {
  it("재기동 후 신규 op 의 seq 는 기존 max seq + 1 이다", async () => {
    // [재기동 전] 3개 enqueue → seq 1,2,3
    await enqueueOp({ type: "write", path: "1.md", content: "x" });
    await enqueueOp({ type: "write", path: "2.md", content: "y" });
    await enqueueOp({ type: "write", path: "3.md", content: "z" });

    const beforeRestart = await listOps();
    const maxSeqBefore = Math.max(...beforeRestart.map((r) => r.seq));
    expect(maxSeqBefore).toBe(3);

    // DB 핸들 리셋(재기동 시뮬레이션) — FakeIDBFactory 인스턴스·데이터는 유지
    __resetOutboxDb();

    // [재기동 후] 신규 enqueue
    const newOp = await enqueueOp({ type: "mkdir", path: "new-folder" });
    expect(newOp.seq).toBe(maxSeqBefore + 1); // = 4
  });

  it("재기동 전 op 가 없어도 seq 는 1 부터 시작한다", async () => {
    __resetOutboxDb(); // 빈 상태에서 리셋
    const op = await enqueueOp({ type: "write", path: "first.md", content: "f" });
    expect(op.seq).toBe(1);
  });

  it("재기동 후 연속 enqueue seq 는 중복 없이 단조 증가한다", async () => {
    // [전] 2개
    await enqueueOp({ type: "write", path: "a.md", content: "a" });
    await enqueueOp({ type: "write", path: "b.md", content: "b" });

    __resetOutboxDb();

    // [후] 3개 더
    const c = await enqueueOp({ type: "write", path: "c.md", content: "c" });
    const d = await enqueueOp({ type: "write", path: "d.md", content: "d" });
    const e = await enqueueOp({ type: "write", path: "e.md", content: "e" });

    // 재기동 전 max=2, 재기동 후는 3·4·5
    expect(c.seq).toBe(3);
    expect(d.seq).toBe(4);
    expect(e.seq).toBe(5);

    // 전체 조회 — seq 중복 없음
    const all = await listOps();
    const seqs = all.map((r) => r.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #8 — 동시 flush guard — double-send 없음

describe("#8 동시 flush guard", () => {
  it("두 번 flush() 를 동시에 호출해도 op 를 한 번만 inner 에 전달한다", async () => {
    await enqueueOp({ type: "write", path: "concurrent.md", content: "test" });

    const inner = makeInner();
    const adapter = createOfflineAdapter({ inner, installTriggers: false });
    adapter.setRoot("/vault");

    // 두 flush 를 동시 발사 — flushing 플래그가 두 번째를 막아야 함
    await Promise.all([adapter.flush(), adapter.flush()]);

    // write 는 정확히 1회만
    expect(inner.calls.filter((c) => c.method === "write")).toHaveLength(1);
    expect(await countOps()).toBe(0);
  });

  it("첫 flush 가 진행 중일 때 두 번째 flush 는 no-op 으로 빠져나온다", async () => {
    // 느린 inner — 첫 write 가 pending 인 동안 두 번째 flush 진입
    let resolveFirst!: () => void;
    const firstStarted = new Promise<void>((res) => {
      resolveFirst = res;
    });

    const slowCalls: string[] = [];
    const slowInner: VaultAdapter = {
      ...makeInner(),
      async write(p: string, content: string): Promise<FileMeta> {
        slowCalls.push(p);
        resolveFirst(); // 첫 write 진입 신호
        // 짧은 비동기 대기로 두 번째 flush 가 flushing=true 를 볼 시간 확보
        await new Promise<void>((r) => setTimeout(r, 10));
        return { mtime: Date.now(), size: content.length };
      },
    };

    await enqueueOp({ type: "write", path: "slow.md", content: "s" });

    const adapter = createOfflineAdapter({
      inner: slowInner,
      installTriggers: false,
    });

    const p1 = adapter.flush();
    // 첫 write 가 시작될 때까지 기다린 후 두 번째 flush 발사
    await firstStarted;
    const p2 = adapter.flush();

    await Promise.all([p1, p2]);

    // slow inner 에 write 는 1번만 전달
    expect(slowCalls).toHaveLength(1);
    expect(await countOps()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 추가 — offlineAdapter 의 delete/rename/mkdir 도 네트워크 실패 시 큐잉 검증

describe("offlineAdapter — delete/rename/mkdir 낙관 큐잉", () => {
  it("delete 네트워크 실패 → outbox 에 저장, throw 안 함", async () => {
    const inner = makeInner({ behaviors: [{ throw: netErr() }] });
    const adapter = createOfflineAdapter({ inner, installTriggers: false });
    adapter.setRoot("/vault");

    await expect(
      adapter.delete("notes/gone.md", { recursive: false }),
    ).resolves.toBeUndefined();

    const ops = await listOps();
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toEqual({
      type: "delete",
      path: "notes/gone.md",
      recursive: false,
    });
  });

  it("rename 네트워크 실패 → outbox 에 저장, throw 안 함", async () => {
    const inner = makeInner({ behaviors: [{ throw: netErr() }] });
    const adapter = createOfflineAdapter({ inner, installTriggers: false });
    adapter.setRoot("/vault");

    await expect(
      adapter.rename("old.md", "new.md"),
    ).resolves.toBeUndefined();

    const ops = await listOps();
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toEqual({ type: "rename", from: "old.md", to: "new.md" });
  });

  it("mkdir 네트워크 실패 → outbox 에 저장, throw 안 함", async () => {
    const inner = makeInner({ behaviors: [{ throw: netErr() }] });
    const adapter = createOfflineAdapter({ inner, installTriggers: false });
    adapter.setRoot("/vault");

    await expect(adapter.mkdir("notes/new-folder")).resolves.toBeUndefined();

    const ops = await listOps();
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toEqual({ type: "mkdir", path: "notes/new-folder" });
  });

  it("recursive=true delete → outbox 에 recursive=true 로 저장", async () => {
    const inner = makeInner({ behaviors: [{ throw: netErr() }] });
    const adapter = createOfflineAdapter({ inner, installTriggers: false });
    adapter.setRoot("/vault");

    await adapter.delete("folder", { recursive: true });

    const ops = await listOps();
    expect(ops[0].op).toEqual({
      type: "delete",
      path: "folder",
      recursive: true,
    });
  });
});
