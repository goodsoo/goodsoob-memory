// 녹음 탭 서버 API 클라이언트 (server/recordings.ts). 응답 타입은 서버 export 와 같은 모양을
// 여기 다시 선언한다 — server/ 는 node:fs 등을 import 해 클라 tsconfig 로 끌어오지 않는다.
import type { Meeting } from "./meetings";
import type { ParsedBase } from "../lib/recordings/base";
import type { VaultAdapter } from "../lib/vault/adapter";

export interface RecordingSttMarkers {
  done: boolean;
  archived: boolean;
  moved: boolean;
  rawPromoted: boolean;
  anchored: boolean;
  diarized: boolean;
}

export interface RecordingJob {
  state: string;
  pidAlive: boolean;
  step?: string;
  error?: string; // "interrupted" = runner 비정상 종료
  kind?: "diarize" | "corrections" | "corrections-retry";
  failedChunks?: number[]; // 1부터
  anchorMisses?: number;
}

export interface RecordingEntry {
  base: string;
  parsed: ParsedBase;
  hasM4a: boolean;
  hasTxt: boolean;
  stt: RecordingSttMarkers;
  job: RecordingJob | null;
  durationSec: number | null;
  creationTime: string | null;
  syncPending: boolean;
  /** string = 헤딩을 가진 사이드카의 메모 path, false = 어디에도 없음, 없음 = 확인 안 함. */
  orphan?: string | false;
}

export interface LinkResponse {
  meeting: Meeting;
  insertedSection: boolean;
  raw: boolean;
  created: boolean;
}

export interface UnlinkResponse {
  meeting: Meeting;
  textKept: boolean;
}

export type LinkBody = { memo: string } | { newMemo: { title: string; folder?: string } };

/** 서버가 `{error, code}` 로 돌려준 실패. message = 서버의 한국어 안내(원인 + 해결). */
export class RecordingApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RecordingApiError";
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new RecordingApiError(0, "network", `서버에 연결하지 못했습니다. 앱 서버가 켜져 있는지 확인하세요. (${(e as Error).message})`);
  }
  if (!res.ok) {
    let code = "internal";
    let message = `요청에 실패했습니다 (${res.status}). 잠시 후 다시 시도하세요.`;
    try {
      const j = (await res.json()) as { error?: string; code?: string };
      if (j.code) code = j.code;
      if (j.error) message = j.error;
    } catch {
      // 본문 없음 — 기본 문구
    }
    throw new RecordingApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return call<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

const enc = encodeURIComponent;

export async function listRecordings(known: readonly string[]): Promise<RecordingEntry[]> {
  const q = known.length > 0 ? `?known=${enc(known.join(","))}` : "";
  const r = await call<{ recordings: RecordingEntry[] }>(`/api/recordings${q}`);
  return r.recordings;
}

export function linkRecording(base: string, body: LinkBody): Promise<LinkResponse> {
  return post(`/api/recordings/${enc(base)}/link`, body);
}

export function unlinkRecording(base: string, memo: string): Promise<UnlinkResponse> {
  return post(`/api/recordings/${enc(base)}/unlink`, { memo });
}

export function archiveRecording(base: string): Promise<{ ok: true; raw: boolean }> {
  return post(`/api/recordings/${enc(base)}/archive`);
}

export function unarchiveRecording(base: string): Promise<{ ok: true }> {
  return post(`/api/recordings/${enc(base)}/unarchive`);
}

export function diarizeRecording(
  base: string,
  body: { speakers: number; names?: string[] },
): Promise<{ job: RecordingJob }> {
  return post(`/api/recordings/${enc(base)}/diarize`, body);
}

export function correctionsRecording(
  base: string,
  body: { retryFailed?: boolean } = {},
): Promise<{ job: RecordingJob }> {
  return post(`/api/recordings/${enc(base)}/corrections`, body);
}

export function audioUrl(base: string): string {
  return `/api/audio?base=${enc(base)}`;
}

/**
 * 연결 전 전사본 미리보기 (읽기 전용). `_audio/<base>.txt` 우선, 없으면 whisper 초벌
 * `.stt/<base>/tr.txt`(done 이 있을 때만). 둘 다 없으면 null.
 */
export async function readRecordingTranscript(
  adapter: VaultAdapter,
  entry: Pick<RecordingEntry, "base" | "hasTxt" | "stt">,
): Promise<{ text: string; raw: boolean } | null> {
  if (entry.hasTxt) {
    return { text: await adapter.read(`_audio/${entry.base}.txt`), raw: entry.stt.rawPromoted };
  }
  if (entry.stt.done && !entry.stt.moved) {
    const p = `_audio/.stt/${entry.base}/tr.txt`;
    if (await adapter.exists(p)) return { text: await adapter.read(p), raw: true };
  }
  return null;
}
