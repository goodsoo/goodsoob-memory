/**
 * jobRunner — 녹음 탭 PR2 의 서버 job (화자분리 · Claude 교정 후보).
 *
 * 설계 = docs/designs/recording-tab.md ("job lifecycle", "Claude 교정 후보 호출").
 *
 * 실행: `bun server/jobRunner.ts <vaultDir> <base> <kind> [speakers] [name ...]`
 *   kind = diarize (단계 1~3) | corrections (4~5) | corrections-retry (실패 청크만 4 → 5)
 *   server/recordings.ts 가 detached + unref 로 띄운다 (서버 재시작에도 살아남음).
 *
 * 구조: 이 파일은 순수 오케스트레이션(단계 순서·산출물·job.json·청크·병합). 실제
 * ffmpeg/python/claude 호출은 `StepExecutors` 로 주입 — 기본 구현은 server/jobExecutors.ts.
 * 테스트는 stub executor 를 넘긴다 (실제 diarize/whisper/claude 절대 실행 안 함).
 *
 * 산출물 (전부 `<vault>/_audio/.stt/<base>/`):
 *   diar.tsv · 화자분리.txt · normalize.log · corrections.json · corrections.partial.json ·
 *   anchored.json · job.json · job.log(stdout/stderr, 서버가 연결)
 * WAV 는 `<tmpDir>/<base>.wav` (끝나면 성공·실패 무관 삭제).
 *
 * 쓰기는 VaultCore 를 거치지 않는다 — 별도 프로세스라 in-process lock 공유가 불가능하고,
 * auto_stt.sh 도 `.stt/` 를 직접 쓴다. 대신 같은 atomic(tmp→rename) 규칙만 따른다.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

// ── 타입 ─────────────────────────────────────────────────────────────────────

export type JobKind = "diarize" | "corrections" | "corrections-retry";
export const JOB_KINDS: readonly JobKind[] = ["diarize", "corrections", "corrections-retry"];

export type JobState = "running" | "done" | "error";

/** `.stt/<base>/job.json` */
export interface JobFile {
  state: JobState;
  kind: JobKind;
  /** queued | wav | diarize | merge | normalize | corrections k/n | anchor | done */
  step: string;
  pid: number;
  startedAt: string; // ISO — 서버가 spawn 직후 기록
  /** `ps -o lstart= -p <pid>` (서버 재시작 후 pid 재사용 판정용). 못 얻으면 null. */
  lstart?: string | null;
  heartbeatAt: string; // ISO — runner 가 30초마다 갱신
  finishedAt?: string;
  error?: string; // "interrupted" = 서버가 pid 사망 감지
  /** 재시도까지 실패한 청크 번호 (1부터). */
  failedChunks?: number[];
  /** anchor_offsets.py 가 위치를 못 찾아 t=0 으로 둔 항목 수. */
  anchorMisses?: number;
  speakers?: number;
  names?: string[];
  /** corrections 단계의 전체 청크 수. */
  chunks?: number;
}

/** 단계 실행기 — 기본 구현 server/jobExecutors.ts, 테스트는 stub. */
export interface StepExecutors {
  /** ffmpeg m4a → 16kHz mono PCM wav */
  toWav(m4a: string, wav: string): Promise<void>;
  /** diarize.py <wav> <N> → stdout TSV (start\tend\tspkIdx) */
  diarize(wav: string, speakers: number): Promise<string>;
  /** merge.py tr.json diar.tsv [names...] → stdout 화자분리 텍스트 */
  merge(trJson: string, diarTsv: string, names: string[]): Promise<string>;
  /** normalize.py glossary file file (in-place) → stdout 리포트 */
  normalize(glossary: string, file: string): Promise<string>;
  /** claude -p (prompt 는 stdin) → stdout */
  claude(prompt: string, timeoutMs: number): Promise<string>;
  /** anchor_offsets.py tr.json corrections.json → stdout anchored JSON */
  anchor(trJson: string, correctionsJson: string): Promise<string>;
}

export interface RunJobOptions {
  vaultDir: string;
  base: string;
  kind: JobKind;
  speakers?: number;
  names?: string[];
  exec: StepExecutors;
  /** WAV 임시 폴더 (기본 /tmp). */
  tmpDir?: string;
  /** corrections_prompt.md 경로 (기본 ~/.claude/skills/transcribe/scripts/corrections_prompt.md). */
  promptPath?: string;
  heartbeatMs?: number;
  claudeTimeoutMs?: number;
  chunkChars?: number;
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface RunJobResult {
  state: "done" | "error";
  error?: string;
}

export const HEARTBEAT_MS = 30_000;
export const CLAUDE_TIMEOUT_MS = 10 * 60_000;
export const CHUNK_CHARS = 12_000;
export const OVERLAP_TURNS = 2;

export function defaultPromptPath(): string {
  return join(homedir(), ".claude/skills/transcribe/scripts/corrections_prompt.md");
}

export function sttDirOf(vaultDir: string, base: string): string {
  return join(vaultDir, "_audio", ".stt", base);
}

// ── fs 헬퍼 ──────────────────────────────────────────────────────────────────

export function atomicWrite(abs: string, content: string): void {
  const tmp = `${abs}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, abs);
}

export function readJobFile(abs: string): JobFile | null {
  try {
    const j = JSON.parse(readFileSync(abs, "utf8")) as JobFile;
    return j && typeof j === "object" && typeof j.state === "string" ? j : null;
  } catch {
    return null;
  }
}

function rmIfExists(abs: string): void {
  try {
    rmSync(abs, { force: true });
  } catch {
    /* ignore */
  }
}

// ── 청크 · 병합 (순수) ───────────────────────────────────────────────────────

export interface TranscriptChunk {
  /** 앞 청크 마지막 턴들 — 문맥용, 프롬프트에 "겹침 구간"으로 표시. */
  overlap: string[];
  turns: string[];
}

/** 화자분리.txt 의 발화 턴 (merge.py 출력 = 빈 줄 구분). */
export function splitTurns(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * 턴 경계로 약 maxChars 단위 분할. 한 턴이 maxChars 보다 길면 그 턴 혼자 한 청크
 * (턴 중간을 자르지 않음 — anchor 가 한 발화 안에 있어야 함). 각 청크(첫 청크 제외)에
 * 앞 청크 마지막 overlapTurns 턴을 겹침으로 붙인다.
 */
export function chunkTranscript(text: string, maxChars = CHUNK_CHARS, overlapTurns = OVERLAP_TURNS): TranscriptChunk[] {
  const turns = splitTurns(text);
  const groups: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const t of turns) {
    const add = (cur.length > 0 ? 2 : 0) + t.length; // "\n\n" join
    if (cur.length > 0 && len + add > maxChars) {
      groups.push(cur);
      cur = [];
      len = 0;
    }
    len += (cur.length > 0 ? 2 : 0) + t.length;
    cur.push(t);
  }
  if (cur.length > 0) groups.push(cur);
  return groups.map((g, i) => ({
    overlap: i === 0 || overlapTurns <= 0 ? [] : groups[i - 1].slice(-overlapTurns),
    turns: g,
  }));
}

export const OVERLAP_HEADER = "### 겹침 구간 (앞 청크 끝부분 — 문맥 참고용, 이 구간에만 있는 항목은 보고하지 마세요)";
export const BODY_HEADER = "### 본 구간 (이 구간의 교정 후보를 보고하세요)";

export function chunkToTranscript(c: TranscriptChunk): string {
  const body = c.turns.join("\n\n");
  if (c.overlap.length === 0) return body;
  return `${OVERLAP_HEADER}\n\n${c.overlap.join("\n\n")}\n\n${BODY_HEADER}\n\n${body}`;
}

/** glossary.json 의 context_hints(dict 또는 list) + notes(list) → 프롬프트 텍스트. */
export function glossaryHints(glossary: unknown): string {
  const g = (glossary && typeof glossary === "object" ? glossary : {}) as Record<string, unknown>;
  const lines: string[] = [];
  const hints = g.context_hints;
  if (hints && typeof hints === "object") {
    lines.push("context_hints:");
    if (Array.isArray(hints)) for (const h of hints) lines.push(`- ${String(h)}`);
    else for (const [k, v] of Object.entries(hints as Record<string, unknown>)) lines.push(`- ${k}: ${String(v)}`);
  }
  if (Array.isArray(g.notes) && g.notes.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("notes:");
    for (const n of g.notes) lines.push(`- ${String(n)}`);
  }
  return lines.length > 0 ? lines.join("\n") : "(단어장 없음)";
}

/** 템플릿 치환 — 선두 HTML 주석(placeholder 설명) 제거. `$` 패턴 해석 피하려 split/join. */
export function fillPrompt(template: string, hints: string, transcript: string): string {
  const body = template.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
  return body.split("{{GLOSSARY_HINTS}}").join(hints).split("{{TRANSCRIPT}}").join(transcript);
}

export type CorrectionItem = Record<string, unknown> & { anchor?: unknown };

/** claude 응답 → JSON 배열. 코드펜스·앞뒤 잡문 허용(첫 `[` ~ 마지막 `]`). 실패 시 throw. */
export function parseCorrections(out: string): CorrectionItem[] {
  let s = out.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(s);
  if (fence) s = fence[1].trim();
  const a = s.indexOf("[");
  const b = s.lastIndexOf("]");
  if (a < 0 || b < a) throw new Error("JSON 배열을 찾을 수 없습니다");
  const parsed: unknown = JSON.parse(s.slice(a, b + 1));
  if (!Array.isArray(parsed)) throw new Error("JSON 배열이 아닙니다");
  return parsed.filter((x): x is CorrectionItem => !!x && typeof x === "object" && !Array.isArray(x));
}

/** 청크 결과 concat + 같은 anchor 중복 제거 (첫 항목 유지). anchor 없는 항목은 그대로 둔다. */
export function mergeCorrections(results: CorrectionItem[][]): CorrectionItem[] {
  const seen = new Set<string>();
  const out: CorrectionItem[] = [];
  for (const items of results) {
    for (const it of items) {
      const a = typeof it.anchor === "string" ? it.anchor : "";
      if (a) {
        if (seen.has(a)) continue;
        seen.add(a);
      }
      out.push(it);
    }
  }
  return out;
}

/**
 * anchor_offsets.py 와 같은 탐색으로 위치를 못 찾는 항목 수 — 그 스크립트는 miss 를
 * 조용히 t=0 으로 둔다. (anchor → 없으면 orig 앞 12자) 다음 orig 앞 8자.
 */
export function countAnchorMisses(trJsonText: string, items: CorrectionItem[]): number {
  let segs: string[] = [];
  try {
    const d = JSON.parse(trJsonText) as { transcription?: Array<{ text?: string }> };
    segs = (d.transcription ?? []).map((s) => String(s.text ?? "").trim());
  } catch {
    return items.length;
  }
  const found = (sub: string) => sub !== "" && segs.some((t) => t.includes(sub));
  const head = (s: unknown, n: number) => Array.from(typeof s === "string" ? s : "").slice(0, n).join("");
  let misses = 0;
  for (const it of items) {
    if (typeof it.t === "number") continue;
    const anchor = (typeof it.anchor === "string" && it.anchor) || head(it.orig, 12);
    if (found(anchor)) continue;
    if (found(head(it.orig, 8))) continue;
    misses++;
  }
  return misses;
}

export function textHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** corrections.partial.json — 실패 청크만 재실행용. */
export interface PartialCorrections {
  sourceHash: string; // 화자분리.txt 해시 (바뀌면 청크 번호가 어긋나므로 재사용 불가)
  chunkChars: number;
  chunkCount: number;
  /** 청크 번호(1부터) → 항목. 성공한 청크만. */
  results: Record<string, CorrectionItem[]>;
  failedChunks: number[];
}

// ── 오케스트레이션 ───────────────────────────────────────────────────────────

class JobError extends Error {
  failedChunks?: number[];
}

export async function runJob(opts: RunJobOptions): Promise<RunJobResult> {
  const { vaultDir, base, kind, exec } = opts;
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((m: string) => console.log(`[jobRunner ${base}] ${m}`));
  const dir = sttDirOf(vaultDir, base);
  const p = (f: string) => join(dir, f);
  const jobPath = p("job.json");
  mkdirSync(dir, { recursive: true });

  // job.json 갱신은 한 프로세스 안에서 직렬화 (heartbeat 와 step 갱신이 겹치지 않게).
  let chain: Promise<void> = Promise.resolve();
  const update = (patch: Partial<JobFile>): Promise<void> => {
    chain = chain.then(() => {
      const cur = readJobFile(jobPath);
      const next: JobFile = {
        state: "running",
        kind,
        step: "queued",
        pid: process.pid,
        startedAt: now().toISOString(),
        heartbeatAt: now().toISOString(),
        ...(cur ?? {}),
        ...patch,
      };
      atomicWrite(jobPath, JSON.stringify(next, null, 2) + "\n");
    });
    return chain;
  };
  const step = (s: string) => {
    log(`step ${s}`);
    return update({ step: s, heartbeatAt: now().toISOString() });
  };

  const hb = setInterval(() => {
    void update({ heartbeatAt: now().toISOString() }).catch(() => {});
  }, opts.heartbeatMs ?? HEARTBEAT_MS);
  hb.unref?.();

  try {
    // 이전 실행의 결과 필드 정리 (서버 claim 의 pid·startedAt·lstart 는 유지).
    await update({ state: "running", kind, error: undefined, failedChunks: undefined, anchorMisses: undefined, finishedAt: undefined });
    if (kind === "diarize") await runDiarize();
    else await runCorrections(kind === "corrections-retry");
    await update({ state: "done", step: "done", finishedAt: now().toISOString(), heartbeatAt: now().toISOString() });
    log("done");
    return { state: "done" };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    log(`error: ${msg}`);
    const patch: Partial<JobFile> = { state: "error", error: msg, finishedAt: now().toISOString(), heartbeatAt: now().toISOString() };
    if (e instanceof JobError && e.failedChunks) patch.failedChunks = e.failedChunks;
    await update(patch);
    return { state: "error", error: msg };
  } finally {
    clearInterval(hb);
    await chain.catch(() => {});
  }

  // ── 단계 1~3 ────────────────────────────────────────────────────────────
  async function runDiarize(): Promise<void> {
    const speakers = opts.speakers;
    if (!Number.isInteger(speakers) || (speakers as number) < 1 || (speakers as number) > 10) {
      throw new Error(`화자 수가 잘못되었습니다: ${String(speakers)}`);
    }
    const names = opts.names ?? [];
    const m4a = join(vaultDir, "_audio", `${base}.m4a`);
    const trJson = p("tr.json");
    if (!existsSync(m4a)) throw new Error("녹음 파일(m4a)이 없습니다");
    if (!existsSync(trJson)) throw new Error("tr.json 이 없습니다 (초벌 전사 필요)");
    await update({ speakers, names, failedChunks: undefined, anchorMisses: undefined, error: undefined });

    const wav = join(opts.tmpDir ?? "/tmp", `${base}.wav`);
    try {
      await step("wav");
      await exec.toWav(m4a, wav);
      await step("diarize");
      const tsv = await exec.diarize(wav, speakers as number);
      if (tsv.trim() === "") throw new Error("diarize 결과가 비어 있습니다");
      atomicWrite(p("diar.tsv"), tsv);
    } finally {
      rmIfExists(wav);
    }

    await step("merge");
    const merged = await exec.merge(trJson, p("diar.tsv"), names);
    if (merged.trim() === "") throw new Error("merge 결과가 비어 있습니다");
    atomicWrite(p("화자분리.txt"), merged.endsWith("\n") ? merged : merged + "\n");

    await step("normalize");
    const glossary = join(vaultDir, "_audio", "glossary.json");
    if (existsSync(glossary)) {
      const report = await exec.normalize(glossary, p("화자분리.txt"));
      atomicWrite(p("normalize.log"), report);
    } else {
      atomicWrite(p("normalize.log"), "[단어장 자동정규화] glossary.json 없음 — 건너뜀\n");
    }

    // 새 화자분리 → 이전 교정 후보는 낡음 (anchored 가 남으면 "리뷰 대기"로 오판).
    for (const f of ["corrections.json", "corrections.partial.json", "anchored.json"]) rmIfExists(p(f));
  }

  // ── 단계 4~5 ────────────────────────────────────────────────────────────
  async function runCorrections(retryOnly: boolean): Promise<void> {
    const diarPath = p("화자분리.txt");
    const trJson = p("tr.json");
    if (!existsSync(diarPath)) throw new Error("화자분리.txt 가 없습니다 (화자분리 먼저)");
    if (!existsSync(trJson)) throw new Error("tr.json 이 없습니다");
    const promptPath = opts.promptPath ?? defaultPromptPath();
    if (!existsSync(promptPath)) throw new Error(`교정 프롬프트를 찾을 수 없습니다: ${promptPath}`);
    const template = readFileSync(promptPath, "utf8");

    let glossary: unknown = {};
    try {
      glossary = JSON.parse(readFileSync(join(vaultDir, "_audio", "glossary.json"), "utf8"));
    } catch {
      /* 없음/깨짐 — 힌트 없이 진행 */
    }
    const hints = glossaryHints(glossary);

    const text = readFileSync(diarPath, "utf8");
    const chunkChars = opts.chunkChars ?? CHUNK_CHARS;
    const chunks = chunkTranscript(text, chunkChars);
    if (chunks.length === 0) throw new Error("화자분리.txt 가 비어 있습니다");
    const sourceHash = textHash(text);

    const results = new Map<number, CorrectionItem[]>();
    let todo = chunks.map((_, i) => i + 1);
    if (retryOnly) {
      const partial = readPartial(p("corrections.partial.json"));
      if (!partial) throw new Error("이전 부분 결과(corrections.partial.json)가 없습니다. 전체 재실행하세요.");
      if (partial.sourceHash !== sourceHash || partial.chunkCount !== chunks.length || partial.chunkChars !== chunkChars) {
        throw new Error("화자분리.txt 가 바뀌어 실패 청크만 재실행할 수 없습니다. 전체 재실행하세요.");
      }
      for (const [k, v] of Object.entries(partial.results)) results.set(Number(k), v);
      todo = partial.failedChunks.filter((n) => n >= 1 && n <= chunks.length && !results.has(n));
    }
    await update({ chunks: chunks.length, failedChunks: undefined, anchorMisses: undefined, error: undefined });

    const timeoutMs = opts.claudeTimeoutMs ?? CLAUDE_TIMEOUT_MS;
    const failed: number[] = [];
    for (const n of todo) {
      await step(`corrections ${n}/${chunks.length}`);
      const prompt = fillPrompt(template, hints, chunkToTranscript(chunks[n - 1]));
      let ok = false;
      for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
        try {
          const out = await exec.claude(prompt, timeoutMs);
          results.set(n, parseCorrections(out));
          ok = true;
        } catch (e) {
          log(`chunk ${n} attempt ${attempt} 실패: ${(e as Error).message}`);
        }
      }
      if (!ok) failed.push(n);
    }

    if (failed.length > 0) {
      const partial: PartialCorrections = {
        sourceHash,
        chunkChars,
        chunkCount: chunks.length,
        results: Object.fromEntries([...results.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v])),
        failedChunks: failed,
      };
      atomicWrite(p("corrections.partial.json"), JSON.stringify(partial, null, 2) + "\n");
      const err = new JobError(`교정 후보 생성에 실패한 청크가 있습니다: ${failed.join(", ")} / ${chunks.length}`);
      err.failedChunks = failed;
      throw err;
    }

    const merged = mergeCorrections(chunks.map((_, i) => results.get(i + 1) ?? []));
    atomicWrite(p("corrections.json"), JSON.stringify(merged, null, 2) + "\n");
    rmIfExists(p("corrections.partial.json"));

    await step("anchor");
    const anchoredOut = await exec.anchor(trJson, p("corrections.json"));
    const anchored: unknown = JSON.parse(anchoredOut); // 깨진 출력이면 anchored.json 을 만들지 않음
    if (!Array.isArray(anchored)) throw new Error("anchor 결과가 배열이 아닙니다");
    const misses = countAnchorMisses(readFileSync(trJson, "utf8"), merged);
    atomicWrite(p("anchored.json"), JSON.stringify(anchored, null, 2) + "\n");
    await update({ anchorMisses: misses });
  }
}

function readPartial(abs: string): PartialCorrections | null {
  try {
    const j = JSON.parse(readFileSync(abs, "utf8")) as PartialCorrections;
    if (!j || typeof j !== "object" || !Array.isArray(j.failedChunks) || typeof j.results !== "object") return null;
    return j;
  } catch {
    return null;
  }
}

/**
 * 서버가 spawn 직후 job.json 에 이 pid 를 기록할 때까지 대기 — runner 의 첫 쓰기가
 * 서버의 claim 기록에 덮이지 않게. timeout 이면 그냥 진행.
 */
export async function waitForClaim(jobPath: string, pid: number, timeoutMs = 30_000, pollMs = 100): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (readJobFile(jobPath)?.pid === pid) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

export interface CliArgs {
  vaultDir: string;
  base: string;
  kind: JobKind;
  speakers?: number;
  names: string[];
}

export function parseCliArgs(argv: string[]): CliArgs {
  const [vaultDir, base, kind, speakersRaw, ...names] = argv;
  if (!vaultDir || !base || !kind) throw new Error("usage: bun server/jobRunner.ts <vaultDir> <base> <kind> [speakers] [name ...]");
  if (!(JOB_KINDS as readonly string[]).includes(kind)) throw new Error(`unknown kind: ${kind}`);
  if (/[/\\]/.test(base) || base.startsWith(".")) throw new Error(`bad base: ${base}`);
  const speakers = speakersRaw !== undefined ? Number(speakersRaw) : undefined;
  return { vaultDir, base, kind: kind as JobKind, speakers, names };
}

// ── CLI entry ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const { defaultExecutors } = await import("./jobExecutors.ts");
  await waitForClaim(join(sttDirOf(args.vaultDir, args.base), "job.json"), process.pid);
  const r = await runJob({ ...args, exec: defaultExecutors() });
  process.exit(r.state === "done" ? 0 : 1);
}

if ((import.meta as { main?: boolean }).main) {
  main().catch((e) => {
    console.error("[jobRunner] fatal:", e);
    process.exit(2);
  });
}
