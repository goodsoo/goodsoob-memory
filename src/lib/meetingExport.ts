// 메모 마크다운 복사 / .md 내보내기 — 사이드바 컨텍스트 메뉴와 메모 타이틀바 …
// 메뉴가 공유하는 단일 source. 복사는 copyText 2단 경로, 내보내기는 섹션별 파일을
// 브라우저 download (<a download>) 로 내려받는다.
import type { Meeting } from "../api/meetings";
import { copyText } from "./clipboard";
import {
  meetingToMarkdown,
  type MeetingMarkdownInput,
  type MeetingMarkdownSection,
} from "./markdown";

// 사이드바 list 항목(content/transcript/summary 가 빈 string)이 아닌, getMeeting 으로
// 읽은 full Meeting 을 마크다운 입력 형태로. content → body 필드 매핑.
export function meetingToMarkdownInput(m: Meeting): MeetingMarkdownInput {
  return {
    title: m.title,
    date: m.date,
    time: m.time,
    attendees: m.attendees,
    body: m.content,
    transcript: m.transcript,
    summary: m.summary,
  };
}

// 섹션 UI 라벨 (탭 이름과 통일).
export const SECTION_LABELS: Record<MeetingMarkdownSection, string> = {
  body: "메모",
  transcript: "음성 기록",
  summary: "요약",
};

// 해당 섹션에 내보낼 내용이 있는지 (빈 섹션은 내보내기 체크박스 비활성).
export function sectionHasContent(
  meeting: MeetingMarkdownInput,
  section: MeetingMarkdownSection,
): boolean {
  const v =
    section === "body"
      ? meeting.body
      : section === "transcript"
        ? meeting.transcript
        : meeting.summary;
  return typeof v === "string" && v.trim().length > 0;
}

// 파일명 안전화 — 파일시스템/옵시디안 금지 문자를 _ 로. 빈 제목은 "메모".
function safeFilename(title: string | null | undefined): string {
  const base = (title ?? "").trim() || "메모";
  return base.replace(/[/\\:*?"<>|#^[\]]/g, "_");
}

// 저장 파일명 — 본문(메모)은 제목 그대로, 음성기록/요약은 제목 뒤에 라벨 suffix.
export function sectionFilename(
  title: string | null | undefined,
  section: MeetingMarkdownSection,
): string {
  const base = safeFilename(title);
  if (section === "body") return `${base}.md`;
  const label = section === "transcript" ? "음성기록" : "요약";
  return `${base} (${label}).md`;
}

export async function copyMeetingMarkdown(
  meeting: MeetingMarkdownInput,
  section: MeetingMarkdownSection = "body",
): Promise<boolean> {
  return copyText(meetingToMarkdown(meeting, section));
}

// 브라우저 download API 로 .md 파일 하나를 내려받는다.
function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 선택한 섹션들을 각각 브라우저 download 로 내려받는다. 저장된 파일명 목록 반환.
export function exportMeetingSections(
  meeting: MeetingMarkdownInput,
  sections: MeetingMarkdownSection[],
): string[] {
  const written: string[] = [];
  for (const section of sections) {
    const name = sectionFilename(meeting.title, section);
    const md = meetingToMarkdown(meeting, section);
    downloadMarkdown(name, md);
    written.push(name);
  }
  return written;
}
