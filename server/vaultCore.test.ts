/**
 * server git 레이어 테스트 (T2) — 임시 git repo 만 사용, ⚠️ 절대 ~/brain 아님.
 *
 * 커버: write → debounce squash 커밋 → git log 복구, version at ref, path traversal 가드,
 * delete/rename lossless, mtime = git 커밋 시각.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultCore, joinVaultAbs, isSubpathSafe } from "./vaultCore.ts";

let dir: string;

beforeEach(() => {
  // os.tmpdir() 밑 임시 repo — hermetic, ~/brain 과 무관.
  dir = mkdtempSync(join(tmpdir(), "vaultcore-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeCore(debounceMs = 0) {
  const core = new VaultCore({ root: dir, git: true, debounceMs });
  core.ensureGit();
  return core;
}

describe("joinVaultAbs — path traversal 가드 (adapter.ts 규칙 동일)", () => {
  it("진짜 traversal 세그먼트(..) 차단", () => {
    expect(() => joinVaultAbs("/vault", "../leak")).toThrow(/traversal/);
    expect(() => joinVaultAbs("/vault", "work/../leak")).toThrow(/traversal/);
    expect(() => joinVaultAbs("/vault", "..")).toThrow(/traversal/);
  });
  it("절대경로 차단", () => {
    expect(() => joinVaultAbs("/vault", "/etc/passwd")).toThrow(/relative/);
  });
  it("파일명 속 substring '..' 는 정상 통과 (오탐 회귀 방지)", () => {
    expect(joinVaultAbs("/vault", "notes/있다..md")).toBe("/vault/notes/있다..md");
    expect(joinVaultAbs("/vault", "a..b.md")).toBe("/vault/a..b.md");
    expect(isSubpathSafe("/vault", "notes/2,3년차 돌아간다면.. (커뮤글).md")).toBe(
      true,
    );
    expect(isSubpathSafe("/vault", "../escape")).toBe(false);
  });
});

describe("VaultCore git 레이어", () => {
  it("git repo 를 초기화한다", () => {
    makeCore();
    expect(existsSync(join(dir, ".git"))).toBe(true);
  });

  it("write → flush → git log 로 복구 가능 (히스토리 쌓임)", async () => {
    const core = makeCore();
    await core.write("meetings/a.md", "v1");
    await core.flushCommit();
    await core.write("meetings/a.md", "v2");
    await core.flushCommit();

    expect(await core.read("meetings/a.md")).toBe("v2");

    const hist = core.history("meetings/a.md");
    expect(hist.length).toBe(2); // 두 커밋
    // 최신이 앞. version at ref 로 옛 내용 복구.
    const oldContent = core.version("meetings/a.md", hist[1].ref);
    expect(oldContent).toBe("v1");
    const newContent = core.version("meetings/a.md", hist[0].ref);
    expect(newContent).toBe("v2");
  });

  it("debounce squash — 여러 write 가 flush 전엔 한 커밋으로 뭉친다", async () => {
    const core = new VaultCore({ root: dir, git: true, debounceMs: 10000 });
    core.ensureGit();
    await core.write("a.md", "1");
    await core.write("b.md", "2");
    await core.write("a.md", "3");
    // 아직 debounce 안 끝남 → 커밋 0 (init 커밋만 존재)
    const before = execFileSync(
      "git",
      ["-C", dir, "rev-list", "--count", "HEAD"],
      { encoding: "utf8" },
    ).trim();
    await core.flushCommit();
    const after = execFileSync(
      "git",
      ["-C", dir, "rev-list", "--count", "HEAD"],
      { encoding: "utf8" },
    ).trim();
    // 3 write 가 정확히 1 커밋으로 스쿼시.
    expect(Number(after) - Number(before)).toBe(1);
  });

  it("readMeta.mtime = git 커밋 시각(초 단위)", async () => {
    const core = makeCore();
    await core.write("x.md", "hi");
    await core.flushCommit();
    const meta = await core.readMeta("x.md");
    const commitCt = Number(
      execFileSync(
        "git",
        ["-C", dir, "log", "-n1", "--format=%ct", "--", "x.md"],
        { encoding: "utf8" },
      ).trim(),
    );
    expect(meta.mtime).toBe(commitCt * 1000);
    expect(meta.size).toBe(2);
  });

  it("delete 는 lossless — 파일은 사라져도 git 히스토리로 복구", async () => {
    const core = makeCore();
    await core.write("gone.md", "keep me");
    await core.flushCommit();
    await core.delete("gone.md");
    await core.flushCommit();
    expect(await core.exists("gone.md")).toBe(false);
    // 삭제 이전 커밋에서 내용 복구 가능.
    const hist = core.history("gone.md");
    expect(hist.length).toBeGreaterThanOrEqual(1);
    const recovered = core.version("gone.md", hist[hist.length - 1].ref);
    expect(recovered).toBe("keep me");
  });

  it("rename → 새 경로에 내용 유지 + 히스토리", async () => {
    const core = makeCore();
    await core.write("old.md", "body");
    await core.flushCommit();
    await core.rename("old.md", "new.md");
    await core.flushCommit();
    expect(await core.exists("old.md")).toBe(false);
    expect(await core.read("new.md")).toBe("body");
  });

  it("list / listRecursive / listFoldersRecursive", async () => {
    const core = makeCore();
    await core.write("meetings/a.md", "1");
    await core.write("meetings/sub/b.md", "2");
    await core.write("notes/c.md", "3");
    await core.flushCommit();

    expect(core.list("meetings").sort()).toEqual(["meetings/a.md"]);
    expect(core.listRecursive("meetings").sort()).toEqual([
      "meetings/a.md",
      "meetings/sub/b.md",
    ]);
    expect(core.listFoldersRecursive("meetings")).toContain("meetings/sub");
  });

  it("write 가 traversal 을 거부한다", async () => {
    const core = makeCore();
    await expect(core.write("../escape.md", "x")).rejects.toThrow(/traversal/);
  });

  it("version — 잘못된 ref 형식은 null (주입 방지)", async () => {
    const core = makeCore();
    await core.write("a.md", "1");
    await core.flushCommit();
    expect(core.version("a.md", "HEAD; rm -rf /")).toBeNull();
  });

  it("git 꺼지면 history/version 은 빈 결과", async () => {
    const core = new VaultCore({ root: dir, git: false });
    await core.write("a.md", "1");
    expect(core.history("a.md")).toEqual([]);
    expect(core.version("a.md", "HEAD")).toBeNull();
    expect(await core.read("a.md")).toBe("1");
  });
});
