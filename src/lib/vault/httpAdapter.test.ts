/**
 * createHttpAdapter 테스트 (T2) — fetch·SSE mock. 실서버 안 띄움(hermetic).
 * 커버: happy(read/write/list/…), 서버다운, 타임아웃, 404, write=no-op(ConflictError 없음),
 * SSE watch 이벤트 변환 + 재연결.
 */
import { describe, it, expect, vi } from "vitest";
import { createHttpAdapter } from "./httpAdapter";
import type { VaultWatchEvent } from "./adapter";

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createHttpAdapter — happy path", () => {
  it("read 는 서버 content 를 반환", async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ content: "hello" }));
    const a = createHttpAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await a.read("meetings/x.md")).toBe("hello");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/vault/read?path=meetings%2Fx.md",
      expect.any(Object),
    );
  });

  it("write 는 meta 반환 + expectedMtime 은 no-op (ConflictError 절대 없음)", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      // expectedMtime 이 body 에 안 실린다(no-op) — path·content 만.
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ path: "a.md", content: "new" });
      return jsonRes({ mtime: 1234, size: 3 });
    });
    const a = createHttpAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    // expectedMtime 을 넘겨도 conflict 안 남 — 항상 성공(새 버전).
    const meta = await a.write("a.md", "new", 999);
    expect(meta).toEqual({ mtime: 1234, size: 3 });
  });

  it("readMeta.mtime = 서버 git 커밋 시각을 그대로 전달", async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ mtime: 1_700_000_000_000, size: 10 }));
    const a = createHttpAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const meta = await a.readMeta("a.md");
    expect(meta.mtime).toBe(1_700_000_000_000);
  });

  it("list/listRecursive/listFoldersRecursive 는 mode 파라미터로 분기", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return jsonRes({ paths: ["a.md"] });
    });
    const a = createHttpAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await a.list("meetings");
    await a.listRecursive("meetings");
    await a.listFoldersRecursive("meetings");
    expect(calls[0]).toContain("mode=flat");
    expect(calls[1]).toContain("mode=recursive");
    expect(calls[2]).toContain("mode=folders");
  });

  it("exists / delete / rename / mkdir", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/exists")) return jsonRes({ exists: true });
      return jsonRes({ ok: true });
    });
    const a = createHttpAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await a.exists("a.md")).toBe(true);
    await expect(a.delete("a.md", { recursive: true })).resolves.toBeUndefined();
    await expect(a.rename("a.md", "b.md")).resolves.toBeUndefined();
    await expect(a.mkdir("dir")).resolves.toBeUndefined();
  });

  it("setRoot/getRoot 를 추적(포트폴리오 escape-hatch 용)", () => {
    const a = createHttpAdapter({ fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(a.getRoot()).toBeNull();
    a.setRoot("/vault");
    expect(a.getRoot()).toBe("/vault");
  });
});

describe("createHttpAdapter — 실패 모드", () => {
  it("서버 다운(fetch reject) → 명시 오류 throw (silent 금지)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const a = createHttpAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(a.read("a.md")).rejects.toThrow(/연결 실패/);
  });

  it("타임아웃 → AbortError 를 타임아웃 오류로 변환", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // AbortController.signal 이 abort 되면 reject.
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    );
    const a = createHttpAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    });
    await expect(a.read("a.md")).rejects.toThrow(/타임아웃/);
  });

  it("404 → HttpError (서버 error 메시지 노출)", async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ error: "ENOENT: a.md" }, 404));
    const a = createHttpAdapter({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(a.read("a.md")).rejects.toThrow(/ENOENT/);
  });
});

// ── SSE watch ────────────────────────────────────────────────────────────────
// 최소 EventSource mock — addEventListener('change') 로 이벤트 주입.
class FakeEventSource {
  url: string;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  closed = false;
  static instances: FakeEventSource[] = [];
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }
  emit(type: string, data: unknown) {
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    this.listeners.get(type)?.forEach((cb) => cb(ev));
  }
  triggerError() {
    this.onerror?.();
  }
  close() {
    this.closed = true;
  }
}

describe("createHttpAdapter — watch (SSE)", () => {
  it("SSE change 이벤트 → VaultWatchEvent 콜백", async () => {
    FakeEventSource.instances = [];
    const a = createHttpAdapter({
      fetchImpl: vi.fn() as unknown as typeof fetch,
      eventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    });
    const events: VaultWatchEvent[] = [];
    const unsub = await a.watch((e) => events.push(e));

    const es = FakeEventSource.instances[0];
    es.emit("ready", { ok: true });
    es.emit("change", { type: "created", path: "meetings/a.md" });
    es.emit("change", { type: "deleted", path: "meetings/b.md" });

    expect(events).toEqual([
      { type: "created", path: "meetings/a.md" },
      { type: "deleted", path: "meetings/b.md" },
    ]);
    unsub();
    expect(es.closed).toBe(true);
  });

  it("연결 끊기면 재연결(backoff) — 새 EventSource 생성", async () => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    const a = createHttpAdapter({
      fetchImpl: vi.fn() as unknown as typeof fetch,
      eventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    });
    const unsub = await a.watch(() => {});
    expect(FakeEventSource.instances.length).toBe(1);

    FakeEventSource.instances[0].triggerError();
    await vi.advanceTimersByTimeAsync(600); // backoff 500ms 경과
    expect(FakeEventSource.instances.length).toBe(2); // 재연결

    unsub();
    vi.useRealTimers();
  });

  it("EventSource 없으면 no-op unsubscribe (throw X)", async () => {
    const a = createHttpAdapter({
      fetchImpl: vi.fn() as unknown as typeof fetch,
      eventSourceImpl: undefined,
    });
    const unsub = await a.watch(() => {});
    expect(typeof unsub).toBe("function");
    expect(() => unsub()).not.toThrow();
  });
});
