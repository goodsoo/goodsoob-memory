import { describe, it, expect } from "vitest";
import {
  computeStatus,
  computeDestination,
  computePipeline,
  type RecordingFacts,
} from "./status";

function facts(over: Partial<Omit<RecordingFacts, "stt">> & { stt?: Partial<RecordingFacts["stt"]> } = {}): RecordingFacts {
  const { stt, ...rest } = over;
  return {
    hasM4a: true,
    hasTxt: false,
    linked: false,
    trashed: false,
    stt: {
      done: false,
      moved: false,
      rawPromoted: false,
      anchored: false,
      diarized: false,
      ...stt,
    },
    ...rest,
  };
}

describe("행선지 축", () => {
  const cases: [string, RecordingFacts, string][] = [
    ["연결됨 (txt 삭제 + moved.json)", facts({ linked: true, stt: { moved: true, done: true } }), "linked"],
    ["이사 미완료: txt 남음", facts({ linked: true, hasTxt: true, stt: { moved: true } }), "moveIncomplete"],
    ["이사 미완료: moved.json 없음", facts({ linked: true }), "moveIncomplete"],
    ["휴지통", facts({ trashed: true, stt: { moved: true } }), "trash"],
    ["연결됨이 휴지통보다 우선", facts({ linked: true, trashed: true, stt: { moved: true } }), "linked"],
    ["미정", facts({ stt: { done: true } }), "undecided"],
    ["미정: txt 만 있음", facts({ hasTxt: true }), "undecided"],
    ["moved.json 있고 고아 섹션 발견 -> 미정(복구 버튼)", facts({ stt: { moved: true }, orphanSectionFound: true }), "undecided"],
    ["moved.json 있고 고아 섹션 없음 -> 전사본 없음", facts({ stt: { moved: true }, orphanSectionFound: false }), "transcriptMissing"],
    ["moved.json 있고 확인 전(undefined) -> 미정", facts({ stt: { moved: true } }), "undecided"],
  ];
  it.each(cases)("%s", (_n, f, want) => expect(computeDestination(f)).toBe(want));
});

describe("파이프라인 축 (위에서부터 첫 일치)", () => {
  const cases: [string, RecordingFacts, string][] = [
    ["0 텍스트만 (m4a 없음)", facts({ hasM4a: false, hasTxt: true }), "textOnly"],
    ["0 이 job 보다 우선", facts({ hasM4a: false, hasTxt: true, job: { state: "running", pidAlive: true } }), "textOnly"],
    ["1 처리 중", facts({ job: { state: "running", pidAlive: true }, stt: { done: true } }), "processing"],
    ["2 오류 (state=error)", facts({ job: { state: "error", pidAlive: false } }), "error"],
    ["2 오류 (pid 사망 감지)", facts({ job: { state: "running", pidAlive: false } }), "error"],
    ["3 리뷰 대기", facts({ stt: { anchored: true, diarized: true, done: true } }), "review"],
    ["3 리뷰 대기 (남은 후보 2)", facts({ stt: { anchored: true, diarized: true, reviewLeft: 2 } }), "review"],
    ["4 후보 전부 결정 → 교정 대기", facts({ stt: { anchored: true, diarized: true, reviewLeft: 0 } }), "correction"],
    ["4 교정 대기", facts({ stt: { diarized: true, done: true } }), "correction"],
    ["5 교정본 (txt)", facts({ hasTxt: true, stt: { done: true } }), "corrected"],
    ["5 교정본 (moved.json)", facts({ linked: true, stt: { moved: true, done: true } }), "corrected"],
    ["6 초벌 (done)", facts({ stt: { done: true } }), "raw"],
    ["6 초벌 (txt + raw-promoted)", facts({ hasTxt: true, stt: { rawPromoted: true } }), "raw"],
    ["6 초벌 (moved + raw-promoted)", facts({ stt: { moved: true, rawPromoted: true } }), "raw"],
    ["7 전사 대기", facts(), "waiting"],
    ["job done 은 무시", facts({ job: { state: "done", pidAlive: false } }), "waiting"],
    ["job null", facts({ job: null }), "waiting"],
  ];
  it.each(cases)("%s", (_n, f, want) => expect(computePipeline(f)).toBe(want));

  it("연결된 녹음도 job 은 처리 중으로 판정", () => {
    const f = facts({ linked: true, stt: { moved: true }, job: { state: "running", pidAlive: true } });
    expect(computeStatus(f)).toEqual({ destination: "linked", pipeline: "processing" });
  });
});

