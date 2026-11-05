/**
 * recordings — 녹음 탭 서버 로직 (PR1: 목록 · 오디오 서빙 · 행선지 link/unlink,
 * PR2: diarize/corrections job 시작 · job.json 생존 판정,
 * 개편: 삭제(휴지통 이동) · 작업 파일 GET/PUT · 교정 완료 · 교정 후보 리뷰 상태).
 *
 * 설계 = docs/designs/recording-tab.md (이사 메커니즘) + docs/designs/recording-redesign.md
 * (D-R1 교정 완료 전 연결 금지 · D-R3 보관 제거 · D-R4 삭제 · D-R7 하이라이트 리뷰).
 * 순수 규칙은 src/lib/recordings/* (base 파싱·섹션 조작·상태 계산)를 그대로 쓰고,
 * 여기는 디스크 사실 수집 + 이사 순서(①~④) + 락만 담당한다.
 *
 * 디스크 레이아웃 (vault root 기준):
 *   _audio/<base>.m4a              녹음 원본 (부산물 — 지워질 수 있음)
 *   _audio/<base>.txt              교정본 (연결하면 메모 사이드카로 이사 후 삭제)
 *   _audio/.stt/<base>/            auto_stt·job 산출물 + 마커
 *     done / moved.json / anchored.json / review.json / 화자분리.txt
 *     tr.txt (whisper 초벌) / job.json / meta.json (ffprobe 캐시) / play.m4a (비 aac 변환본)
 *     raw-promoted (옛 초벌 승격 마커 — 읽기만) / archived (옛 보관 마커 — 무시)
 *
 * 쓰기는 전부 VaultCore(atomic tmp→rename, per-path lock) 경유 — /api/vault/write 와 같은
 * 인스턴스를 넘겨야 lock 이 공유된다. 예외: 삭제는 vault 밖(~/.Trash)으로 옮기므로 node:fs 직접.
 */

import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  type Dirent,
} from "node:fs";
import { execFile, execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { JobFile, JobKind } from "./jobRunner.ts";
import { VaultCore, joinVaultAbs } from "./vaultCore.ts";
import { coreAdapter } from "./coreAdapter.ts";
import type { VaultAdapter } from "../src/lib/vault/adapter.ts";
import {
  fileToMeeting,
  isNonNotePath,
  meetingMainPath,
  normalizeFolderPath,
  patchMeetingFrontmatter,
  slugify,
  transcriptPath,
  TitleConflictError,
} from "../src/lib/vault/scan.ts";
import { createMeeting, getMeeting, type Meeting } from "../src/api/meetings.ts";
import {
  baseSortKey,
  baseTimeLabel,
  compareBases,
  normalizeAudioList,
  parseBase,
  type ParsedBase,
} from "../src/lib/recordings/base.ts";
import {
  findSection,
  insertSection,
  removeSection,
  sectionHash,
} from "../src/lib/recordings/sections.ts";

export const AUDIO_DIR = "_audio";
export const STT_DIR = "_audio/.stt";

// ── 응답 타입 ────────────────────────────────────────────────────────────────

export interface RecordingSttMarkers {
  done: boolean;
  moved: boolean; // moved.json
  rawPromoted: boolean; // 옛 초벌 승격 마커 (D-R1 이후 새로 쓰지 않음)
  anchored: boolean; // anchored.json
  diarized: boolean; // 화자분리.txt
  /** anchored.json 항목 중 review.json 에 결정이 없는 수. anchored 없으면 0. */
  reviewLeft: number;
}

export interface RecordingJob {
  state: string; // running | done | error
  /** running 일 때 pid 생존 + lstart 일치. 죽은 running 은 목록 조회 때 error:"interrupted" 로 바뀐다. */
  pidAlive: boolean;
  step?: string;
  error?: string; // "interrupted" = runner 가 비정상 종료(서버가 감지)
  kind?: JobKind;
  failedChunks?: number[]; // 재시도까지 실패한 청크 번호(1부터) — "실패 청크만 재실행" 가능
  anchorMisses?: number; // anchored.json 에서 위치를 못 찾아 t=0 인 항목 수
}

export interface DiarizeRequest {
  speakers?: number; // 1..10 고정, 생략·0 = 자동 (diarize.py 가 화자 수 추정)
  names?: string[]; // 화자 index(첫 등장) 순 이름 (없으면 화자N), 최대 speakers 개(자동이면 10)
}

export interface CorrectionsRequest {
  retryFailed?: boolean; // true = corrections.partial.json 의 실패 청크만 재실행
}

export interface JobStartResponse {
  job: RecordingJob;
}

export interface RecordingEntry {
  base: string;
  parsed: ParsedBase;
  hasM4a: boolean;
  hasTxt: boolean;
  stt: RecordingSttMarkers;
  job: RecordingJob | null;
  durationSec: number | null;
  /** ffprobe format creation_time (base 이름에 날짜가 없을 때 fallback 표시용). */
  creationTime: string | null;
  /** m4a 가 iCloud dataless(미다운로드) — ffprobe·재생 보류, "동기화 대기" 표시. */
  syncPending: boolean;
  /**
   * moved.json 이 있고 클라이언트가 `known` 으로 넘기지 않은 base 에 한해 계산.
   * string = ` · <base>` 헤딩을 가진 사이드카의 메인 메모 path, false = 어디에도 없음,
   * 필드 없음 = 확인 안 함.
   */
  orphan?: string | false;
  /** 작업 파일(화자분리.txt → _audio/<base>.txt → tr.txt) 첫 발화 ≈60자 (식별용). */
  firstLine: string | null;
}

export interface RecordingsListResponse {
  recordings: RecordingEntry[];
}

export interface LinkRequest {
  memo?: string; // vault 상대 메모 메인 path
  newMemo?: { title: string; folder?: string };
}

export interface LinkResponse {
  meeting: Meeting; // 디스크에서 다시 읽은 메모 (클라 form reset 용)
  insertedSection: boolean; // false = 이미 헤딩 있음(멱등 재실행, 이사 미완료 복구)
  raw: boolean; // 옛 raw-promoted 마커가 남아 있는가 (D-R1 이후 새 연결은 항상 false)
  created: boolean; // newMemo 로 생성했는가
}

export interface UnlinkResponse {
  meeting: Meeting;
  /** true = 섹션 헤딩을 못 찾아 텍스트는 메모에 그대로 둠 ("전사본은 메모에 남아 있습니다"). */
  textKept: boolean;
}

export interface DeleteRequest {
  bases: string[];
}

export interface DeleteResponse {
  deleted: string[];
  failed: Array<{ base: string; code: string; error: string }>;
}

export type TranscriptSource = "diarized" | "corrected" | "raw";

export interface TranscriptResponse {
  text: string;
  source: TranscriptSource;
  mtime: number;
}

export interface TranscriptPutRequest {
  text: string;
  mtime: number;
}

export type ReviewDecision = "accepted" | "kept" | "edited";

export interface ReviewItem {
  id: number;
  t: number;
  type: string;
  conf?: string;
  orig: string;
  sugg: string;
  hl?: [string, string];
  note?: string;
  global?: boolean;
}

export interface ReviewResponse {
  items: ReviewItem[];
  decisions: Record<string, ReviewDecision>;
}

export class RecordingError extends Error {
  status: number;
  code: string;
  /** 응답 본문에 함께 실을 필드 (예: conflict 의 현재 mtime). */
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RecordingError";
    this.status = status;
    this.code = code;
  }
}

// ── 외부 의존 (테스트에서 주입) ─────────────────────────────────────────────

export interface ProbeResult {
  durationSec: number | null;
  codec: string | null;
  creationTime: string | null;
}

export interface RecordingsDeps {
  vault: VaultCore;
  adapter?: VaultAdapter;
  probe?: (abs: string) => Promise<ProbeResult | null>;
  transcode?: (src: string, dst: string) => Promise<void>;
  isDataless?: (abs: string) => boolean;
  requestDownload?: (abs: string) => void;
  pidAlive?: (pid: number) => boolean;
  /** Bun 에선 `new Response(Bun.file(abs), {headers})` — Range → 206 은 Bun.serve 가 처리. */
  fileResponse?: (abs: string, headers: Record<string, string>) => Response;
  /** `ps -o lstart= -p <pid>` — pid 재사용 판정. null = 알 수 없음/프로세스 없음. */
  procStart?: (pid: number) => string | null;
  /** Pro 가드 — job 은 `~/.auto-stt-enabled` 가 있는 맥에서만. */
  proCheck?: () => { ok: boolean; reason?: string };
  /** jobRunner detached spawn → pid. */
  spawnJob?: (args: SpawnJobArgs) => { pid: number };
  /** 삭제 대상 폴더 (기본 `~/.Trash/goodsoob-녹음`). ⚠️ 테스트는 반드시 주입. */
  trashDir?: string;
  /** 휴지통 폴더 이름의 시각 (테스트 주입). */
  now?: () => Date;
}

export interface SpawnJobArgs {
  vaultDir: string;
  base: string;
  kind: JobKind;
  speakers?: number;
  names?: string[];
  /** stdout/stderr 를 붙일 로그 파일 (abs). */
  logPath: string;
}

// launchd 최소 PATH 에선 brew 바이너리가 안 보이므로 절대경로 후보를 먼저 본다.
function findBin(name: string): string | null {
  for (const dir of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]) {
    const p = `${dir}/${name}`;
    if (existsSync(p)) return p;
  }
  return null;
}

function execFileP(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 4 << 20 }, (e, out, errOut) => {
      if (e) reject(new Error(`${errOut || ""}${e.message}`));
      else resolve(out);
    });
  });
}

export async function defaultProbe(abs: string): Promise<ProbeResult | null> {
  const bin = findBin("ffprobe");
  if (!bin) return null;
  try {
    const out = await execFileP(
      bin,
      [
        "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=codec_name:format=duration:format_tags=creation_time",
        "-of", "json",
        abs,
      ],
      30_000,
    );
    const j = JSON.parse(out) as {
      streams?: Array<{ codec_name?: string }>;
      format?: { duration?: string; tags?: { creation_time?: string } };
    };
    const d = Number(j.format?.duration);
    return {
      durationSec: Number.isFinite(d) ? d : null,
      codec: j.streams?.[0]?.codec_name ?? null,
      creationTime: j.format?.tags?.creation_time ?? null,
    };
  } catch (e) {
    console.warn("[recordings] ffprobe 실패:", abs, (e as Error).message);
    return null;
  }
}

export async function defaultTranscode(src: string, dst: string): Promise<void> {
  const bin = findBin("ffmpeg");
  if (!bin) throw new RecordingError(503, "noFfmpeg", "이 맥에는 ffmpeg 가 없어 재생용 변환을 할 수 없습니다.");
  await execFileP(bin, ["-v", "error", "-y", "-i", src, "-vn", "-c:a", "aac", "-b:a", "128k", "-f", "mp4", dst], 15 * 60_000);
}

// iCloud dataless(evict 된) 파일 = 크기는 있는데 할당 블록 0. node stat 은 st_flags 를
// 안 주므로 blocks 로 판정 (`ls -lO` 의 `dataless` 와 같은 상태).
export function defaultIsDataless(abs: string): boolean {
  try {
    const s = statSync(abs);
    return s.size > 0 && s.blocks === 0;
  } catch {
    return false;
  }
}

function defaultRequestDownload(abs: string): void {
  try {
    const child = spawn("/usr/bin/brctl", ["download", abs], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* ignore — 다음 요청에서 다시 시도 */
  }
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function defaultProcStart(pid: number): string | null {
  try {
    const out = execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 5_000 });
    const s = out.trim().replace(/\s+/g, " ");
    return s === "" ? null : s;
  } catch {
    return null;
  }
}

export const PRO_MARKER = ".auto-stt-enabled";

export function defaultProCheck(): { ok: boolean; reason?: string } {
  if (existsSync(join(homedir(), PRO_MARKER))) return { ok: true };
  return { ok: false, reason: `이 맥은 전사 작업용 맥이 아닙니다 (~/${PRO_MARKER} 없음). Pro 맥에서 실행하세요.` };
}

const JOB_RUNNER = fileURLToPath(new URL("./jobRunner.ts", import.meta.url));

/** `bun server/jobRunner.ts <vault> <base> <kind> [speakers] [names...]` — detached + unref (서버 재시작에도 생존). */
export function defaultSpawnJob(a: SpawnJobArgs): { pid: number } {
  const argv = [JOB_RUNNER, a.vaultDir, a.base, a.kind];
  if (a.kind === "diarize") argv.push(String(a.speakers), ...(a.names ?? []));
  const fd = openSync(a.logPath, "a");
  try {
    // 서버는 bun 으로 돈다 → process.execPath = bun. PATH 는 launchd 최소 + brew.
    const child = spawn(process.execPath, argv, {
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/bin:/bin" },
    });
    child.on("error", (e) => console.error("[recordings] jobRunner spawn 실패:", e));
    if (!child.pid) throw new Error("jobRunner 를 시작하지 못했습니다");
    child.unref();
    return { pid: child.pid };
  } finally {
    closeSync(fd);
  }
}

function defaultFileResponse(abs: string, headers: Record<string, string>): Response {
  const B = (globalThis as unknown as { Bun?: { file(p: string): Blob } }).Bun;
  if (!B) throw new RecordingError(500, "noBun", "Bun 런타임에서만 오디오를 서빙합니다.");
  return new Response(B.file(abs), { headers });
}

// ── 검증 ─────────────────────────────────────────────────────────────────────

const BASE_RE = /^[^/\\]+$/;

export function assertValidBase(base: string | null | undefined): string {
  if (typeof base !== "string" || !BASE_RE.test(base) || base === "." || base === ".." || base.startsWith(".")) {
    throw new RecordingError(400, "badBase", `잘못된 녹음 이름입니다: ${String(base)}`);
  }
  // 세그먼트 traversal 가드 재사용 (BASE_RE 로 이미 단일 세그먼트지만 이중 방어).
  try {
    joinVaultAbs("/", `${AUDIO_DIR}/${base}.m4a`);
  } catch (e) {
    throw new RecordingError(400, "badBase", (e as Error).message);
  }
  return base;
}

function assertMemoPath(p: unknown): string {
  if (typeof p !== "string" || !p.endsWith(".md") || /\.(transcript|summary)\.md$/.test(p)) {
    throw new RecordingError(400, "badMemo", "memo 는 메모 메인 .md 경로여야 합니다.");
  }
  // `_` 폴더 메모는 허용(orphan 복구 — 메모가 `_` 폴더로 옮겨진 경우). dot 세그먼트(.trash 등)는 거부.
  if (p.startsWith("/") || p.split("/").some((s) => s === ".." || s.startsWith("."))) {
    throw new RecordingError(400, "badMemo", `잘못된 메모 경로입니다: ${p}`);
  }
  return p;
}

// ── 락 ───────────────────────────────────────────────────────────────────────

function keyedMutex() {
  const locks = new Map<string, Promise<unknown>>();
  return async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    locks.set(key, next);
    try {
      return await next;
    } finally {
      if (locks.get(key) === next) locks.delete(key);
    }
  };
}

// ── 본체 ─────────────────────────────────────────────────────────────────────

export function createRecordings(deps: RecordingsDeps) {
  const vault = deps.vault;
  const adapter = deps.adapter ?? coreAdapter(vault);
  const probe = deps.probe ?? defaultProbe;
  const transcode = deps.transcode ?? defaultTranscode;
  const isDataless = deps.isDataless ?? defaultIsDataless;
  const requestDownload = deps.requestDownload ?? defaultRequestDownload;
  const pidAlive = deps.pidAlive ?? defaultPidAlive;
  const fileResponse = deps.fileResponse ?? defaultFileResponse;
  const procStart = deps.procStart ?? defaultProcStart;
  const proCheck = deps.proCheck ?? defaultProCheck;
  const spawnJob = deps.spawnJob ?? defaultSpawnJob;
  const trashDir = deps.trashDir ?? join(homedir(), ".Trash", "goodsoob-녹음");
  const now = deps.now ?? (() => new Date());

  // 메모 경로 기준 mutex — 같은 메모 사이드카 read-modify-write 직렬화 (link·unlink, PR3 apply).
  const withMemoLock = keyedMutex();
  // base 기준 — 같은 녹음을 동시에 두 곳으로 이사시키는 요청은 409 (기다리지 않음).
  const busyBases = new Set<string>();
  // play.m4a 변환은 base 당 1회.
  const withTranscodeLock = keyedMutex();

  const abs = (rel: string) => joinVaultAbs(vault.root, rel);
  const m4aRel = (b: string) => `${AUDIO_DIR}/${b}.m4a`;
  const txtRel = (b: string) => `${AUDIO_DIR}/${b}.txt`;
  const sttRel = (b: string, f: string) => `${STT_DIR}/${b}/${f}`;
  const has = (rel: string) => existsSync(abs(rel));

  async function readJson<T>(rel: string): Promise<T | null> {
    try {
      return JSON.parse(await vault.read(rel)) as T;
    } catch {
      return null;
    }
  }

  async function withBase<T>(base: string, fn: () => Promise<T>): Promise<T> {
    if (busyBases.has(base)) {
      throw new RecordingError(409, "busy", "이 녹음은 다른 요청이 처리 중입니다. 잠시 후 다시 시도하세요.");
    }
    busyBases.add(base);
    try {
      return await fn();
    } finally {
      busyBases.delete(base);
    }
  }

  // ── 목록 ──────────────────────────────────────────────────────────────────

  function readdirSafe(rel: string): Dirent[] {
    try {
      return readdirSync(abs(rel), { withFileTypes: true });
    } catch {
      return [];
    }
  }

  interface MetaCache extends ProbeResult {
    size: number;
  }

  async function durationFor(base: string): Promise<Pick<RecordingEntry, "durationSec" | "creationTime" | "syncPending"> & { codec: string | null }> {
    const a = abs(m4aRel(base));
    if (isDataless(a)) {
      const cached = await readJson<MetaCache>(sttRel(base, "meta.json"));
      return { durationSec: cached?.durationSec ?? null, creationTime: cached?.creationTime ?? null, codec: cached?.codec ?? null, syncPending: true };
    }
    const size = statSync(a).size;
    const cached = await readJson<MetaCache>(sttRel(base, "meta.json"));
    if (cached && cached.size === size) {
      return { durationSec: cached.durationSec, creationTime: cached.creationTime, codec: cached.codec, syncPending: false };
    }
    const r = await probe(a);
    if (r) {
      const meta: MetaCache = { ...r, size };
      await vault.write(sttRel(base, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
      return { ...r, syncPending: false };
    }
    return { durationSec: null, creationTime: null, codec: null, syncPending: false };
  }

  /** running job 의 runner 가 살아 있나 — pid 생존 + (기록돼 있으면) ps lstart 일치(pid 재사용 배제). */
  function jobAlive(j: Partial<JobFile>): boolean {
    if (typeof j.pid !== "number" || j.pid <= 0 || !pidAlive(j.pid)) return false;
    if (typeof j.lstart === "string" && j.lstart !== "") return procStart(j.pid) === j.lstart;
    return true;
  }

  function toRecordingJob(j: Partial<JobFile>, alive: boolean): RecordingJob {
    const out: RecordingJob = { state: String(j.state), pidAlive: alive, step: j.step, error: j.error };
    if (j.kind) out.kind = j.kind;
    if (Array.isArray(j.failedChunks)) out.failedChunks = j.failedChunks;
    if (typeof j.anchorMisses === "number") out.anchorMisses = j.anchorMisses;
    return out;
  }

  /**
   * job.json 읽기 + 생존 판정. running 인데 runner 가 죽었으면 `error: "interrupted"` 로 다시 쓴다.
   * 같은 base 를 다른 요청(job 시작 등)이 잡고 있으면 재기록은 건너뛴다(그 요청이 job.json 소유).
   */
  async function jobFacts(base: string): Promise<RecordingJob | null> {
    const rel = sttRel(base, "job.json");
    const j = await readJson<Partial<JobFile>>(rel);
    if (!j || typeof j.state !== "string") return null;
    if (j.state !== "running") return toRecordingJob(j, false);
    if (jobAlive(j)) return toRecordingJob(j, true);
    if (busyBases.has(base)) return toRecordingJob(j, false);
    // 다시 읽어 같은 pid 의 running 일 때만 (그 사이 runner 가 done/error 를 썼으면 존중).
    const again = await readJson<Partial<JobFile>>(rel);
    if (!again || again.state !== "running" || again.pid !== j.pid) {
      return again && typeof again.state === "string" ? toRecordingJob(again, false) : null;
    }
    const next = { ...again, state: "error" as const, error: "interrupted", finishedAt: new Date().toISOString() };
    try {
      await vault.write(rel, JSON.stringify(next, null, 2) + "\n");
    } catch (e) {
      console.warn("[recordings] interrupted 기록 실패:", base, (e as Error).message);
    }
    return toRecordingJob(next, false);
  }

  /**
   * brain 전체 `*.transcript.md` 에서 ` · <base>` 헤딩을 찾는다 (요청당 vault walk 1회,
   * 여러 base 를 한 번에). `_` 폴더 포함, dot 세그먼트(.git·.trash·_audio/.stt)와 `_audio` 제외.
   */
  async function findOrphans(bases: string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    if (bases.length === 0) return found;
    const sidecars: string[] = [];
    const walk = (rel: string) => {
      for (const e of readdirSafe(rel)) {
        if (e.name.startsWith(".")) continue;
        const child = rel === "" ? e.name : `${rel}/${e.name}`;
        if (e.isDirectory()) {
          if (child === AUDIO_DIR || e.name === "node_modules") continue;
          walk(child);
        } else if (e.isFile() && e.name.endsWith(".transcript.md")) {
          sidecars.push(child);
        }
      }
    };
    walk("");
    sidecars.sort();
    for (const sc of sidecars) {
      let text: string;
      try {
        text = await vault.read(sc);
      } catch {
        continue;
      }
      if (!text.includes(" · ")) continue;
      for (const b of bases) {
        if (!found.has(b) && findSection(text, b)) found.set(b, meetingMainPath(sc));
      }
      if (found.size === bases.length) break;
    }
    return found;
  }

  /**
   * GET /api/recordings[?known=b1,b2] — `known` = 클라가 useMeetings(휴지통 포함)의 `audio:` 로
   * 이미 연결 상태를 아는 base 들. moved.json 이 있는데 known 에 없는 base 만 orphan 검사.
   */
  async function list(known: ReadonlySet<string> = new Set()): Promise<RecordingsListResponse> {
    const m4a = new Map<string, boolean>(); // base → dataless placeholder 여부
    const txt = new Set<string>();
    for (const e of readdirSafe(AUDIO_DIR)) {
      if (!e.isFile()) continue;
      const n = e.name;
      // 옛 iCloud placeholder `.<name>.m4a.icloud`
      const ph = /^\.(.+)\.m4a\.icloud$/.exec(n);
      if (ph) {
        if (!m4a.has(ph[1])) m4a.set(ph[1], true);
        continue;
      }
      if (n.startsWith(".")) continue;
      if (n.endsWith(".m4a")) m4a.set(n.slice(0, -4), false);
      else if (n.endsWith(".txt")) txt.add(n.slice(0, -4));
    }
    const bases = [...new Set([...m4a.keys(), ...txt])].filter((b) => BASE_RE.test(b));

    const entries: RecordingEntry[] = [];
    // ffprobe 는 meta.json 캐시 miss 일 때만 — 동시 4개 제한.
    const queue = [...bases];
    const worker = async () => {
      for (let b = queue.shift(); b !== undefined; b = queue.shift()) {
        entries.push(await entryFor(b, m4a.has(b), m4a.get(b) === true, txt.has(b)));
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    const orphanCandidates = entries.filter((e) => e.stt.moved && !known.has(e.base)).map((e) => e.base);
    if (orphanCandidates.length > 0) {
      const found = await findOrphans(orphanCandidates);
      for (const e of entries) {
        if (orphanCandidates.includes(e.base)) e.orphan = found.get(e.base) ?? false;
      }
    }
    entries.sort((a, b) => compareBases(b.base, a.base)); // 날짜 desc
    return { recordings: entries };
  }

  async function entryFor(base: string, hasM4a: boolean, placeholder: boolean, hasTxt: boolean): Promise<RecordingEntry> {
    const sttDir = `${STT_DIR}/${base}`;
    const sttExists = has(sttDir) && statSync(abs(sttDir)).isDirectory();
    const marker = (f: string) => sttExists && has(sttRel(base, f));
    const anchored = marker("anchored.json");
    const stt: RecordingSttMarkers = {
      done: marker("done"),
      moved: marker("moved.json"),
      rawPromoted: marker("raw-promoted"),
      anchored,
      diarized: marker("화자분리.txt"),
      reviewLeft: anchored ? await reviewLeftFor(base) : 0,
    };
    let dur: { durationSec: number | null; creationTime: string | null; syncPending: boolean } = {
      durationSec: null,
      creationTime: null,
      syncPending: false,
    };
    if (hasM4a && placeholder) dur.syncPending = true;
    else if (hasM4a) dur = await durationFor(base);
    return {
      base,
      parsed: parseBase(base),
      hasM4a,
      hasTxt,
      stt,
      job: sttExists ? await jobFacts(base) : null,
      durationSec: dur.durationSec,
      creationTime: dur.creationTime,
      syncPending: dur.syncPending,
      firstLine: firstLineFor(base),
    };
  }

  /** 작업 파일 첫 ~2KB 에서 첫 발화. 화자분리 → 교정본 → 초벌 순. */
  function firstLineFor(base: string): string | null {
    for (const rel of [sttRel(base, "화자분리.txt"), txtRel(base), sttRel(base, "tr.txt")]) {
      const head = readHead(abs(rel), 2048);
      if (head === null) continue;
      return extractFirstLine(head);
    }
    return null;
  }

  async function reviewLeftFor(base: string): Promise<number> {
    const { items, decisions } = await readReview(base);
    return items.filter((it) => !(String(it.id) in decisions)).length;
  }

  // ── 오디오 ────────────────────────────────────────────────────────────────

  /** GET /api/audio?base= */
  async function audio(baseParam: string | null): Promise<Response> {
    const base = assertValidBase(baseParam);
    const src = abs(m4aRel(base));
    if (!existsSync(src)) {
      if (existsSync(abs(`${AUDIO_DIR}/.${base}.m4a.icloud`))) {
        requestDownload(abs(`${AUDIO_DIR}/.${base}.m4a.icloud`));
        throw new RecordingError(503, "syncPending", "녹음 파일이 아직 이 맥으로 동기화되지 않았습니다. 잠시 후 다시 시도하세요.");
      }
      throw new RecordingError(404, "noAudio", "녹음 파일 없음");
    }
    if (isDataless(src)) {
      requestDownload(src);
      throw new RecordingError(503, "syncPending", "녹음 파일이 아직 이 맥으로 동기화되지 않았습니다. 잠시 후 다시 시도하세요.");
    }
    const headers = { "Content-Type": "audio/mp4", "Cache-Control": "private, max-age=60" };
    const playRel = sttRel(base, "play.m4a");
    if (has(playRel)) return fileResponse(abs(playRel), headers);
    const { codec } = await durationFor(base);
    if (codec === null || codec === "aac") return fileResponse(src, headers);
    // 비 aac(ALAC 등) — 브라우저 재생 불가 → 1회 AAC 변환본 생성 후 서빙.
    await withTranscodeLock(base, async () => {
      if (has(playRel)) return;
      await vault.mkdir(`${STT_DIR}/${base}`);
      const tmp = abs(sttRel(base, `play.${Date.now().toString(36)}.tmp.m4a`));
      await transcode(src, tmp);
      await vault.rename(vault.relOf(tmp), playRel);
    });
    return fileResponse(abs(playRel), headers);
  }

  // ── 행선지 ────────────────────────────────────────────────────────────────

  async function readMemoAudio(memo: string): Promise<{ raw: string; audio: string[] }> {
    const raw = await vault.read(memo);
    const m = fileToMeeting(memo, raw, "", "", 0);
    return { raw, audio: normalizeAudioList(m.audio) };
  }

  /**
   * 이사할 전사본 원천 = 교정본 `_audio/<base>.txt` 만 (D-R1 — 초벌 `tr.txt` 승격 경로 없음).
   * 이미 다른 메모로 이사됨(moved.json, txt 없음)이면 409 — 연결 해제 먼저.
   * 파이프라인이 "교정본"이 아니면(txt 없음 · 옛 raw-promoted · 화자분리 작업 중) 409 notCorrected.
   */
  async function sourceText(base: string): Promise<string> {
    if (!has(txtRel(base)) && has(sttRel(base, "moved.json"))) {
      throw new RecordingError(409, "alreadyMoved", "이 녹음의 전사본은 이미 다른 메모로 옮겨졌습니다. 먼저 연결을 해제하세요.");
    }
    assertCorrected(base);
    return vault.read(txtRel(base));
  }

  /** 파이프라인 "교정본" 게이트 — status.ts computePipeline 과 같은 판정. */
  function assertCorrected(base: string): void {
    const corrected =
      has(txtRel(base)) &&
      !has(sttRel(base, "raw-promoted")) &&
      !has(sttRel(base, "화자분리.txt")) &&
      !has(sttRel(base, "anchored.json"));
    if (!corrected) {
      throw new RecordingError(
        409,
        "notCorrected",
        "아직 교정이 끝나지 않아 연결할 수 없습니다. 화자분리 후 교정을 완료한 뒤 다시 시도하세요.",
      );
    }
  }

  /** link 의 ①~④ (메모 lock 안에서 호출). */
  async function moveInto(base: string, memo: string): Promise<{ insertedSection: boolean; raw: boolean }> {
    const { audio } = await readMemoAudio(memo);
    const known = audio.includes(base) ? audio : [...audio, base];
    const tRel = transcriptPath(memo);
    const tText = has(tRel) ? await vault.read(tRel) : "";

    // ① 사이드카에 섹션 (이미 헤딩 있으면 skip — 멱등)
    let insertedSection = false;
    const raw = has(sttRel(base, "raw-promoted"));
    let nextText = tText;
    if (!findSection(tText, base, known)) {
      const body = await sourceText(base);
      nextText = insertSection(
        tText,
        { base, timeLabel: baseTimeLabel(base), body, sortKey: baseSortKey(base) },
        known,
      );
      await vault.write(tRel, nextText);
      insertedSection = true;
    }

    // ② 메모 frontmatter audio: (①과 ② 사이에 다른 writer 가 없도록 lock 안에서 다시 읽음)
    const cur = await readMemoAudio(memo);
    if (!cur.audio.includes(base)) {
      await vault.write(memo, patchMeetingFrontmatter(cur.raw, { audio: [...cur.audio, base] }));
    }

    // ③ moved.json {hash, raw} + done 보장. 이미 있으면 유지 (사람 편집 판정 기준 해시를 덮지 않음).
    if (!has(sttRel(base, "moved.json"))) {
      const sec = findSection(nextText, base, known);
      const hash = sectionHash(sec?.body ?? "");
      await vault.write(sttRel(base, "moved.json"), JSON.stringify({ hash, raw }) + "\n");
    }
    if (!has(sttRel(base, "done"))) await vault.write(sttRel(base, "done"), "");

    // ④ _audio/<base>.txt 삭제 (전사본은 한 벌)
    if (has(txtRel(base))) await vault.delete(txtRel(base));

    return { insertedSection, raw };
  }

  /**
   * POST /api/recordings/:base/link — `{memo}` 기존 메모 / `{newMemo:{title,folder}}` 새 메모.
   * 이미 연결된 메모로 다시 부르면 멱등 — "이사 미완료"(txt 잔존·moved.json 없음) 복구 경로.
   */
  async function link(baseParam: string, body: LinkRequest): Promise<LinkResponse> {
    const base = assertValidBase(baseParam);
    if (!has(m4aRel(base)) && !has(txtRel(base)) && !has(`${STT_DIR}/${base}`)) {
      throw new RecordingError(404, "noRecording", "녹음을 찾을 수 없습니다.");
    }
    return withBase(base, async () => {
      await assertNoRunningJob(base);
      if (body.newMemo) {
        const title = (body.newMemo.title ?? "").trim() || parseBase(base).label;
        let folder: string;
        try {
          // createMeeting 과 같은 기본값 — 빈 폴더(root)는 inbox 로.
          folder = normalizeFolderPath(body.newMemo.folder?.trim() ?? "") || "inbox";
        } catch (e) {
          throw new RecordingError(400, "badFolder", (e as Error).message);
        }
        if (isNonNotePath(folder)) {
          throw new RecordingError(400, "badFolder", "`_`·`.` 로 시작하는 폴더에는 메모를 만들 수 없습니다.");
        }
        const slug = slugify(title);
        const target = `${folder}/${slug}.md`;
        return withMemoLock(target, async () => {
          if (has(target)) throw new TitleConflictError(slug, target);
          // 전사본 원천이 없으면 메모를 만들기 전에 실패 (빈 메모 잔재 방지).
          await sourceText(base);
          const p = parseBase(base);
          const created = await createMeeting(adapter, {
            title,
            folder,
            date: p.date ?? null,
            time: p.time ?? null,
          });
          if (created.id !== target) {
            // createMeeting 의 경로 규칙이 바뀌면 lock key 와 어긋난다 — 조용히 넘어가지 않음.
            throw new RecordingError(500, "pathMismatch", `예상 경로와 다릅니다: ${created.id}`);
          }
          const r = await moveInto(base, target);
          return { meeting: await getMeeting(adapter, target), ...r, created: true };
        });
      }
      const memo = assertMemoPath(body.memo);
      return withMemoLock(memo, async () => {
        if (!has(memo)) throw new RecordingError(404, "noMemo", "메모를 찾을 수 없습니다.");
        const r = await moveInto(base, memo);
        return { meeting: await getMeeting(adapter, memo), ...r, created: false };
      });
    });
  }

  /** POST /api/recordings/:base/unlink `{memo}` — 섹션을 잘라 `_audio/<base>.txt` 로 되돌림. */
  async function unlink(baseParam: string, body: { memo?: string }): Promise<UnlinkResponse> {
    const base = assertValidBase(baseParam);
    const memo = assertMemoPath(body.memo);
    return withBase(base, () =>
      withMemoLock(memo, async () => {
        if (!has(memo)) throw new RecordingError(404, "noMemo", "메모를 찾을 수 없습니다.");
        const { audio } = await readMemoAudio(memo);
        const known = audio.includes(base) ? audio : [...audio, base];
        const tRel = transcriptPath(memo);
        const tText = has(tRel) ? await vault.read(tRel) : "";
        const removed = removeSection(tText, base, known);
        if (removed) {
          // 텍스트를 먼저 _audio 에 쓰고 나서 사이드카를 줄인다 (중간 실패 시 두 벌 > 0 벌).
          await vault.write(txtRel(base), removed.body + "\n");
          if (removed.text.trim() === "") await vault.delete(tRel);
          else await vault.write(tRel, removed.text);
        }
        const cur = await readMemoAudio(memo);
        if (cur.audio.includes(base)) {
          const next = cur.audio.filter((b) => b !== base);
          await vault.write(memo, patchMeetingFrontmatter(cur.raw, { audio: next.length > 0 ? next : undefined }));
        }
        // 헤딩을 못 찾은 경우에도 moved.json 은 지운다 — 남기면 "전사본 없음"으로 오판된다.
        if (has(sttRel(base, "moved.json"))) await vault.delete(sttRel(base, "moved.json"));
        return { meeting: await getMeeting(adapter, memo), textKept: removed === null };
      }),
    );
  }

  // ── job (PR2: 화자분리 · 교정 후보) ──────────────────────────────────────

  function assertPro(): void {
    const r = proCheck();
    if (!r.ok) throw new RecordingError(409, "notPro", r.reason ?? "이 맥에서는 전사 작업을 실행할 수 없습니다.");
  }

  /** 처리 중이면 409 — withBase 안에서 호출. 현재 job.json 반환. */
  async function assertNoRunningJob(base: string): Promise<Partial<JobFile> | null> {
    const j = await readJson<Partial<JobFile>>(sttRel(base, "job.json"));
    if (j?.state === "running" && jobAlive(j)) {
      throw new RecordingError(409, "jobRunning", "이 녹음은 이미 처리 중입니다. 끝난 뒤 다시 시도하세요.");
    }
    return j;
  }

  /** withBase 안: spawn → job.json {running, pid, startedAt, lstart} 기록 (runner 는 이 claim 을 기다렸다 시작). */
  async function startJob(base: string, kind: JobKind, extra: Pick<JobFile, "speakers" | "names"> = {}): Promise<JobStartResponse> {
    mkdirSync(abs(`${STT_DIR}/${base}`), { recursive: true });
    let pid: number;
    try {
      ({ pid } = spawnJob({ vaultDir: vault.root, base, kind, ...extra, logPath: abs(sttRel(base, "job.log")) }));
    } catch (e) {
      throw new RecordingError(500, "spawnFailed", `작업을 시작하지 못했습니다. ${(e as Error).message}`);
    }
    const at = new Date().toISOString();
    const job: JobFile = {
      state: "running",
      kind,
      step: "queued",
      pid,
      startedAt: at,
      lstart: procStart(pid),
      heartbeatAt: at,
      ...extra,
    };
    await vault.write(sttRel(base, "job.json"), JSON.stringify(job, null, 2) + "\n");
    // 새 화자분리·전체 교정 후보 = anchored.json 이 새로 생기므로 이전 리뷰 결정은 낡음.
    if (kind !== "corrections-retry" && has(sttRel(base, "review.json"))) await vault.delete(sttRel(base, "review.json"));
    return { job: toRecordingJob(job, true) };
  }

  /** POST /api/recordings/:base/diarize `{speakers?, names?}` — 단계 1~3 (로컬 전용). speakers 생략·0 = 자동. */
  async function diarize(baseParam: string, body: Partial<DiarizeRequest>): Promise<JobStartResponse> {
    const base = assertValidBase(baseParam);
    const speakers = body.speakers ?? 0;
    if (typeof speakers !== "number" || !Number.isInteger(speakers) || speakers < 0 || speakers > 10) {
      throw new RecordingError(400, "badSpeakers", "화자 수는 1~10 사이 정수로 입력하거나 비워두세요.");
    }
    let names: string[] = [];
    if (body.names !== undefined) {
      if (!Array.isArray(body.names) || body.names.some((n) => typeof n !== "string")) {
        throw new RecordingError(400, "badNames", "화자 이름은 문자열 배열이어야 합니다.");
      }
      names = body.names.map((n) => n.trim());
      if (names.length > (speakers || 10)) throw new RecordingError(400, "badNames", "화자 이름이 화자 수보다 많습니다.");
      // merge.py 는 index 순 매핑 — 빈 이름은 자리 표시가 안 되므로 거부.
      if (names.some((n) => n === "" || /[\t\n\r]/.test(n) || n.length > 40)) {
        throw new RecordingError(400, "badNames", "화자 이름이 비었거나 너무 깁니다. 한 줄 40자 이내로 입력하세요.");
      }
    }
    return withBase(base, async () => {
      assertPro();
      if (!has(m4aRel(base))) throw new RecordingError(409, "noAudio", "녹음 파일이 없어 화자분리를 할 수 없습니다.");
      if (!has(sttRel(base, "done")) || !has(sttRel(base, "tr.json"))) {
        throw new RecordingError(409, "notTranscribed", "초벌 전사가 아직 끝나지 않았습니다. 전사가 끝난 뒤 다시 시도하세요.");
      }
      await assertNoRunningJob(base);
      return startJob(base, "diarize", { speakers, names });
    });
  }

  /** POST /api/recordings/:base/corrections `{retryFailed?}` — 단계 4~5 (Claude 전송). */
  async function corrections(baseParam: string, body: CorrectionsRequest): Promise<JobStartResponse> {
    const base = assertValidBase(baseParam);
    const retry = body.retryFailed === true;
    return withBase(base, async () => {
      assertPro();
      if (!has(sttRel(base, "화자분리.txt"))) {
        throw new RecordingError(409, "notDiarized", "화자분리가 아직 없습니다. 화자분리를 먼저 실행하세요.");
      }
      if (!has(sttRel(base, "tr.json"))) {
        throw new RecordingError(409, "notTranscribed", "초벌 전사(tr.json)가 없어 교정 후보 위치를 찾을 수 없습니다.");
      }
      const prev = await assertNoRunningJob(base);
      if (retry) {
        const failed = prev?.state === "error" && Array.isArray(prev.failedChunks) && prev.failedChunks.length > 0;
        if (!failed || !has(sttRel(base, "corrections.partial.json"))) {
          throw new RecordingError(409, "noPartial", "다시 실행할 실패 청크가 없습니다. 전체 재실행하세요.");
        }
      }
      return startJob(base, retry ? "corrections-retry" : "corrections");
    });
  }


  // ── 삭제 (D-R4) ───────────────────────────────────────────────────────────

  /**
   * node:fs rename, 안 되면 복사 후 삭제. 볼륨이 다르면 EXDEV, iCloud Drive 안 **폴더**를
   * 밖(~/.Trash)으로 rename 하면 EDEADLK 가 난다(파일은 통과 — 2026-11-02 실측, `.stt/<base>/`).
   */
  function moveOut(src: string, dst: string): void {
    mkdirSync(join(dst, ".."), { recursive: true });
    try {
      renameSync(src, dst);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EXDEV" && code !== "EDEADLK") throw e;
      cpSync(src, dst, { recursive: true, preserveTimestamps: true });
      rmSync(src, { recursive: true, force: true });
    }
  }

  function trashFolderFor(base: string): string {
    const d = now();
    const p2 = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    let dir = join(trashDir, `${base}-${stamp}`);
    for (let i = 2; existsSync(dir); i++) dir = join(trashDir, `${base}-${stamp}-${i}`);
    return dir;
  }

  /**
   * 한 녹음을 휴지통으로: m4a(+ iCloud placeholder) → txt → .stt/<base>/ 순서.
   * m4a 를 먼저 옮겨야 중간 실패 때 auto_stt 가 `.stt` 없는 m4a 를 재전사하지 않는다.
   * 연결된 녹음은 txt 가 이미 없으므로 오디오·.stt 만 옮겨지고 메모 전사는 그대로.
   * 메모 파일·`.stt/imported-voicememos.txt` 는 건드리지 않는다.
   */
  async function deleteOne(base: string): Promise<void> {
    await withBase(base, async () => {
      await assertNoRunningJob(base);
      const parts: Array<[string, string]> = [
        [m4aRel(base), `${base}.m4a`],
        [`${AUDIO_DIR}/.${base}.m4a.icloud`, `.${base}.m4a.icloud`],
        [txtRel(base), `${base}.txt`],
        [`${STT_DIR}/${base}`, "stt"],
      ];
      const present = parts.filter(([rel]) => has(rel));
      if (present.length === 0) throw new RecordingError(404, "noRecording", "녹음을 찾을 수 없습니다.");
      const dir = trashFolderFor(base);
      mkdirSync(dir, { recursive: true });
      for (const [rel, name] of present) moveOut(abs(rel), join(dir, name));
    });
  }

  /** POST /api/recordings/delete `{bases}` — 항목별 결과 (일부 실패해도 나머지는 진행). */
  async function remove(body: Partial<DeleteRequest>): Promise<DeleteResponse> {
    if (!Array.isArray(body.bases) || body.bases.length === 0 || body.bases.some((b) => typeof b !== "string")) {
      throw new RecordingError(400, "badBases", "삭제할 녹음 목록(bases)이 비었거나 잘못됐습니다.");
    }
    const out: DeleteResponse = { deleted: [], failed: [] };
    for (const raw of [...new Set(body.bases)]) {
      try {
        const base = assertValidBase(raw);
        await deleteOne(base);
        out.deleted.push(base);
      } catch (e) {
        // 원시 fs 에러(전체 경로 포함)는 토스트에 그대로 내지 않고 로그로 — 화면엔 원인+해결 문장.
        if (!(e instanceof RecordingError)) console.error(`[recordings] delete ${raw}:`, e);
        const err =
          e instanceof RecordingError
            ? e
            : new RecordingError(500, "internal", "휴지통으로 옮기지 못했습니다. 잠시 뒤 다시 시도하세요.");
        out.failed.push({ base: raw, code: err.code, error: err.message });
      }
    }
    return out;
  }

  // ── 작업 파일 (턴 화면 편집) ─────────────────────────────────────────────

  function isLinked(base: string): boolean {
    return has(sttRel(base, "moved.json")) && !has(txtRel(base));
  }

  function workingSource(base: string): { rel: string; source: TranscriptSource } | null {
    if (has(sttRel(base, "화자분리.txt"))) return { rel: sttRel(base, "화자분리.txt"), source: "diarized" };
    if (has(txtRel(base))) return { rel: txtRel(base), source: "corrected" };
    if (has(sttRel(base, "tr.txt"))) return { rel: sttRel(base, "tr.txt"), source: "raw" };
    return null;
  }

  /** GET /api/recordings/:base/transcript */
  async function getTranscript(baseParam: string): Promise<TranscriptResponse> {
    const base = assertValidBase(baseParam);
    const src = workingSource(base);
    if (!src) throw new RecordingError(404, "noTranscript", "아직 전사본이 없습니다. 전사가 끝난 뒤 다시 시도하세요.");
    const text = await vault.read(src.rel);
    return { text, source: src.source, mtime: statSync(abs(src.rel)).mtimeMs };
  }

  /** PUT /api/recordings/:base/transcript `{text, mtime}` — 현재 작업 파일을 덮어쓴다(atomic). */
  async function putTranscript(baseParam: string, body: Partial<TranscriptPutRequest>): Promise<TranscriptResponse> {
    const base = assertValidBase(baseParam);
    if (typeof body.text !== "string" || typeof body.mtime !== "number" || !Number.isFinite(body.mtime)) {
      throw new RecordingError(400, "badBody", "text(문자열)와 mtime(숫자)이 필요합니다.");
    }
    const { text, mtime } = body as TranscriptPutRequest;
    return withBase(base, async () => {
      if (isLinked(base)) {
        throw new RecordingError(409, "linked", "메모에 연결된 녹음입니다. 전사는 메모의 음성 기록 탭에서 고치세요.");
      }
      await assertNoRunningJob(base);
      const src = workingSource(base);
      if (!src) throw new RecordingError(404, "noTranscript", "아직 전사본이 없습니다. 전사가 끝난 뒤 다시 시도하세요.");
      if (src.source === "raw") {
        throw new RecordingError(409, "rawReadonly", "초벌 전사는 고칠 수 없습니다. 화자분리를 먼저 실행하세요.");
      }
      const cur = statSync(abs(src.rel)).mtimeMs;
      if (cur !== mtime) {
        const err = new RecordingError(409, "conflict", "다른 곳에서 전사본이 바뀌었습니다. 새로 불러온 뒤 다시 고치세요.");
        err.extra = { mtime: cur };
        throw err;
      }
      const meta = await vault.write(src.rel, text);
      return { text, source: src.source, mtime: meta.mtime };
    });
  }

  // ── 교정 완료 ─────────────────────────────────────────────────────────────

  const COMPLETE_CLEANUP = [
    "diar.tsv",
    "corrections.json",
    "corrections.partial.json",
    "anchored.json",
    "normalize.log",
    "review.json",
    "화자분리.txt", // 마지막 — 중간 실패 시 작업 파일이 남아 재시도 가능
  ];

  /** POST /api/recordings/:base/complete — 화자분리.txt → _audio/<base>.txt, 중간물 정리. tr.json·done·meta.json 유지. */
  async function complete(baseParam: string): Promise<TranscriptResponse> {
    const base = assertValidBase(baseParam);
    return withBase(base, async () => {
      if (isLinked(base)) {
        throw new RecordingError(409, "linked", "이미 메모에 연결된 녹음입니다.");
      }
      await assertNoRunningJob(base);
      if (!has(sttRel(base, "화자분리.txt"))) {
        throw new RecordingError(409, "notDiarized", "화자분리가 아직 없습니다. 화자분리를 먼저 실행하세요.");
      }
      const text = await vault.read(sttRel(base, "화자분리.txt"));
      const meta = await vault.write(txtRel(base), text);
      // 옛 초벌 승격 마커가 남아 있으면 지워야 파이프라인이 교정본이 된다.
      if (has(sttRel(base, "raw-promoted"))) await vault.delete(sttRel(base, "raw-promoted"));
      for (const f of COMPLETE_CLEANUP) {
        if (has(sttRel(base, f))) await vault.delete(sttRel(base, f));
      }
      return { text, source: "corrected" as const, mtime: meta.mtime };
    });
  }

  // ── 교정 후보 리뷰 상태 (D-R7) ───────────────────────────────────────────

  const DECISIONS: readonly ReviewDecision[] = ["accepted", "kept", "edited"];

  function toReviewItem(x: unknown): ReviewItem | null {
    if (!x || typeof x !== "object") return null;
    const o = x as Record<string, unknown>;
    if (typeof o.id !== "number") return null;
    const it: ReviewItem = {
      id: o.id,
      t: typeof o.t === "number" ? o.t : 0,
      type: typeof o.type === "string" ? o.type : "A",
      orig: typeof o.orig === "string" ? o.orig : "",
      sugg: typeof o.sugg === "string" ? o.sugg : "",
    };
    if (typeof o.conf === "string") it.conf = o.conf;
    if (Array.isArray(o.hl) && o.hl.length >= 2 && o.hl.every((h) => typeof h === "string")) {
      it.hl = [o.hl[0] as string, o.hl[1] as string];
    }
    if (typeof o.note === "string") it.note = o.note;
    if (o.global === true) it.global = true;
    return it;
  }

  async function readReview(base: string): Promise<ReviewResponse> {
    const raw = await readJson<unknown>(sttRel(base, "anchored.json"));
    const items = Array.isArray(raw) ? raw.map(toReviewItem).filter((x): x is ReviewItem => x !== null) : [];
    const ids = new Set(items.map((it) => String(it.id)));
    const stored = await readJson<{ decisions?: Record<string, unknown> }>(sttRel(base, "review.json"));
    const decisions: Record<string, ReviewDecision> = {};
    for (const [k, v] of Object.entries(stored?.decisions ?? {})) {
      if (ids.has(k) && DECISIONS.includes(v as ReviewDecision)) decisions[k] = v as ReviewDecision;
    }
    return { items, decisions };
  }

  /** GET /api/recordings/:base/review */
  async function getReview(baseParam: string): Promise<ReviewResponse> {
    return readReview(assertValidBase(baseParam));
  }

  /** POST /api/recordings/:base/review `{id, decision}` — 결정 1건 기록 (텍스트 치환은 클라가 PUT transcript 로). */
  async function postReview(baseParam: string, body: { id?: unknown; decision?: unknown }): Promise<ReviewResponse> {
    const base = assertValidBase(baseParam);
    const id = typeof body.id === "number" ? body.id : typeof body.id === "string" ? Number(body.id) : NaN;
    if (!Number.isInteger(id)) throw new RecordingError(400, "badId", "후보 id 가 잘못됐습니다.");
    if (!DECISIONS.includes(body.decision as ReviewDecision)) {
      throw new RecordingError(400, "badDecision", "decision 은 accepted·kept·edited 중 하나여야 합니다.");
    }
    return withBase(base, async () => {
      const cur = await readReview(base);
      if (!cur.items.some((it) => it.id === id)) {
        throw new RecordingError(404, "noItem", "해당 교정 후보가 없습니다. 목록을 새로 불러오세요.");
      }
      const decisions = { ...cur.decisions, [String(id)]: body.decision as ReviewDecision };
      await vault.write(sttRel(base, "review.json"), JSON.stringify({ decisions }, null, 2) + "\n");
      return { items: cur.items, decisions };
    });
  }

  return {
    list,
    audio,
    link,
    unlink,
    diarize,
    corrections,
    remove,
    getTranscript,
    putTranscript,
    complete,
    getReview,
    postReview,
  };
}

export type Recordings = ReturnType<typeof createRecordings>;

// ── firstLine (순수) ─────────────────────────────────────────────────────────

function readHead(absPath: string, bytes: number): string | null {
  let fd: number;
  try {
    fd = openSync(absPath, "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    // 잘린 멀티바이트 끝은 U+FFFD 로 디코드됨 — 첫 발화만 쓰므로 무해.
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

const TS = String.raw`\d{1,2}:\d{2}(?::\d{2})?`;
// 화자분리 형식 `[mm:ss] 이름: 발화`
const DIAR_PREFIX = new RegExp(String.raw`^\[${TS}\]\s*(?:[^:\n]{1,40}:\s*)?`);
// 옛 사이드카 형식 헤더 줄 `mm:ss 이름` (발화는 다음 줄) — 이름 1~3 단어, 콜론 없음
const OLD_HEADER = new RegExp(String.raw`^${TS}\s+[^\s:]+(?:\s+[^\s:]+){0,2}\s*$`);
// 같은 줄 `mm:ss 이름: 발화`
const INLINE_PREFIX = new RegExp(String.raw`^${TS}\s+[^:\n]{1,40}:\s*`);

export const FIRST_LINE_MAX = 60;

/** 작업 파일 앞부분 → 첫 발화 한 줄 (타임스탬프·화자 접두 제거, ≈60자). 없으면 null. */
export function extractFirstLine(head: string): string | null {
  for (const rawLine of head.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line === "---") continue;
    if (OLD_HEADER.test(line)) continue;
    line = line.replace(DIAR_PREFIX, "").replace(INLINE_PREFIX, "").replace(/\uFFFD+$/, "").trim();
    if (line === "") continue;
    const chars = Array.from(line);
    return chars.length > FIRST_LINE_MAX ? chars.slice(0, FIRST_LINE_MAX).join("").trimEnd() + "…" : line;
  }
  return null;
}

// ── HTTP 라우팅 (server/index.ts 가 위임) ────────────────────────────────────

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** 빈 본문 = {} (corrections·complete 는 옵션 없이 호출 가능). 객체가 아니면 400. */
async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    const body = (text.trim() === "" ? {} : JSON.parse(text)) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return body as Record<string, unknown>;
  } catch {
    throw new RecordingError(400, "badBody", "잘못된 요청 본문(JSON 파싱 실패)");
  }
}

/** `/api/recordings*` · `/api/audio` 면 Response, 아니면 null. */
export async function handleRecordingsApi(req: Request, url: URL, rec: Recordings): Promise<Response | null> {
  const { pathname } = url;
  try {
    if (pathname === "/api/audio" && req.method === "GET") {
      return await rec.audio(url.searchParams.get("base"));
    }
    if (pathname === "/api/recordings" && req.method === "GET") {
      const known = new Set((url.searchParams.get("known") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
      return jsonRes(await rec.list(known));
    }
    if (pathname === "/api/recordings/delete" && req.method === "POST") {
      return jsonRes(await rec.remove((await readBody(req)) as Partial<DeleteRequest>));
    }
    const m = /^\/api\/recordings\/([^/]+)\/(link|unlink|diarize|corrections|transcript|complete|review)$/.exec(pathname);
    if (!m) return null;
    let base: string;
    try {
      base = decodeURIComponent(m[1]);
    } catch {
      throw new RecordingError(400, "badBase", "잘못된 녹음 이름입니다.");
    }
    const action = m[2];
    if (req.method === "GET") {
      if (action === "transcript") return jsonRes(await rec.getTranscript(base));
      if (action === "review") return jsonRes(await rec.getReview(base));
      return null;
    }
    if (req.method === "PUT") {
      if (action === "transcript") {
        return jsonRes(await rec.putTranscript(base, (await readBody(req)) as Partial<TranscriptPutRequest>));
      }
      return null;
    }
    if (req.method === "POST") {
      if (action === "transcript") return null;
      const body = await readBody(req);
      if (action === "link") return jsonRes(await rec.link(base, body as LinkRequest));
      if (action === "diarize") return jsonRes(await rec.diarize(base, body as Partial<DiarizeRequest>), 202);
      if (action === "corrections") return jsonRes(await rec.corrections(base, body as CorrectionsRequest), 202);
      if (action === "complete") return jsonRes(await rec.complete(base));
      if (action === "review") return jsonRes(await rec.postReview(base, body));
      return jsonRes(await rec.unlink(base, body as { memo?: string }));
    }
    return null;
  } catch (e) {
    if (e instanceof RecordingError) return jsonRes({ ...e.extra, error: e.message, code: e.code }, e.status);
    if (e instanceof TitleConflictError) {
      return jsonRes({ error: "같은 제목의 메모가 이미 있습니다. 다른 제목을 입력하세요.", code: "titleConflict", path: e.path }, 409);
    }
    const msg = (e as Error).message || String(e);
    if (/path traversal|expected relative/.test(msg)) return jsonRes({ error: msg, code: "badPath" }, 400);
    return jsonRes({ error: msg, code: "internal" }, 500);
  }
}
