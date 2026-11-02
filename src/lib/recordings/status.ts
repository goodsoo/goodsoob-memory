// 녹음 상태 두 축 (행선지 / 파이프라인) 계산. 순수 모듈 — 디스크·메모 스캔은 호출자가 사실(facts)로 넘긴다.

export interface JobFacts {
  state: "running" | "error" | "done" | string;
  pidAlive: boolean;
}

export interface RecordingFacts {
  hasM4a: boolean;
  hasTxt: boolean; // _audio/<base>.txt
  stt: {
    done: boolean;
    archived: boolean;
    moved: boolean; // moved.json
    rawPromoted: boolean;
    anchored: boolean; // anchored.json
    diarized: boolean; // 화자분리.txt
  };
  job?: JobFacts | null;
  linked: boolean; // 휴지통 아닌 메모의 audio: 에 base 있음
  trashed: boolean; // 휴지통 메모의 audio: 에만 있음 (linked 가 우선)
  // moved.json 있는데 어느 메모에도 없을 때 서버가 brain 전체에서 ` · <base>` 헤딩을 찾은 결과.
  // undefined = 확인 안 함 (미정으로 취급).
  orphanSectionFound?: boolean;
}

export type Destination =
  | "linked"
  | "moveIncomplete"
  | "trash"
  | "archived"
  | "undecided"
  | "transcriptMissing";

export type Pipeline =
  | "textOnly"
  | "processing"
  | "error"
  | "review"
  | "correction"
  | "corrected"
  | "raw"
  | "waiting";

export interface RecordingStatus {
  destination: Destination;
  pipeline: Pipeline;
}

// 우선순위: 연결됨(-> 이사 미완료) > 휴지통 > 보관됨 > 미정/전사본 없음.
export function computeDestination(f: RecordingFacts): Destination {
  if (f.linked) return f.hasTxt || !f.stt.moved ? "moveIncomplete" : "linked";
  if (f.trashed) return "trash";
  if (f.stt.archived) return "archived";
  if (f.stt.moved && f.orphanSectionFound === false) return "transcriptMissing";
  return "undecided";
}

// 위에서부터 첫 일치.
export function computePipeline(f: RecordingFacts): Pipeline {
  if (!f.hasM4a) return "textOnly";
  if (f.job?.state === "running" && f.job.pidAlive) return "processing";
  if (f.job?.state === "error" || (f.job?.state === "running" && !f.job.pidAlive)) return "error";
  if (f.stt.anchored) return "review";
  if (f.stt.diarized) return "correction";
  const hasText = f.hasTxt || f.stt.moved;
  if (hasText && !f.stt.rawPromoted) return "corrected";
  if (f.stt.done || (hasText && f.stt.rawPromoted)) return "raw";
  return "waiting";
}

export function computeStatus(f: RecordingFacts): RecordingStatus {
  return { destination: computeDestination(f), pipeline: computePipeline(f) };
}

// 오늘 블록 "처리할 녹음 N": 행선지 미정 + (텍스트만·전사 대기·처리 중 제외),
// 또는 행선지 무관하게 오류·리뷰 대기·교정 대기.
export function countsTowardToday(s: RecordingStatus): boolean {
  if (s.pipeline === "error" || s.pipeline === "review" || s.pipeline === "correction") return true;
  if (s.destination !== "undecided") return false;
  return s.pipeline === "corrected" || s.pipeline === "raw";
}
