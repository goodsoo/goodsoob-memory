export interface FileMeta {
  mtime: number; // ms epoch
  size: number;
}

export type VaultWatchEvent =
  | { type: "created"; path: string }
  | { type: "modified"; path: string }
  | { type: "deleted"; path: string }
  | { type: "renamed"; from: string; to: string };

export class ConflictError extends Error {
  path: string;
  expectedMtime: number;
  actualMtime: number;
  constructor(path: string, expectedMtime: number, actualMtime: number) {
    super(
      `vault conflict: ${path} mtime ${actualMtime} ≠ expected ${expectedMtime}`,
    );
    this.name = "ConflictError";
    this.path = path;
    this.expectedMtime = expectedMtime;
    this.actualMtime = actualMtime;
  }
}

export interface ScanEntry {
  path: string;
  content: string;
  meta: FileMeta;
}

export interface VaultAdapter {
  setRoot(absPath: string): void;
  getRoot(): string | null;

  list(subdir: string): Promise<string[]>;
  // 재귀 scan — subdir 아래 모든 깊이의 파일 path 를 vault root 기준 상대 path 로
  // 반환. nested folder 지원하는 sidebar 트리 build 용 (`notes/{folder}/x.md`).
  // dot-prefix 폴더/파일은 skip (`.trash/`, `.icloud` placeholder 등).
  listRecursive(subdir: string): Promise<string[]>;
  // 폴더만 재귀 scan — subdir 자신 제외, 빈 폴더도 포함. 옵시디안 모델대로 메모
  // 0개 폴더도 트리에 보이게 하기 위함. dot-prefix 제외.
  listFoldersRecursive(subdir: string): Promise<string[]>;
  read(relPath: string): Promise<string>;
  readMeta(relPath: string): Promise<FileMeta>;
  // batch scan — dir 아래 모든 파일의 content + meta 를 한 번에 반환.
  // HTTP adapter 에서는 서버 batch 엔드포인트 1회 호출로 처리.
  // Tauri/memory adapter 에서는 로컬 병렬 read+readMeta.
  scanAll(dir: string): Promise<ScanEntry[]>;
  // expectedMtime: 마지막으로 읽었을 때의 mtime. 디스크가 더 새 거면 ConflictError throw.
  write(
    relPath: string,
    content: string,
    expectedMtime?: number,
  ): Promise<FileMeta>;
  // 바이너리 write — 이미지 paste/drop attachments 저장용. text write 와 같은 atomic
  // tmp→rename 패턴 + per-path lock 공유 (md 파일과 동시 쓰기 race 차단).
  writeBinary(relPath: string, bytes: Uint8Array): Promise<FileMeta>;
  // recursive=true 면 디렉토리 + 내부 모든 콘텐츠 삭제. 폴더 삭제용.
  // (메모 본체는 호출자가 먼저 휴지통 이동 후 빈 디렉토리 청소 용도.)
  delete(relPath: string, options?: { recursive?: boolean }): Promise<void>;
  rename(fromRel: string, toRel: string): Promise<void>;
  exists(relPath: string): Promise<boolean>;
  mkdir(relPath: string): Promise<void>;

  watch(callback: (event: VaultWatchEvent) => void): Promise<() => void>;
}

// export 는 테스트용 — 경로 traversal 가드가 정상 파일명을 오탐하지 않는지 회귀 검증.
export function joinAbs(root: string, rel: string): string {
  if (rel.startsWith("/")) throw new Error(`expected relative path: ${rel}`);
  // path traversal 차단은 경로 "세그먼트" 단위로 — substring `..` 검사는 제목이
  // 마침표로 끝나는 노트(`있다.` → `있다..md`)나 `2,3년차.. (커뮤글).md` 같은 정상
  // 파일명을 오탐해 read 가 throw → scanMeetings 가 그 노트를 통째 skip(사이드바에서
  // 사라짐) 시키던 버그. `../` 등 진짜 traversal 세그먼트만 차단한다.
  if (rel.split("/").some((seg) => seg === "..")) {
    throw new Error(`path traversal blocked: ${rel}`);
  }
  const r = root.endsWith("/") ? root.slice(0, -1) : root;
  const p = rel.startsWith("./") ? rel.slice(2) : rel;
  return p === "" ? r : `${r}/${p}`;
}

// 같은 abs path 에 대한 write 직렬화. 두 동시 write 가 공유 tmp 를 만져
// 첫 번째 rename 으로 tmp 소진 → 두 번째 remove 가 결과 파일 삭제 → 두 번째
// rename 이 ENOENT 떨어지며 파일이 진짜 사라지는 race 차단. POSIX rename 자체는
// atomic 이지만 'remove → rename' 시퀀스는 비-원자라 lock 필요.
const writeLocks = new Map<string, Promise<unknown>>();
export async function withWriteLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = writeLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  writeLocks.set(key, next);
  try {
    return await next;
  } finally {
    if (writeLocks.get(key) === next) writeLocks.delete(key);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory adapter (테스트용)

export function createMemoryAdapter(): VaultAdapter & {
  __trigger(event: VaultWatchEvent): void;
  __dump(): Map<string, { content: string; mtime: number }>;
  __dumpBinary(): Map<string, { bytes: Uint8Array; mtime: number }>;
} {
  let root: string | null = null;
  const files = new Map<string, { content: string; mtime: number }>();
  const binaryFiles = new Map<string, { bytes: Uint8Array; mtime: number }>();
  const dirs = new Set<string>();
  const watchers = new Set<(e: VaultWatchEvent) => void>();
  let clock = 1_700_000_000_000;
  const tick = () => (clock += 1500);

  const requireRoot = (): string => {
    if (!root) throw new Error("vault root not set");
    return root;
  };

  return {
    setRoot(absPath: string) {
      root = absPath;
    },
    getRoot() {
      return root;
    },

    async list(subdir: string): Promise<string[]> {
      requireRoot();
      const prefix = subdir === "" ? "" : subdir + "/";
      const result: string[] = [];
      const allPaths = new Set([...files.keys(), ...binaryFiles.keys()]);
      for (const path of allPaths) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        // 직속 자식만 (한 단계 깊이)
        if (rest.includes("/")) continue;
        if (rest.startsWith(".")) continue;
        result.push(path);
      }
      return result;
    },

    async listRecursive(subdir: string): Promise<string[]> {
      requireRoot();
      const prefix = subdir === "" ? "" : subdir + "/";
      const result: string[] = [];
      const allPaths = new Set([...files.keys(), ...binaryFiles.keys()]);
      for (const path of allPaths) {
        if (subdir !== "" && !path.startsWith(prefix)) continue;
        const rest = subdir === "" ? path : path.slice(prefix.length);
        // dot-prefix 가 path 어디든 끼면 skip (`.trash/x.md`, `foo/.x.md`).
        if (rest.split("/").some((seg) => seg.startsWith("."))) continue;
        result.push(path);
      }
      return result;
    },

    async listFoldersRecursive(subdir: string): Promise<string[]> {
      requireRoot();
      const folders = new Set<string>();
      const prefix = subdir === "" ? "" : subdir + "/";

      // file path 든 mkdir 된 dir 든 그 path 의 모든 조상 폴더를 set 에 추가.
      // treatAsFile=true 면 leaf segment 는 폴더 아님 (filename), false 면 leaf 도 폴더.
      const collect = (fullPath: string, treatAsFile: boolean): void => {
        if (subdir !== "" && !fullPath.startsWith(prefix)) return;
        const rest = subdir === "" ? fullPath : fullPath.slice(prefix.length);
        if (rest === "") return; // subdir 자신
        const segs = rest.split("/").filter(Boolean);
        const lastFolderIdx = treatAsFile ? segs.length - 1 : segs.length;
        for (let i = 1; i <= lastFolderIdx; i++) {
          const folderSegs = segs.slice(0, i);
          if (folderSegs.some((s) => s.startsWith("."))) return;
          const full =
            subdir === ""
              ? folderSegs.join("/")
              : `${subdir}/${folderSegs.join("/")}`;
          folders.add(full);
        }
      };

      for (const fp of files.keys()) collect(fp, true);
      for (const dp of dirs) collect(dp, false);

      return [...folders];
    },

    async read(relPath: string): Promise<string> {
      requireRoot();
      const f = files.get(relPath);
      if (!f) throw new Error(`ENOENT: ${relPath}`);
      return f.content;
    },

    async readMeta(relPath: string): Promise<FileMeta> {
      requireRoot();
      const f = files.get(relPath);
      if (!f) throw new Error(`ENOENT: ${relPath}`);
      return { mtime: f.mtime, size: f.content.length };
    },

    async write(
      relPath: string,
      content: string,
      expectedMtime?: number,
    ): Promise<FileMeta> {
      requireRoot();
      if (expectedMtime !== undefined) {
        const existing = files.get(relPath);
        if (existing && Math.abs(existing.mtime - expectedMtime) > 1000) {
          throw new ConflictError(relPath, expectedMtime, existing.mtime);
        }
      }
      const mtime = tick();
      files.set(relPath, { content, mtime });
      const event: VaultWatchEvent = { type: "modified", path: relPath };
      for (const w of watchers) w(event);
      return { mtime, size: content.length };
    },

    async writeBinary(
      relPath: string,
      bytes: Uint8Array,
    ): Promise<FileMeta> {
      requireRoot();
      const mtime = tick();
      binaryFiles.set(relPath, { bytes, mtime });
      const event: VaultWatchEvent = { type: "modified", path: relPath };
      for (const w of watchers) w(event);
      return { mtime, size: bytes.byteLength };
    },

    async delete(
      relPath: string,
      options?: { recursive?: boolean },
    ): Promise<void> {
      requireRoot();
      if (options?.recursive === true) {
        const prefix = relPath + "/";
        const removed: string[] = [];
        for (const p of files.keys()) {
          if (p === relPath || p.startsWith(prefix)) removed.push(p);
        }
        for (const p of removed) {
          files.delete(p);
          for (const w of watchers) w({ type: "deleted", path: p });
        }
        const removedBinary: string[] = [];
        for (const p of binaryFiles.keys()) {
          if (p === relPath || p.startsWith(prefix)) removedBinary.push(p);
        }
        for (const p of removedBinary) {
          binaryFiles.delete(p);
          for (const w of watchers) w({ type: "deleted", path: p });
        }
        const removedDirs: string[] = [];
        for (const d of dirs) {
          if (d === relPath || d.startsWith(prefix)) removedDirs.push(d);
        }
        for (const d of removedDirs) dirs.delete(d);
        return;
      }
      files.delete(relPath);
      binaryFiles.delete(relPath);
      dirs.delete(relPath);
      for (const w of watchers) w({ type: "deleted", path: relPath });
    },

    async rename(fromRel: string, toRel: string): Promise<void> {
      requireRoot();
      // 파일 케이스: 1:1 rename.
      const file = files.get(fromRel);
      if (file) {
        files.delete(fromRel);
        files.set(toRel, { ...file, mtime: tick() });
        for (const w of watchers) w({ type: "renamed", from: fromRel, to: toRel });
        return;
      }
      // 디렉토리 케이스: prefix 매치하는 모든 file + dir 같이 이동. POSIX `mv` 동등.
      const prefix = fromRel + "/";
      let movedAny = false;
      const fileMoves: Array<[string, string]> = [];
      for (const p of files.keys()) {
        if (p.startsWith(prefix)) {
          fileMoves.push([p, toRel + "/" + p.slice(prefix.length)]);
        }
      }
      for (const [from, to] of fileMoves) {
        const f = files.get(from)!;
        files.delete(from);
        files.set(to, { ...f, mtime: tick() });
        for (const w of watchers) w({ type: "renamed", from, to });
        movedAny = true;
      }
      // dirs set 도 같이 이동 (mkdir 된 빈 폴더 보존).
      if (dirs.has(fromRel)) {
        dirs.delete(fromRel);
        dirs.add(toRel);
        movedAny = true;
      }
      for (const d of [...dirs]) {
        if (d.startsWith(prefix)) {
          dirs.delete(d);
          dirs.add(toRel + "/" + d.slice(prefix.length));
          movedAny = true;
        }
      }
      if (!movedAny) throw new Error(`ENOENT: ${fromRel}`);
    },

    async exists(relPath: string): Promise<boolean> {
      requireRoot();
      return files.has(relPath) || binaryFiles.has(relPath) || dirs.has(relPath);
    },

    async mkdir(relPath: string): Promise<void> {
      requireRoot();
      dirs.add(relPath);
    },

    async scanAll(dir: string): Promise<ScanEntry[]> {
      requireRoot();
      const paths = await this.listRecursive(dir);
      const entries = await Promise.all(
        paths.map(async (path) => {
          try {
            const [content, meta] = await Promise.all([
              this.read(path),
              this.readMeta(path),
            ]);
            return { path, content, meta } satisfies ScanEntry;
          } catch {
            return null;
          }
        }),
      );
      return entries.filter((e): e is ScanEntry => e !== null);
    },

    async watch(
      callback: (event: VaultWatchEvent) => void,
    ): Promise<() => void> {
      watchers.add(callback);
      return () => watchers.delete(callback);
    },

    __trigger(event: VaultWatchEvent) {
      for (const w of watchers) w(event);
    },
    __dump() {
      return new Map(files);
    },
    __dumpBinary() {
      return new Map(binaryFiles);
    },
  };
}
