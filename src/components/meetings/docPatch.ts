import type { Meeting, MeetingUpdate } from "../../api/meetings";

export type MetaDoc = {
  date: string;
  time: string;
  attendees: string;
};

// 전체 메모 도큐먼트 = 1 history stack (옵시디안/notion 패턴).
// __source = 마지막 set 의 출처 ("body"/"transcript"/"summary"/"meta:*"). undo/redo 시
// 자동으로 그 탭으로 setActiveTab 하는 UX 용 metadata. docsEqual / diffDocPatch 에서 무시.
export type DocSnapshot = {
  body: string;
  transcript: string;
  summary: string; // V0.7.3 — 마크다운 텍스트 통째. 본문과 동일 모델.
  meta: MetaDoc;
  __source?: string;
};

// 저장 단위 칸. meta 도 date/time/attendees 각각 독립.
export type DocField = "body" | "transcript" | "summary" | "date" | "time" | "attendees";

const PATCH_KEY: Record<DocField, keyof MeetingUpdate> = {
  body: "content",
  transcript: "transcript",
  summary: "summary",
  date: "date",
  time: "time",
  attendees: "attendees",
};

function rawField(d: DocSnapshot, f: DocField): string {
  switch (f) {
    case "body":
      return d.body;
    case "transcript":
      return d.transcript;
    case "summary":
      return d.summary;
    default:
      return d.meta[f];
  }
}

// 칸 하나의 patch 값 — 옛 docToPatch 와 같은 정규화 (빈 transcript/summary = null =
// 사이드카 삭제, meta 는 trim 후 빈 값 null).
function fieldPatch(d: DocSnapshot, f: DocField): MeetingUpdate {
  switch (f) {
    case "body":
      return { content: d.body };
    case "transcript":
      return { transcript: d.transcript || null };
    case "summary":
      return { summary: d.summary || null };
    case "date":
      return { date: d.meta.date || null };
    case "time":
      return { time: d.meta.time.trim() || null };
    case "attendees":
      return { attendees: d.meta.attendees.trim() || null };
  }
}

const ALL_FIELDS: DocField[] = ["body", "transcript", "summary", "date", "time", "attendees"];

/**
 * 직전 commit(`prev`) 대비 **바뀐 칸만** 담은 patch. 안 바뀐 칸은 key 자체가 없다 →
 * updateMeeting 이 그 파일을 건드리지 않음. D5 (recording-tab.md): 폼이 연 뒤 디스크의
 * transcript 사이드카가 바뀌어도(녹음 연결 등) 본문만 고친 저장이 옛 transcript 로
 * 덮어쓰거나 빈 값으로 사이드카를 지우지 않게 하는 핵심.
 * `force` = 이전 저장이 실패해 다시 보내야 하는 칸 (값 비교 없이 포함).
 */
export function diffDocPatch(
  prev: DocSnapshot,
  next: DocSnapshot,
  force: Iterable<DocField> = [],
): MeetingUpdate {
  const forced = new Set(force);
  let patch: MeetingUpdate = {};
  for (const f of ALL_FIELDS) {
    if (forced.has(f) || rawField(prev, f) !== rawField(next, f)) {
      patch = { ...patch, ...fieldPatch(next, f) };
    }
  }
  return patch;
}

/** 지정 칸만 현재 값으로 담은 patch (재시도용). */
export function fieldsPatch(d: DocSnapshot, fields: Iterable<DocField>): MeetingUpdate {
  let patch: MeetingUpdate = {};
  for (const f of fields) patch = { ...patch, ...fieldPatch(d, f) };
  return patch;
}

/** patch 에 들어 있는 칸 목록 (실패 시 재시도 대상 기록용). title 등 doc 밖 key 는 무시. */
export function patchFields(patch: MeetingUpdate): DocField[] {
  return ALL_FIELDS.filter((f) => patch[PATCH_KEY[f]] !== undefined);
}

/** 디스크에서 읽은 Meeting → 폼 스냅샷. history reset 시 fresh 데이터로 시작할 때 사용. */
export function meetingToDocSnapshot(m: Meeting): DocSnapshot {
  return {
    body: m.content ?? "",
    transcript: m.transcript ?? "",
    summary: m.summary ?? "",
    meta: {
      date: m.date ?? "",
      time: m.time ?? "",
      attendees: m.attendees ? m.attendees.join(", ") : "",
    },
  };
}
