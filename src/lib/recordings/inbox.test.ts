import { describe, expect, it } from "vitest";
import type { RecordingEntry } from "../../api/recordings";
import { parseBase } from "./base";
import { canLink, groupInbox, nextAfterRemoval, nextStepLabel, shortRecordingBases } from "./inbox";
import { mergeRecordings, type MemoRef } from "./merge";

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

function memo(uid: string, audio: string[]): MemoRef {
  return { id: `inbox/${uid}.md`, uid, title: uid, date: null, mtime: 0, audio };
}

function one(e: RecordingEntry, memos: MemoRef[] = [], trashed: MemoRef[] = []) {
  return mergeRecordings([e], memos, trashed)[0];
}

describe("nextStepLabel", () => {
  const cases: Array<[string, RecordingEntry, string]> = [
    ["전사 대기", entry("a"), "받아쓰는 중"],
    ["초벌", entry("a", { stt: { ...NO_STT, done: true } }), "자동 받아쓰기"],
    [
      "화자분리 중",
      entry("a", { stt: { ...NO_STT, done: true }, job: { state: "running", pidAlive: true, kind: "diarize" } }),
      "말한 사람 나누는 중",
    ],
    [
      "교정 후보 중",
      entry("a", { stt: { ...NO_STT, diarized: true }, job: { state: "running", pidAlive: true, kind: "corrections" } }),
      "고칠 곳 찾는 중",
    ],
    ["오류", entry("a", { job: { state: "error", pidAlive: false } }), "처리 실패"],
    ["리뷰", entry("a", { stt: { ...NO_STT, diarized: true, anchored: true, reviewLeft: 12 } }), "고칠 곳 12개"],
    ["교정 중", entry("a", { stt: { ...NO_STT, diarized: true } }), "고치는 중"],
    ["교정본", entry("a", { hasTxt: true }), "보낼 준비 됨"],
    ["텍스트만 교정본", entry("a", { hasM4a: false, hasTxt: true }), "보낼 준비 됨"],
    ["텍스트만 초벌", entry("a", { hasM4a: false, hasTxt: true, stt: { ...NO_STT, rawPromoted: true } }), "글만 있음"],
  ];
  for (const [name, e, want] of cases) {
    it(name, () => expect(nextStepLabel(one(e))).toBe(want));
  }
  it("연결됨 · 휴지통 메모", () => {
    const linked = one(entry("a", { stt: { ...NO_STT, moved: true } }), [memo("m", ["a"])]);
    expect(nextStepLabel(linked)).toBe("메모로 보냄");
    const trashed = one(entry("a", { stt: { ...NO_STT, moved: true } }), [], [memo("t", ["a"])]);
    expect(nextStepLabel(trashed)).toBe("메모가 휴지통에 있음");
  });
});

describe("groupInbox", () => {
  it("처리할 것 = 미정(텍스트만 포함), 끝난 것 = 연결됨 + 휴지통 메모, 순서 유지", () => {
    const items = mergeRecordings(
      [
        entry("20261030-0900", { stt: { ...NO_STT, done: true } }),
        entry("20261029-0900", { stt: { ...NO_STT, moved: true } }),
        entry("20261028-0900", { hasM4a: false, hasTxt: true }),
        entry("20261027-0900", { stt: { ...NO_STT, moved: true } }),
      ],
      [memo("m", ["20261029-0900"])],
      [memo("t", ["20261027-0900"])],
    );
    const g = groupInbox(items);
    expect(g.todo.map((i) => i.entry.base)).toEqual(["20261030-0900", "20261028-0900"]);
    expect(g.done.map((i) => i.entry.base)).toEqual(["20261029-0900", "20261027-0900"]);
  });
});

describe("canLink", () => {
  it("교정본만", () => {
    expect(canLink(one(entry("a", { hasTxt: true })))).toBe(true);
    expect(canLink(one(entry("a", { stt: { ...NO_STT, diarized: true } })))).toBe(false);
    expect(canLink(one(entry("a", { stt: { ...NO_STT, done: true } })))).toBe(false);
  });
});

describe("shortRecordingBases", () => {
  it("30초 미만만, 길이 모르면 제외", () => {
    const items = mergeRecordings(
      [
        entry("a", { durationSec: 12 }),
        entry("b", { durationSec: 30 }),
        entry("c", { durationSec: null }),
        entry("d", { durationSec: 29.6 }),
      ],
      [],
      [],
    );
    expect(shortRecordingBases(items)).toEqual(["a", "d"]);
  });
});

describe("nextAfterRemoval", () => {
  const order = ["a", "b", "c", "d"];
  it("다음 항목", () => expect(nextAfterRemoval(order, ["b"], "b")).toBe("c"));
  it("여러 개 지우면 남은 다음", () => expect(nextAfterRemoval(order, ["b", "c"], "b")).toBe("d"));
  it("끝이면 앞쪽 가장 가까운 것", () => expect(nextAfterRemoval(order, ["d"], "d")).toBe("c"));
  it("다 지우면 null", () => expect(nextAfterRemoval(order, order, "a")).toBeNull());
  it("목록 밖이면 남은 첫 항목", () => expect(nextAfterRemoval(order, ["a"], "x")).toBe("b"));
});
