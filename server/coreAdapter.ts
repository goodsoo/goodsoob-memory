/**
 * coreAdapter — 서버 안에서 VaultCore 를 클라 `VaultAdapter` 인터페이스로 감싼다.
 *
 * 목적: `src/api/meetings.ts`(createMeeting·updateMeeting 등)와 `src/lib/vault/scan.ts` 의
 * 메모 파일 모델 코드를 서버(녹음 link/unlink)가 그대로 재사용하기 위함. 쓰기는 전부
 * VaultCore 경유 — atomic tmp→rename + per-path lock 을 /api/vault/write 와 공유한다
 * (같은 VaultCore 인스턴스를 넘겨야 lock 이 공유됨).
 *
 * expectedMtime 은 /api/vault/write 와 동일하게 무시(no-op).
 */

import type { VaultAdapter, ScanEntry } from "../src/lib/vault/adapter.ts";
import type { VaultCore } from "./vaultCore.ts";

export function coreAdapter(vault: VaultCore): VaultAdapter {
  return {
    setRoot() {
      /* 서버는 VAULT_DIR 고정 */
    },
    getRoot: () => vault.root,
    list: async (subdir) => vault.list(subdir),
    listRecursive: async (subdir) => vault.listRecursive(subdir),
    listFoldersRecursive: async (subdir) => vault.listFoldersRecursive(subdir),
    read: (rel) => vault.read(rel),
    readMeta: (rel) => vault.readMeta(rel),
    scanAll: (dir) => vault.scanAll(dir) as Promise<ScanEntry[]>,
    write: (rel, content) => vault.write(rel, content),
    writeBinary: (rel, bytes) => vault.writeBinary(rel, bytes),
    delete: (rel, options) => vault.delete(rel, options?.recursive === true),
    rename: (from, to) => vault.rename(from, to),
    exists: (rel) => vault.exists(rel),
    mkdir: (rel) => vault.mkdir(rel),
    watch: async () => () => {},
  };
}
