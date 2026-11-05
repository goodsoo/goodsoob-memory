// 녹음 탭 서버 API 클라이언트 (server/recordings.ts). 응답 타입은 서버 export 와 같은 모양을
// 여기 다시 선언한다 — server/ 는 node:fs 등을 import 해 클라 tsconfig 로 끌어오지 않는다.
import type { Meeting } from "./meetings";
import type { ParsedBase } from "../lib/recordings/base";

export interface RecordingSttMarkers {
  done: boolean;
  moved: boolean;
  rawPromoted: boolean; // 옛 초벌 승격 마커 (읽기만)
  anchored: boolean;
  diarized: boolean;
  reviewLeft: number; // anchored.json 중 결정 안 된 후보 수
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
  /** 작업 파일 첫 발화 ≈60자 (식별용). */
  firstLine: string | null;
}

export interface DeleteRecordingsResponse {
  deleted: string[];
  failed: Array<{ base: string; code: string; error: string }>;
}

export type TranscriptSource = "diarized" | "corrected" | "raw";

export interface RecordingTranscript {
  text: string;
  source: TranscriptSource;
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

export interface RecordingReview {
  items: ReviewItem[];
  decisions: Record<string, ReviewDecision>;
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
  /** 서버가 함께 돌려준 필드 (예: conflict 의 현재 `mtime`). */
  extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "RecordingApiError";
    this.status = status;
    this.code = code;
    this.extra = extra;
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
    let extra: Record<string, unknown> = {};
    try {
      const j = (await res.json()) as { error?: string; code?: string } & Record<string, unknown>;
      const { error, code: c, ...rest } = j;
      if (c) code = c;
      if (error) message = error;
      extra = rest;
    } catch {
      // 본문 없음 — 기본 문구
    }
    throw new RecordingApiError(res.status, code, message, extra);
  }
  return (await res.json()) as T;
}

function post<T>(path: string, body?: unknown, method: "POST" | "PUT" = "POST"): Promise<T> {
  return call<T>(path, {
    method,
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

/** 휴지통(`~/.Trash/goodsoob-녹음/`)으로 이동. 항목별 결과 — 일부 실패해도 200. */
export function deleteRecordings(bases: readonly string[]): Promise<DeleteRecordingsResponse> {
  return post(`/api/recordings/delete`, { bases });
}

/** 작업 파일 (화자분리 → 교정본 → 초벌 순). */
export function getRecordingTranscript(base: string): Promise<RecordingTranscript> {
  return call(`/api/recordings/${enc(base)}/transcript`);
}

/** 작업 파일 저장. 409 conflict(extra.mtime = 현재) · rawReadonly · linked. */
export function putRecordingTranscript(base: string, text: string, mtime: number): Promise<RecordingTranscript> {
  return post(`/api/recordings/${enc(base)}/transcript`, { text, mtime }, "PUT");
}

/** 교정 완료 — 화자분리.txt → 교정본, 중간물 정리. */
export function completeRecording(base: string): Promise<RecordingTranscript> {
  return post(`/api/recordings/${enc(base)}/complete`);
}

export function getRecordingReview(base: string): Promise<RecordingReview> {
  return call(`/api/recordings/${enc(base)}/review`);
}

export function postRecordingReview(base: string, id: number, decision: ReviewDecision): Promise<RecordingReview> {
  return post(`/api/recordings/${enc(base)}/review`, { id, decision });
}

export function diarizeRecording(
  base: string,
  body: { speakers: number; names?: string[] }, // speakers 0 = 자동
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
