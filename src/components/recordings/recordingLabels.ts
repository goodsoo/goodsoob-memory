import type { RecordingEntry } from "../../api/recordings";

/** "오전·오후 h:mm" (voice & tone 시간 형식). */
export function formatClock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${String(m).padStart(2, "0")}`;
}

/** 목록용 짧은 날짜 "5월 23일" (올해가 아니면 "2025년 5월 23일"). */
export function formatShortDate(iso: string, now = new Date()): string {
  const [y, m, d] = iso.split("-").map(Number);
  return y === now.getFullYear() ? `${m}월 ${d}일` : `${y}년 ${m}월 ${d}일`;
}

/** 녹음 시각 라벨. base 에 날짜가 없으면 ffprobe creation_time, 그것도 없으면 "날짜 미상". */
export function recordingWhen(e: Pick<RecordingEntry, "parsed" | "creationTime">, now = new Date()): string {
  const { date, time } = e.parsed;
  if (date) return time ? `${formatShortDate(date, now)} ${formatClock(time)}` : formatShortDate(date, now);
  if (e.creationTime) {
    const d = new Date(e.creationTime);
    if (!Number.isNaN(d.getTime())) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const t = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      return `${formatShortDate(iso, now)} ${formatClock(t)}`;
    }
  }
  return "날짜 미상";
}

/** "1시간 12분" / "32분" / "45초". null = "". */
export function formatDuration(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return "";
  const s = Math.round(sec);
  if (s < 60) return `${s}초`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h}시간 ${rest}분` : `${h}시간`;
}

/** 녹음의 label 이 base 와 다르면(주제·사람 접미사) 부제로 보여준다. */
export function recordingSubtitle(e: Pick<RecordingEntry, "base" | "parsed">): string | null {
  return e.parsed.label !== e.base ? e.parsed.label.replace(/_/g, " ") : null;
}

/** 409 등 서버 code → 사용자 안내 (원인 + 해결). 서버 메시지가 이미 한국어라 기본은 그대로. */
export function recordingErrorMessage(err: unknown): string {
  const e = err as { code?: string; message?: string };
  switch (e?.code) {
    case "busy":
      return "이 녹음은 다른 요청이 처리 중입니다. 잠시 후 다시 시도하세요.";
    case "alreadyMoved":
      return "전사본이 이미 다른 메모로 옮겨졌습니다. 먼저 그 메모에서 연결을 해제하세요.";
    case "noTranscript":
      return "아직 전사본이 없습니다. 전사가 끝난 뒤 다시 시도하세요.";
    case "titleConflict":
      return "같은 제목의 메모가 이미 있습니다. 다른 제목을 입력하세요.";
    default:
      return e?.message || "요청에 실패했습니다. 잠시 후 다시 시도하세요.";
  }
}
