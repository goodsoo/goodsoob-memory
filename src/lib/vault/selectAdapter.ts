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

export function selectAdapter(): VaultAdapter {
  if (isTauri) {
    // Tauri desktop — preserves current production behavior.
    return createTauriAdapter();
  }

  if (import.meta.env.MODE === "test") {
    // Vitest environment — no Tauri APIs available; use in-memory adapter.
    return createMemoryAdapter();
  }

  // Browser / PWA runtime — HTTP adapter will be wired here in T2.
  // TODO T2: return createHttpAdapter();
  throw new Error(
    "HTTP adapter not yet implemented (T2). " +
      "Running in a non-Tauri browser context is not supported yet.",
  );
}
