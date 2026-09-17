/**
 * Adapter selection seam (T1)
 *
 * Single decision point for which VaultAdapter implementation to use at runtime.
 * Call selectAdapter() once during app boot (e.g. VaultProvider initializer).
 *
 * Decision order:
 *   1. Tauri desktop  → createTauriAdapter()   (current production path)
 *   2. Test env       → createMemoryAdapter()  (vitest sets import.meta.env.MODE = "test")
 *   3. Browser / PWA  → TODO T2: createHttpAdapter() (not yet implemented)
 */

import { isTauri } from "../isTauri";
import { createTauriAdapter, createMemoryAdapter, type VaultAdapter } from "./adapter";
import { createHttpAdapter } from "./httpAdapter";
import { createOfflineAdapter } from "./offlineAdapter";

export function selectAdapter(): VaultAdapter {
  if (isTauri) {
    // Tauri desktop — preserves current production behavior (T8 에서 삭제 예정).
    return createTauriAdapter();
  }

  if (import.meta.env.MODE === "test") {
    // Vitest environment — no Tauri APIs available; use in-memory adapter.
    return createMemoryAdapter();
  }

  // Browser / PWA runtime — 같은 origin 의 로컬 서버(server/index.ts)에 http 로 접속하되,
  // capture outbox 로 감싸 오프라인/서버다운 시 쓰기를 큐잉(T5). 온라인 복귀·포그라운드에
  // flush. 읽기는 온라인 위임(T6 이 캐시 추가).
  return createOfflineAdapter({ inner: createHttpAdapter() });
}
