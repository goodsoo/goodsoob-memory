import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryAdapter } from "./adapter";
import { createVaultWatcher } from "./watcher";

describe("VaultWatcher", () => {
  it("vault 의 modified 이벤트 → 영향 query key invalidate", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await adapter.write("notes/2026-05-16-test.md", "# 본문\n초기\n");

    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const watcher = createVaultWatcher(adapter, qc);
    await watcher.start();

    // 외부 변경 시뮬 (다른 source 가 modified 이벤트 발행)
    adapter.__trigger({
      type: "modified",
      path: "notes/2026-05-16-test.md",
    });

    // debounce 100ms 대기
    await new Promise((r) => setTimeout(r, 150));

    expect(invalidateSpy).toHaveBeenCalled();
    const calls = invalidateSpy.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown }).queryKey),
    );
    expect(calls.some((c) => c.includes("meetings"))).toBe(true);
    // 할 일 탭 은퇴 — 메모 변경이 todos 를 더 이상 건드리지 않는다.
    expect(calls.some((c) => c.includes("todos"))).toBe(false);

    watcher.stop();
  });

  it("portfolio/* 변경 → portfolio query key invalidate", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const watcher = createVaultWatcher(adapter, qc);
    await watcher.start();

    adapter.__trigger({
      type: "modified",
      path: "portfolio/owner-repo-1.md",
    });
    await new Promise((r) => setTimeout(r, 150));

    const calls = invalidateSpy.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown }).queryKey),
    );
    expect(calls.some((c) => c.includes("portfolio"))).toBe(true);

    watcher.stop();
  });

  it("우리가 직접 write 한 직후의 modified 이벤트는 무시 (selfWriteWindow)", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");

    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const watcher = createVaultWatcher(adapter, qc, { selfWriteWindowMs: 500 });
    await watcher.start();

    // 자기 write 등록 → 그 직후 modified 이벤트 발행
    const path = "notes/2026-05-16-test.md";
    watcher.markSelfWrite(path);
    adapter.__trigger({ type: "modified", path });

    await new Promise((r) => setTimeout(r, 150));

    expect(invalidateSpy).not.toHaveBeenCalled();

    watcher.stop();
  });

  it("한 write 의 여러 echo 이벤트를 window 내내 모두 무시 (create+modify 연속)", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");

    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const watcher = createVaultWatcher(adapter, qc, { selfWriteWindowMs: 500 });
    await watcher.start();

    // notify-rs 는 한 번의 write 에 created + modified 를 잇따라 쏠 수 있다.
    // 첫 매칭에서 self-write 표시를 지워버리면 두 번째 echo 가 invalidate 로 샌다.
    const path = "notes/2026-05-16-test.md";
    watcher.markSelfWrite(path);
    adapter.__trigger({ type: "created", path });
    adapter.__trigger({ type: "modified", path });

    await new Promise((r) => setTimeout(r, 150));

    expect(invalidateSpy).not.toHaveBeenCalled();

    watcher.stop();
  });
});
