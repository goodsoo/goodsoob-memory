// 녹음 탭 인박스 — 사이드바 묶음 · 다음 할 일 문구 · 선택 이동. 순수 모듈.
import type { RecordingItem } from "./merge";

export interface InboxGroups {
  /** 처리할 것 — 행선지 미정(전사본 없음 포함). 서버 정렬(날짜 desc) 유지. */
  todo: RecordingItem[];
  /** 끝난 것 — 연결됨(이사 미완료 포함) + 휴지통 메모에 연결됨. */
  done: RecordingItem[];
}

export function isDone(it: RecordingItem): boolean {
  const d = it.status.destination;
  return d === "linked" || d === "moveIncomplete" || d === "trash";
}

export function groupInbox(items: readonly RecordingItem[]): InboxGroups {
  const todo: RecordingItem[] = [];
  const done: RecordingItem[] = [];
  for (const it of items) (isDone(it) ? done : todo).push(it);
  return { todo, done };
}

/** 연결 가능 = 파이프라인 교정본 (텍스트만은 교정본 txt 가 있을 때). 서버 link 게이트와 같은 판정. */
export function canLink(it: RecordingItem): boolean {
  const { pipeline } = it.status;
  if (pipeline === "corrected") return true;
  return pipeline === "textOnly" && it.entry.hasTxt && !it.entry.stt.rawPromoted;
}

/** 사이드바 행 셋째 줄 — 다음 할 일 (회색 작은 글자). */
export function nextStepLabel(it: RecordingItem): string {
  const { destination, pipeline } = it.status;
  if (destination === "trash") return "휴지통 메모에 연결됨";
  if (destination === "linked" || destination === "moveIncomplete") return "연결됨";
  if (destination === "transcriptMissing") return "전사본 없음";
  switch (pipeline) {
    case "waiting":
      return "전사 대기";
    case "raw":
      return "인원 입력";
    case "processing":
      return it.entry.job?.kind === "diarize" ? "화자 나누는 중" : "고칠 곳 찾는 중";
    case "error":
      return "오류";
    case "review": {
      const n = it.entry.stt.reviewLeft;
      return n > 0 ? `고칠 곳 ${n}개` : "고칠 곳 확인";
    }
    case "correction":
      return "듣고 고치기";
    case "corrected":
      return "연결 대기";
    case "textOnly":
      return canLink(it) ? "연결 대기" : "텍스트만";
  }
}

export const SHORT_RECORDING_SEC = 30;

/** "30초 미만 선택" — 길이를 아는 것만. */
export function shortRecordingBases(items: readonly RecordingItem[], limitSec = SHORT_RECORDING_SEC): string[] {
  return items
    .filter((i) => i.entry.durationSec !== null && i.entry.durationSec < limitSec)
    .map((i) => i.entry.base);
}

/**
 * 연결·삭제 뒤 이동할 다음 녹음. `order` = 처리할 것 목록(작업 직전 스냅숏).
 * current 다음의 남은 항목 → 없으면 앞쪽의 가장 가까운 남은 항목 → 없으면 null.
 * current 가 목록에 없으면(끝난 것에서 지움 등) 남은 첫 항목.
 */
export function nextAfterRemoval(
  order: readonly string[],
  removed: Iterable<string>,
  current: string | null,
): string | null {
  const gone = new Set(removed);
  const idx = current === null ? -1 : order.indexOf(current);
  if (idx < 0) return order.find((b) => !gone.has(b)) ?? null;
  for (let i = idx + 1; i < order.length; i++) if (!gone.has(order[i])) return order[i];
  for (let i = idx - 1; i >= 0; i--) if (!gone.has(order[i])) return order[i];
  return null;
}
