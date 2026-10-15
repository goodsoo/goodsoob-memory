// 일정(schedule) 파서 — 체크박스 없는 "날짜-우선" 이벤트 불릿.
// 포맷: `- {시작일}[..{종료일}] [{HH:MM}] {텍스트}`
//   - 2026-06-15 14:30 팀 회의
//   - 2026-06-15 워크샵                (종일)
//   - 2026-06-15..2026-06-17 출장       (다일)
//   - 2026-06-15..2026-06-17 14:30 컨퍼런스
// 할 일과 의도적으로 반대 축: task 는 텍스트-우선 + 체크박스, 일정은 날짜-우선 +
// 체크박스 없음(이벤트는 "완료"가 아니라 "발생/참석"). 날짜/범위/시각 토큰 형태는
// tasks.ts 와 동일 규칙(ISO, `..` 범위, HH:MM)을 재사용 — 단 leading-date 라서
// 별도 앵커 정규식만 신규.

// 일정 = 앱 소유 단일 파일. `_` prefix 로 메모장 노트 스캔에서 제외 (_tasks 와 동 네임스페이스).
export const SCHEDULE_PATH = "_schedule.md";

// 줄 시작이 날짜(또는 날짜범위)인 불릿만 이벤트. 체크박스(`- [ ] …`)는 content 가
// `[` 로 시작해 아래 LEADING_*_RE 에 안 걸리므로 자연히 제외된다.
const BULLET_RE = /^(\s*)- (.+)$/;
const LEADING_RANGE_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})\b/;
const LEADING_DATE_RE = /^(\d{4}-\d{2}-\d{2})\b/;
const LEADING_TIME_RE = /^(\d{1,2}):(\d{2})\b/;

export interface ParsedEvent {
  text: string;
  start: string; // ISO YYYY-MM-DD
  end?: string; // ISO YYYY-MM-DD (포함). 단일일이면 undefined.
  time?: string; // HH:MM
  source: { file: string; line: number }; // line 은 0-based
}

export function extractEvents(filePath: string, raw: string): ParsedEvent[] {
  const lines = raw.split("\n");
  const events: ParsedEvent[] = [];
  let inCodeFence = false;
  let codeFenceMarker = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^(```|~~~)/);
    if (fence) {
      if (!inCodeFence) {
        inCodeFence = true;
        codeFenceMarker = fence[1];
      } else if (line.startsWith(codeFenceMarker)) {
        inCodeFence = false;
      }
      continue;
    }
    if (inCodeFence) continue;

    const bullet = line.match(BULLET_RE);
    if (!bullet) continue;
    const parsed = parseEventContent(bullet[2].trim());
    if (!parsed) continue; // 날짜로 시작 안 하면 이벤트 아님
    events.push({ ...parsed, source: { file: filePath, line: i } });
  }

  return events;
}

function parseEventContent(
  content: string,
): { text: string; start: string; end?: string; time?: string } | null {
  let start: string;
  let end: string | undefined;
  let rest: string;

  const range = content.match(LEADING_RANGE_RE);
  if (range) {
    start = range[1];
    // end < start (역전) 은 무효 — 단일일로 강등. end === start 는 단일일.
    if (range[2] > range[1]) end = range[2];
    rest = content.slice(range[0].length);
  } else {
    const date = content.match(LEADING_DATE_RE);
    if (!date) return null;
    start = date[1];
    rest = content.slice(date[0].length);
  }

  rest = rest.replace(/^\s+/, "");
  let time: string | undefined;
  const tm = rest.match(LEADING_TIME_RE);
  if (tm) {
    time = `${tm[1].padStart(2, "0")}:${tm[2]}`;
    rest = rest.slice(tm[0].length).replace(/^\s+/, "");
  }

  return { text: rest.trim(), start, end, time };
}

// 이벤트 한 줄 직렬화. 체크박스 없음. end 가 start 보다 뒤일 때만 `..` 범위.
export function buildEventLine(input: {
  start: string;
  end?: string | null;
  time?: string | null;
  text: string;
}): string {
  let line = `- ${input.start}`;
  if (input.end && input.end > input.start) line += `..${input.end}`;
  if (input.time) line += ` ${input.time}`;
  const text = input.text.trim();
  if (text) line += ` ${text}`;
  return line;
}
