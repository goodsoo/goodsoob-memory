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

export function selectAdapter(): VaultAdapter {
  if (isTauri) {
    // Tauri desktop — preserves current production behavior (T8 에서 삭제 예정).
    return createTauriAdapter();
  }

  if (import.meta.env.MODE === "test") {
    // Vitest environment — no Tauri APIs available; use in-memory adapter.
    return createMemoryAdapter();
  }

  // Browser / PWA runtime — 같은 origin 의 로컬 서버(server/index.ts, :7080)에 접속.
  return createHttpAdapter();
}
