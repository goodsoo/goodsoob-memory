/**
 * vaultCore — 서버 측 vault 파일 IO + git 안전망 (T2)
 *
 * server/index.ts 의 Bun HTTP 레이어에서 분리한 순수 로직 모듈. HTTP 없이
 * 임시 git repo 를 상대로 단위 테스트할 수 있게(테스트 hermetic 유지) 뽑아냈다.
 *
 * 책임:
 *  - path traversal 가드 (adapter.ts:joinAbs 규칙과 동일 — 세그먼트 단위 `..` 차단)
 *  - atomic write (tmp → rename), per-path 직렬화 lock
 *  - lossless 히스토리: 매 write 를 debounce squash 로 git 커밋 (매 write 커밋 X)
 *  - git log 복구 API (history / version at ref)
 *  - readMeta.mtime = 서버 git 커밋 시각 (없으면 disk mtime fallback)
 *
 * ⚠️ 안전: VAULT_DIR 은 호출자가 넘긴다. 이 모듈은 ~/brain 을 절대 default 로 쓰지 않는다.
 * 테스트는 os.tmpdir() 밑 임시 git repo 만 쓴다.
 */

import {
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  existsSync,
  readdirSync,
  writeSync,
  openSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execFile, execFileSync } from "node:child_process";

// ── path 안전 ───────────────────────────────────────────────────────────────
// adapter.ts:joinAbs 와 같은 규칙. substring `..` 이 아니라 세그먼트 단위로 차단해서
// `있다..md` 같은 정상 파일명을 오탐하지 않는다.
export function joinVaultAbs(root: string, rel: string): string {
  if (rel.startsWith("/")) throw new Error(`expected relative path: ${rel}`);
  if (rel.split("/").some((seg) => seg === "..")) {
    throw new Error(`path traversal blocked: ${rel}`);
  }
  const r = root.endsWith("/") ? root.slice(0, -1) : root;
  const p = rel.startsWith("./") ? rel.slice(2) : rel;
  return p === "" ? r : `${r}/${p}`;
}

function toRel(root: string, abs: string): string {
  const r = root.endsWith("/") ? root : root + "/";
  return abs.startsWith(r) ? abs.slice(r.length) : abs;
}

// ── per-path write 직렬화 (adapter.ts:withWriteLock 와 동일 계열) ─────────────
const writeLocks = new Map<string, Promise<unknown>>();
async function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  writeLocks.set(key, next);
  try {
    return await next;
  } finally {
    if (writeLocks.get(key) === next) writeLocks.delete(key);
  }
}

export interface FileMeta {
  mtime: number; // ms epoch — 서버 git 커밋 시각 우선, 없으면 disk mtime
  size: number;
}

export interface HistoryEntry {
  ref: string; // commit hash
  time: number; // ms epoch (committer date)
  message: string;
}

// git index.lock 경합(gbrain 데몬 동시) 시 짧게 대기·재시도. child_process 라
// 락 파일 존재를 직접 못 보므로 exec 실패 메시지로 판정한다.
function isGitLockError(msg: string): boolean {
  return /index\.lock|Unable to create|another git process/i.test(msg);
}

/**
 * VaultCore 인스턴스. root = VAULT_DIR (절대경로). 서버가 부트 시 1개 생성.
 */
export class VaultCore {
  readonly root: string;
  /** 앱 전용 커밋 subtree — git 커밋 메시지·add 범위를 이 prefix 로 한정해
   *  brain git log 오염을 줄인다. 없으면 vault 전체. */
  readonly subtree: string;
  private gitTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPaths = new Set<string>();
  private gitEnabled: boolean;
  private debounceMs: number;
  private commitInFlight: Promise<void> = Promise.resolve();

  constructor(opts: {
    root: string;
    subtree?: string;
    git?: boolean;
    debounceMs?: number;
  }) {
    if (!opts.root) throw new Error("VaultCore: root(VAULT_DIR) 필수");
    this.root = opts.root;
    this.subtree = opts.subtree ?? "";
    this.gitEnabled = opts.git ?? true;
    this.debounceMs = opts.debounceMs ?? 3000;
  }

  private abs(rel: string): string {
    return joinVaultAbs(this.root, rel);
  }

  // ── 읽기 ────────────────────────────────────────────────────────────────
  async read(rel: string): Promise<string> {
    return readFile(this.abs(rel), "utf8");
  }

  async readBinary(rel: string): Promise<Buffer> {
    return readFile(this.abs(rel));
  }

  async exists(rel: string): Promise<boolean> {
    return existsSync(this.abs(rel));
  }

  async readMeta(rel: string): Promise<FileMeta> {
    const abs = this.abs(rel);
    const s = statSync(abs);
    // mtime 소스 = git 커밋 시각 (lossless 모델의 "서버 수신 순서" 표시용).
    // 아직 커밋 안 된(디바운스 대기 중) 파일은 disk mtime fallback.
    let mtime = s.mtimeMs;
    if (this.gitEnabled) {
      const t = this.gitLastCommitTime(rel);
      if (t !== null) mtime = t;
    }
    return { mtime, size: s.size };
  }

  list(subdir: string): string[] {
    const abs = this.abs(subdir);
    if (!existsSync(abs)) return [];
    return readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => (subdir === "" ? e.name : `${subdir}/${e.name}`));
  }

  listRecursive(subdir: string): string[] {
    const results: string[] = [];
    const walk = (rel: string): void => {
      const abs = this.abs(rel);
      if (!existsSync(abs)) return;
      for (const e of readdirSync(abs, { withFileTypes: true })) {
        if (e.name.startsWith(".")) continue;
        const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
        if (e.isFile()) results.push(childRel);
        else if (e.isDirectory()) walk(childRel);
      }
    };
    walk(subdir);
    return results;
  }

  listFoldersRecursive(subdir: string): string[] {
    const results: string[] = [];
    const walk = (rel: string): void => {
      const abs = this.abs(rel);
      if (!existsSync(abs)) return;
      for (const e of readdirSync(abs, { withFileTypes: true })) {
        if (e.name.startsWith(".")) continue;
        if (!e.isDirectory()) continue;
        const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
        results.push(childRel);
        walk(childRel);
      }
    };
    walk(subdir);
    return results;
  }

  // batch scan — dir 아래 모든 파일의 content + meta 를 Promise.all 병렬로 수집.
  async scanAll(dir: string): Promise<Array<{ path: string; content: string; meta: FileMeta }>> {
    // .md 만 읽는다 — listRecursive 는 `_attachments/` 안의 이미지(jpg/png)까지
    // 반환하는데, 그걸 read(utf8)로 읽으면 content 가 거대 문자열이 되어 payload 가
    // 폭발했다(notes 본문 0.4MB인데 scanAll 응답이 1GB — 이미지가 전부 utf8 로
    // 실려서). scanAll 소비자(scanMeetings/scanPortfolio)는 .md 만 쓰고 첨부는
    // 어차피 버리므로 여기서 걸러 읽기·전송·파싱 비용을 모두 없앤다.
    const paths = this.listRecursive(dir).filter((p) => p.endsWith(".md"));
    const results = await Promise.all(
      paths.map(async (rel) => {
        try {
          // meta.mtime = disk mtime (statSync) — git 커밋 시각 조회를 의도적으로
          // 생략. readMeta 는 파일당 gitLastCommitTime → execFileSync("git log")
          // 를 부르는데, 이게 동기 블로킹이라 Promise.all 병렬이 무의미하고 771개
          // 순차 spawn 으로 scanAll 이 ~13초 걸렸다(메모장 사이드바가 수십 초 비어
          // 보이던 진범). scanAll 은 목록 batch 이고 정렬 키는 date→time→mtime 라
          // disk mtime 으로 충분. 정확한 git 커밋 시각이 필요한 개별 파일 열기는
          // readMeta 가 그대로 담당.
          const content = await this.read(rel);
          const s = statSync(this.abs(rel));
          return {
            path: rel,
            content,
            meta: { mtime: s.mtimeMs, size: s.size } as FileMeta,
          };
        } catch {
          return null;
        }
      }),
    );
    return results.filter((e): e is { path: string; content: string; meta: FileMeta } => e !== null);
  }

  // ── 쓰기 (atomic + per-path lock + debounce commit) ──────────────────────
  async write(rel: string, content: string): Promise<FileMeta> {
    const abs = this.abs(rel);
    return withWriteLock(abs, async () => {
      this.atomicWriteText(abs, content);
      const s = statSync(abs);
      this.scheduleCommit(rel);
      return { mtime: s.mtimeMs, size: s.size };
    });
  }

  async writeBinary(rel: string, bytes: Uint8Array): Promise<FileMeta> {
    const abs = this.abs(rel);
    return withWriteLock(abs, async () => {
      this.atomicWriteBinary(abs, bytes);
      const s = statSync(abs);
      this.scheduleCommit(rel);
      return { mtime: s.mtimeMs, size: s.size };
    });
  }

  async delete(rel: string, recursive = false): Promise<void> {
    const abs = this.abs(rel);
    return withWriteLock(abs, async () => {
      rmSync(abs, { recursive, force: true });
      this.scheduleCommit(rel);
    });
  }

  async rename(fromRel: string, toRel: string): Promise<void> {
    const fromAbs = this.abs(fromRel);
    const toAbs = this.abs(toRel);
    return withWriteLock(fromAbs, async () => {
      mkdirSync(dirname(toAbs), { recursive: true });
      renameSync(fromAbs, toAbs);
      this.scheduleCommit(fromRel);
      this.scheduleCommit(toRel);
    });
  }

  async mkdir(rel: string): Promise<void> {
    mkdirSync(this.abs(rel), { recursive: true });
  }

  private atomicWriteText(abs: string, content: string): void {
    mkdirSync(dirname(abs), { recursive: true });
    const tmp = `${abs}.${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}.tmp`;
    // durability: fsync tmp 후 rename (POSIX rename atomic).
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, abs);
  }

  private atomicWriteBinary(abs: string, bytes: Uint8Array): void {
    mkdirSync(dirname(abs), { recursive: true });
    const tmp = `${abs}.${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}.tmp`;
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, abs);
  }

  // ── git 안전망 (debounce squash commit) ──────────────────────────────────
  ensureGit(): void {
    if (!this.gitEnabled) return;
    if (!existsSync(this.root)) mkdirSync(this.root, { recursive: true });
    if (existsSync(join(this.root, ".git"))) return;
    try {
      this.gitSync(["init", "-q"]);
      // 테스트/신규 repo 에서 user.* 없으면 커밋 실패 → 로컬 안전망용 identity 주입.
      this.gitSync(["config", "user.email", "goodsoob-memory@localhost"]);
      this.gitSync(["config", "user.name", "goodsoob-memory server"]);
      this.gitSync(["add", "-A"]);
      this.gitSync(["commit", "-q", "--allow-empty", "-m", "init: vault history 시작"]);
    } catch (e) {
      console.warn("[vault-git] init 실패(무시):", (e as Error).message);
    }
  }

  /** debounce squash — sync 경계(마지막 write 후 debounceMs)에서 한 번만 커밋. */
  private scheduleCommit(rel: string): void {
    if (!this.gitEnabled) return;
    this.pendingPaths.add(rel);
    if (this.gitTimer) clearTimeout(this.gitTimer);
    this.gitTimer = setTimeout(() => {
      this.gitTimer = null;
      void this.commitPending();
    }, this.debounceMs);
  }

  /** 대기 중 커밋을 즉시 flush (서버 종료·명시 sync 경계). */
  async flushCommit(): Promise<void> {
    if (this.gitTimer) {
      clearTimeout(this.gitTimer);
      this.gitTimer = null;
    }
    await this.commitPending();
  }

  private commitPending(): Promise<void> {
    // 커밋 직렬화 — 겹친 flush/timer 가 index.lock 을 스스로 만들지 않게.
    this.commitInFlight = this.commitInFlight.then(() => this.doCommit());
    return this.commitInFlight;
  }

  private async doCommit(): Promise<void> {
    if (this.pendingPaths.size === 0) return;
    const paths = [...this.pendingPaths];
    this.pendingPaths.clear();
    const msg =
      paths.length === 1
        ? `vault: ${paths[0]}`
        : `vault: ${paths.length}개 변경 (${paths[0]} 외)`;
    // add 범위 = subtree 지정 시 그 prefix 만, 아니면 변경 path 만 (전체 add 회피).
    const addArgs = this.subtree ? [this.subtree] : ["-A"];
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await this.gitExec(["add", ...addArgs]);
        await this.gitExec([
          "commit",
          "-q",
          "--allow-empty-message",
          "-m",
          msg,
        ]);
        return;
      } catch (e) {
        const emsg = (e as Error).message || "";
        if (/nothing to commit/.test(emsg)) return; // 정상 (변경 없음)
        if (isGitLockError(emsg) && attempt < 4) {
          await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
          continue;
        }
        console.warn("[vault-git] commit 실패:", emsg);
        return;
      }
    }
  }

  // ── git 히스토리 복구 ────────────────────────────────────────────────────
  /** 파일의 커밋 히스토리 (최신→과거). git 이 꺼졌거나 이력 없으면 []. */
  history(rel: string, limit = 50): HistoryEntry[] {
    if (!this.gitEnabled) return [];
    try {
      const out = this.gitSync([
        "log",
        `-n${limit}`,
        "--format=%H%x1f%ct%x1f%s",
        "--",
        rel,
      ]);
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [ref, ct, ...rest] = line.split("\x1f");
          return {
            ref,
            time: Number(ct) * 1000,
            message: rest.join("\x1f"),
          } as HistoryEntry;
        });
    } catch {
      return [];
    }
  }

  /** 특정 커밋(ref) 시점의 파일 내용. 없으면 null. */
  version(rel: string, ref: string): string | null {
    if (!this.gitEnabled) return null;
    // ref 는 hash/HEAD~N 형태만 허용 — shell 주입·flag 주입 차단.
    if (!/^[0-9a-zA-Z_~^-]+$/.test(ref)) return null;
    try {
      return this.gitSync(["show", `${ref}:${rel}`]);
    } catch {
      return null;
    }
  }

  private gitLastCommitTime(rel: string): number | null {
    try {
      const out = this.gitSync([
        "log",
        "-n1",
        "--format=%ct",
        "--",
        rel,
      ]).trim();
      if (!out) return null;
      return Number(out) * 1000;
    } catch {
      return null;
    }
  }

  private gitSync(args: string[]): string {
    return execFileSync("git", ["-C", this.root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  private gitExec(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        ["-C", this.root, ...args],
        { encoding: "utf8" },
        (err, stdout, stderr) => {
          if (err) {
            const e = new Error(
              (stderr || "") + (stdout || "") + (err.message || ""),
            );
            reject(e);
          } else resolve(stdout);
        },
      );
    });
  }

  // ── watch (chokidar 없이 fs.watch 대신 폴링 대안) ─────────────────────────
  // 서버(index.ts)가 fs.watch 로 이벤트를 만들어 넘기므로 여기선 rel 변환만 제공.
  relOf(abs: string): string {
    return toRel(this.root, abs);
  }
}

// 테스트 유틸 — 경로가 traversal 가드를 통과하는지 (임시 repo 테스트에서 사용).
export function isSubpathSafe(root: string, rel: string): boolean {
  try {
    joinVaultAbs(root, rel);
    return true;
  } catch {
    return false;
  }
}
