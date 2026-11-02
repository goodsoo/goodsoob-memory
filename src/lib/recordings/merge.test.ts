import { describe, expect, it } from "vitest";
import type { RecordingEntry } from "../../api/recordings";
import { parseBase } from "./base";
import {
  anyProcessing,
  collectKnownBases,
  countTodayRecordings,
  mergeRecordings,
  needsMoveRepair,
  rankLinkCandidates,
  toFacts,
  type MemoRef,
} from "./merge";
import { parseRecordingHash, recordingHash } from "./hash";

const NO_STT = { done: false, moved: false, rawPromoted: false, anchored: false, diarized: false, reviewLeft: 0 };

function entry(base: string, over: Partial<RecordingEntry> = {}): RecordingEntry {
  return {
    base,
    parsed: parseBase(base),
    hasM4a: true,
    hasTxt: false,
    stt: { ...NO_STT },
    job: null,
    durationSec: 1800,
    creationTime: null,
    syncPending: false,
    firstLine: null,
    ...over,
    ...(over.stt ? { stt: { ...NO_STT, ...over.stt } } : {}),
  };
}

function memo(uid: string, over: Partial<MemoRef> = {}): MemoRef {
  return { id: `inbox/${uid}.md`, uid, title: uid, date: null, mtime: 0, audio: [], ...over };
}

describe("collectKnownBases", () => {
  it("메모 + 휴지통 audio: 합집합, 중복 제거·정렬", () => {
    const known = collectKnownBases(
      [memo("a", { audio: ["20261028-1300", "x"] }), memo("b", { audio: ["x"] })],
      [memo("t", { audio: ["20261001-0900"] })],
    );
    expect(known).toEqual(["20261001-0900", "20261028-1300", "x"]);
  });
  it("audio 없으면 빈 배열", () => {
    expect(collectKnownBases([memo("a")], [])).toEqual([]);
  });
});

describe("toFacts", () => {
  it("orphan: 없음=확인 안 함, false=못 찾음, string=찾음", () => {
    expect(toFacts(entry("b"), false, false).orphanSectionFound).toBeUndefined();
    expect(toFacts(entry("b", { orphan: false }), false, false).orphanSectionFound).toBe(false);
    expect(toFacts(entry("b", { orphan: "work/x.md" }), false, false).orphanSectionFound).toBe(true);
  });
  it("연결됨이 휴지통보다 우선", () => {
    const f = toFacts(entry("b"), true, true);
    expect(f.linked).toBe(true);
    expect(f.trashed).toBe(false);
  });
});

describe("mergeRecordings", () => {
  const B = "20261028-1300";
  it("살아 있는 메모의 audio: → 연결됨 (moved, txt 없음)", () => {
    const [it] = mergeRecordings(
      [entry(B, { stt: { ...NO_STT, moved: true, done: true } })],
      [memo("m", { audio: [B] })],
      [],
    );
    expect(it.status.destination).toBe("linked");
    expect(it.memos.map((m) => m.uid)).toEqual(["m"]);
  });
  it("txt 가 남아 있으면 이사 미완료 → 복구 대상", () => {
    const [it] = mergeRecordings([entry(B, { hasTxt: true })], [memo("m", { audio: [B] })], []);
    expect(it.status.destination).toBe("moveIncomplete");
    expect(needsMoveRepair(it)).toBe(true);
  });
  it("연결됐지만 옮길 전사본이 아직 없으면 복구하지 않음 (409 noTranscript 반복 방지)", () => {
    const [it] = mergeRecordings([entry(B)], [memo("m", { audio: [B] })], []);
    expect(it.status.destination).toBe("moveIncomplete");
    expect(needsMoveRepair(it)).toBe(false);
  });
  it("휴지통 메모에만 있으면 휴지통", () => {
    const [it] = mergeRecordings(
      [entry(B, { stt: { ...NO_STT, moved: true, done: true } })],
      [],
      [memo("t", { audio: [B] })],
    );
    expect(it.status.destination).toBe("trash");
    expect(it.trashedMemos.map((m) => m.uid)).toEqual(["t"]);
  });
  it("moved 인데 어디에도 없고 orphan=false → 전사본 없음", () => {
    const [it] = mergeRecordings([entry(B, { stt: { ...NO_STT, moved: true }, orphan: false })], [], []);
    expect(it.status.destination).toBe("transcriptMissing");
  });
});

describe("countTodayRecordings", () => {
  it("미정+초벌/교정본 + 행선지 무관 오류/리뷰/교정 대기, 텍스트만·전사 대기·처리 중 제외", () => {
    const items = mergeRecordings(
      [
        entry("20261028-0900", { stt: { ...NO_STT, done: true } }), // 미정 초벌 → O
        entry("20261028-1000", { hasTxt: true }), // 미정 교정본 → O
        entry("20261028-1100"), // 전사 대기 → X
        entry("20261028-1200", { hasM4a: false, hasTxt: true }), // 텍스트만 → X
        entry("20261028-1300", { job: { state: "running", pidAlive: true } }), // 처리 중 → X
        entry("20261028-1500", { stt: { ...NO_STT, moved: true, done: true, diarized: true } }), // 연결됨 교정 대기 → O
        entry("20261028-1600", { job: { state: "running", pidAlive: false } }), // 죽은 job = 오류 → O
      ],
      [memo("m", { audio: ["20261028-1500"] })],
      [],
    );
    expect(countTodayRecordings(items)).toBe(4);
  });
});

describe("anyProcessing", () => {
  it("running + pid 생존만", () => {
    expect(anyProcessing(undefined)).toBe(false);
    expect(anyProcessing([entry("a", { job: { state: "running", pidAlive: false } })])).toBe(false);
    expect(anyProcessing([entry("a"), entry("b", { job: { state: "running", pidAlive: true } })])).toBe(true);
  });
});

describe("rankLinkCandidates", () => {
  const e = entry("20261028-1300", { durationSec: 3600 });
  const start = new Date(2026, 9, 28, 13, 0).getTime();
  it("같은 날짜 + mtime 이 녹음 구간 안 → inWindow, 나머지 같은 날짜 → sameDate, 다른 날짜·이미 연결 제외", () => {
    const r = rankLinkCandidates(e, [
      memo("in", { date: "2026-10-28", mtime: start + 10 * 60_000 }),
      memo("after", { date: "2026-10-28", mtime: start + 2 * 3600_000 }),
      memo("other-day", { date: "2026-10-27", mtime: start }),
      memo("linked", { date: "2026-10-28", mtime: start, audio: ["20261028-1300"] }),
      memo("nodate", { mtime: start }),
    ]);
    expect(r.inWindow.map((m) => m.uid)).toEqual(["in"]);
    expect(r.sameDate.map((m) => m.uid)).toEqual(["after"]);
  });
  it("날짜 없는 녹음은 후보 없음 (검색으로)", () => {
    const r = rankLinkCandidates(entry("New-Recording-3"), [memo("a", { date: "2026-10-28" })]);
    expect(r).toEqual({ inWindow: [], sameDate: [] });
  });
});

describe("recording hash", () => {
  it("한글·공백 base 왕복", () => {
    const b = "20260826_카페미팅_정진용-공경철 2";
    expect(parseRecordingHash(recordingHash(b))).toBe(b);
    expect(parseRecordingHash("#recordings")).toBeNull();
    expect(parseRecordingHash("#meeting-x")).toBeNull();
  });
});
