// 녹음 목록(서버) + 메모 역참조(클라 useMeetings·휴지통의 `audio:`) 병합. 순수 모듈.
import type { RecordingEntry } from "../../api/recordings";
import {
  computeStatus,
  countsTowardToday,
  type RecordingFacts,
  type RecordingStatus,
} from "./status";

/** 역참조에 필요한 메모 필드만. */
export interface MemoRef {
  id: string;
  uid: string;
  title: string;
  date: string | null;
  mtime: number;
  audio: string[];
}

export interface RecordingItem {
  entry: RecordingEntry;
  status: RecordingStatus;
  /** 휴지통 아닌 메모 중 audio: 에 이 base 가 있는 것. */
  memos: MemoRef[];
  /** 휴지통 메모 중 audio: 에 이 base 가 있는 것. */
  trashedMemos: MemoRef[];
}

/** 서버 `known` 파라미터 — 메모(+휴지통)의 audio: 에 등장하는 base 전부, 정렬·중복 제거. */
export function collectKnownBases(memos: readonly MemoRef[], trashed: readonly MemoRef[]): string[] {
  const s = new Set<string>();
  for (const m of memos) for (const b of m.audio) s.add(b);
  for (const m of trashed) for (const b of m.audio) s.add(b);
  return [...s].sort();
}

function indexByBase(list: readonly MemoRef[]): Map<string, MemoRef[]> {
  const idx = new Map<string, MemoRef[]>();
  for (const m of list) {
    for (const b of m.audio) {
      const arr = idx.get(b);
      if (arr) arr.push(m);
      else idx.set(b, [m]);
    }
  }
  return idx;
}

export function toFacts(entry: RecordingEntry, linked: boolean, trashed: boolean): RecordingFacts {
  return {
    hasM4a: entry.hasM4a,
    hasTxt: entry.hasTxt,
    stt: entry.stt,
    job: entry.job ? { state: entry.job.state, pidAlive: entry.job.pidAlive } : null,
    linked,
    trashed: !linked && trashed,
    orphanSectionFound: entry.orphan === undefined ? undefined : entry.orphan !== false,
  };
}

export function mergeRecordings(
  entries: readonly RecordingEntry[],
  memos: readonly MemoRef[],
  trashed: readonly MemoRef[],
): RecordingItem[] {
  const live = indexByBase(memos);
  const dead = indexByBase(trashed);
  return entries.map((entry) => {
    const lm = live.get(entry.base) ?? [];
    const tm = dead.get(entry.base) ?? [];
    return {
      entry,
      status: computeStatus(toFacts(entry, lm.length > 0, tm.length > 0)),
      memos: lm,
      trashedMemos: tm,
    };
  });
}

export function countTodayRecordings(items: readonly RecordingItem[]): number {
  return items.filter((i) => countsTowardToday(i.status)).length;
}

/** 처리 중인 job 이 하나라도 있으면 true (refetchInterval 트리거). 행선지 무관. */
export function anyProcessing(entries: readonly RecordingEntry[] | undefined): boolean {
  return !!entries?.some((e) => e.job?.state === "running" && e.job.pidAlive);
}

// ── 기존 메모 연결 후보 ──────────────────────────────────────────────────────

/** 녹음 시작 시각(로컬, ms). base 에 날짜+시각이 있어야 함. */
export function recordingStartMs(entry: Pick<RecordingEntry, "parsed">): number | null {
  const { date, time } = entry.parsed;
  if (!date || !time) return null;
  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, hh, mm).getTime();
}

/**
 * 후보 정렬: ① 메모 date 가 녹음 날짜와 같고 mtime 이 녹음 구간 안 → ② 같은 날짜.
 * 그 밖의 메모는 검색으로 (호출자). 이미 이 녹음에 연결된 메모는 제외.
 */
export function rankLinkCandidates(
  entry: Pick<RecordingEntry, "base" | "parsed" | "durationSec">,
  memos: readonly MemoRef[],
): { inWindow: MemoRef[]; sameDate: MemoRef[] } {
  const date = entry.parsed.date;
  if (!date) return { inWindow: [], sameDate: [] };
  const start = recordingStartMs(entry);
  const end = start !== null && entry.durationSec ? start + entry.durationSec * 1000 : null;
  const inWindow: MemoRef[] = [];
  const sameDate: MemoRef[] = [];
  for (const m of memos) {
    if (m.date !== date || m.audio.includes(entry.base)) continue;
    if (start !== null && end !== null && m.mtime >= start && m.mtime <= end) inWindow.push(m);
    else sameDate.push(m);
  }
  const byMtime = (a: MemoRef, b: MemoRef) => b.mtime - a.mtime;
  return { inWindow: inWindow.sort(byMtime), sameDate: sameDate.sort(byMtime) };
}

/** "이사 미완료" 복구 대상 — 옮길 텍스트가 실제로 있을 때만 (없으면 서버가 409 noTranscript). */
export function needsMoveRepair(it: RecordingItem): boolean {
  if (it.status.destination !== "moveIncomplete" || it.memos.length === 0) return false;
  const e = it.entry;
  return e.hasTxt || e.stt.moved || e.stt.done;
}
