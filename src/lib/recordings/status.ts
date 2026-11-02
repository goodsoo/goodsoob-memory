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
    moved: boolean; // moved.json
    rawPromoted: boolean; // 옛 초벌 승격 마커 (새로 쓰지 않음)
    anchored: boolean; // anchored.json
    diarized: boolean; // 화자분리.txt
    /** anchored.json 중 결정 안 된 후보 수. 생략 = 모름(anchored 면 리뷰 중으로 취급). */
    reviewLeft?: number;
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

// 우선순위: 연결됨(-> 이사 미완료) > 휴지통 > 미정/전사본 없음.
// 옛 `archived` 마커는 무시 — 보관 기능 폐기(D-R3), 미정으로 취급.
export function computeDestination(f: RecordingFacts): Destination {
  if (f.linked) return f.hasTxt || !f.stt.moved ? "moveIncomplete" : "linked";
  if (f.trashed) return "trash";
  if (f.stt.moved && f.orphanSectionFound === false) return "transcriptMissing";
  return "undecided";
}

// 위에서부터 첫 일치. "corrected" 일 때만 연결 가능 (D-R1, 서버 link 게이트와 같은 판정).
// 리뷰 = anchored.json 이 있고 결정 안 된 후보가 남음. 다 결정하면 교정 중(화자분리 작업 파일)으로.
export function computePipeline(f: RecordingFacts): Pipeline {
  if (!f.hasM4a) return "textOnly";
  if (f.job?.state === "running" && f.job.pidAlive) return "processing";
  if (f.job?.state === "error" || (f.job?.state === "running" && !f.job.pidAlive)) return "error";
  if (f.stt.anchored && (f.stt.reviewLeft ?? 1) > 0) return "review";
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
