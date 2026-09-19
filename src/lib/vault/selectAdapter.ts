/**
 * Adapter selection seam
 *
 * Single decision point for which VaultAdapter implementation to use at runtime.
 * Call selectAdapter() once during app boot (e.g. VaultProvider initializer).
 *
 * Decision order:
 *   1. Test env       → createMemoryAdapter()  (vitest sets import.meta.env.MODE = "test")
 *   2. Browser / PWA  → createOfflineAdapter(createHttpAdapter())
 */

import { createMemoryAdapter, type VaultAdapter } from "./adapter";
import { createHttpAdapter } from "./httpAdapter";
import { createOfflineAdapter } from "./offlineAdapter";

export function selectAdapter(): VaultAdapter {
  if (import.meta.env.MODE === "test") {
    // Vitest environment — no server available; use in-memory adapter.
    return createMemoryAdapter();
  }

  // Browser / PWA runtime — 같은 origin 의 로컬 서버(server/index.ts)에 http 로 접속하되,
  // capture outbox 로 감싸 오프라인/서버다운 시 쓰기를 큐잉. 온라인 복귀·포그라운드에
  // flush. 읽기는 온라인 위임.
  return createOfflineAdapter({ inner: createHttpAdapter() });
}
