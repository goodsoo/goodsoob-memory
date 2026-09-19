/**
 * outbox / offlineAdapter basic sanity (T5).
 *
 * 검증: enqueue → 영속, seq FIFO 순서, POST 성공 시 삭제, 네트워크 실패 시 큐잉,
 * 부분 실패 시 순서 보존(멈춤). exhaustive eviction/quota/재시도 스위트는 T7.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installFakeIndexedDB } from "./fakeIndexedDB";
import {
  enqueueOp,
  listOps,
  countOps,
  deleteOp,
  subscribeOutbox,
  __clearOutbox,
  __resetOutboxDb,
} from "./outbox";
import { createOfflineAdapter, flushOutbox } from "./offlineAdapter";
import { createMemoryAdapter } from "./adapter";

let restore: () => void;

beforeEach(() => {
  restore = installFakeIndexedDB();
  __resetOutboxDb();
});

afterEach(async () => {
  await __clearOutbox().catch(() => {});
  restore();
});

describe("outbox — enqueue/persist/순서", () => {
  it("enqueue 하면 저장되고 count 가 증가한다", async () => {
    expect(await countOps()).toBe(0);
    await enqueueOp({ type: "write", path: "notes/a.md", content: "A" });
    await enqueueOp({ type: "write", path: "notes/b.md", content: "B" });
    expect(await countOps()).toBe(2);
  });

  it("listOps 는 seq 오름차순(FIFO)으로 반환한다", async () => {
    await enqueueOp({ type: "write", path: "1.md", content: "1" });
    await enqueueOp({ type: "delete", path: "2.md", recursive: false });
    await enqueueOp({ type: "rename", from: "3.md", to: "3b.md" });
    const ops = await listOps();
    expect(ops.map((o) => o.seq)).toEqual([1, 2, 3]);
    expect(ops[0].op.type).toBe("write");
    expect(ops[1].op.type).toBe("delete");
    expect(ops[2].op.type).toBe("rename");
  });

  it("deleteOp 로 개별 op 를 제거한다", async () => {
    const rec = await enqueueOp({ type: "mkdir", path: "notes" });
    expect(await countOps()).toBe(1);
    await deleteOp(rec.id!);
    expect(await countOps()).toBe(0);
  });

  it("subscribeOutbox 가 enqueue 시 count 를 reactively 통지한다", async () => {
    const seen: number[] = [];
    const unsub = subscribeOutbox((c) => seen.push(c));
    await enqueueOp({ type: "write", path: "x.md", content: "x" });
    // 마이크로태스크 flush 대기
    await new Promise((r) => setTimeout(r, 0));
    unsub();
    expect(seen[seen.length - 1]).toBe(1);
  });
});

describe("offlineAdapter — enqueue-vs-direct + flush", () => {
  it("write 성공 시 직접 통과(큐잉 안 함)", async () => {
    const inner = createMemoryAdapter();
    inner.setRoot("/vault");
    const off = createOfflineAdapter({ inner, installTriggers: false });
    off.setRoot("/vault");
    await off.write("notes/a.md", "hello");
    expect(await countOps()).toBe(0);
    expect(await inner.read("notes/a.md")).toBe("hello");
  });

  it("네트워크 실패 시 op 를 outbox 에 큐잉하고 낙관적으로 resolve", async () => {
    const inner = createMemoryAdapter();
    inner.setRoot("/vault");
    // write 를 네트워크 실패로 강제.
    inner.write = vi
      .fn()
      .mockRejectedValue(new Error("vault 서버 연결 실패: /api/vault/write"));
    const off = createOfflineAdapter({ inner, installTriggers: false });
    off.setRoot("/vault");
    const meta = await off.write("notes/a.md", "queued");
    expect(meta.size).toBe("queued".length); // throw 안 하고 낙관 응답
    expect(await countOps()).toBe(1);
    const ops = await listOps();
    expect(ops[0].op).toEqual({
      type: "write",
      path: "notes/a.md",
      content: "queued",
    });
  });

  it("flush 는 성공한 op 만 삭제하고 순서대로 replay 한다", async () => {
    const inner = createMemoryAdapter();
    inner.setRoot("/vault");
    // 3개 큐잉.
    await enqueueOp({ type: "write", path: "1.md", content: "one" });
    await enqueueOp({ type: "write", path: "2.md", content: "two" });
    await enqueueOp({ type: "mkdir", path: "sub" });

    const res = await flushOutbox(inner);
    expect(res.flushed).toBe(3);
    expect(res.remaining).toBe(0);
    expect(await countOps()).toBe(0);
    expect(await inner.read("1.md")).toBe("one");
    expect(await inner.read("2.md")).toBe("two");
  });

  it("부분 실패 시 그 자리서 멈추고 나머지 순서를 보존한다", async () => {
    const inner = createMemoryAdapter();
    inner.setRoot("/vault");
    await enqueueOp({ type: "write", path: "1.md", content: "one" });
    await enqueueOp({ type: "write", path: "2.md", content: "two" });
    await enqueueOp({ type: "write", path: "3.md", content: "three" });

    // 두 번째 write 에서 실패하도록 wrapping.
    const realWrite = inner.write.bind(inner);
    let n = 0;
    inner.write = vi.fn(async (p: string, c: string) => {
      n += 1;
      if (n === 2) throw new Error("연결 실패");
      return realWrite(p, c);
    }) as typeof inner.write;

    const res = await flushOutbox(inner);
    expect(res.flushed).toBe(1); // 첫 번째만 성공
    expect(res.remaining).toBe(2); // 2·3 남음
    const ops = await listOps();
    // 남은 것은 여전히 seq 순 — 2.md 먼저, 3.md 다음(건너뜀 없음).
    expect(ops.map((o) => (o.op as { path: string }).path)).toEqual([
      "2.md",
      "3.md",
    ]);
  });
});
