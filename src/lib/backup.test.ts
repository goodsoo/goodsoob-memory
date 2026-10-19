import { describe, it, expect } from "vitest";
import {
  deletionsRequiredForNewBackup,
  cleanupOrphanedTmp,
  type BackupEntry,
} from "./backup";
import type { VaultAdapter } from "./vault/adapter";

function entry(filename: string, mtime: number): BackupEntry {
  return { filename, path: `.backups/${filename}`, mtime, size: 1 };
}

describe("deletionsRequiredForNewBackup", () => {
  it("한도 안이면 삭제 없음 (2개 + 신규1 = 3 ≤ keep 3)", () => {
    const entries = [entry("c.zip", 3), entry("b.zip", 2)];
    expect(deletionsRequiredForNewBackup(entries, 3)).toHaveLength(0);
  });

  it("초과하면 가장 오래된 것부터 삭제 대상 (최신순 입력)", () => {
    const entries = [entry("c.zip", 3), entry("b.zip", 2), entry("a.zip", 1)];
    const del = deletionsRequiredForNewBackup(entries, 3); // 3 + 1 - 3 = 1
    expect(del.map((e) => e.filename)).toEqual(["a.zip"]);
  });

  it("keep 를 줄이면 여러 개가 한 번에 삭제 대상", () => {
    const entries = [entry("c.zip", 3), entry("b.zip", 2), entry("a.zip", 1)];
    const del = deletionsRequiredForNewBackup(entries, 1); // 3 + 1 - 1 = 3
    expect(del.map((e) => e.filename)).toEqual(["c.zip", "b.zip", "a.zip"]);
  });
});

describe("cleanupOrphanedTmp", () => {
  function makeAdapter(files: string[]): {
    adapter: VaultAdapter;
    deleted: string[];
  } {
    const deleted: string[] = [];
    const adapter = {
      list: async () => files,
      delete: async (p: string) => {
        deleted.push(p);
      },
    } as unknown as VaultAdapter;
    return { adapter, deleted };
  }

  it(".tmp 고아만 지우고 .zip 백업은 남긴다", async () => {
    const { adapter, deleted } = makeAdapter([
      ".backups/good.zip",
      ".backups/orphan.zip.tmp",
      ".backups/other.tmp",
    ]);
    const n = await cleanupOrphanedTmp(adapter);
    expect(n).toBe(2);
    expect(deleted).toEqual([".backups/orphan.zip.tmp", ".backups/other.tmp"]);
  });

  it("list 실패해도 throw 하지 않고 0 반환", async () => {
    const adapter = {
      list: async () => {
        throw new Error("no dir");
      },
    } as unknown as VaultAdapter;
    expect(await cleanupOrphanedTmp(adapter)).toBe(0);
  });
});
