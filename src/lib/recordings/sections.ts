// 메모 transcript 사이드카 안의 "녹음 섹션" 조작. 순수 모듈 — 서버·클라 공용.
//
// 섹션 = `## {시각} · {base}` 헤딩 한 줄 + 다음 헤딩 전까지의 본문.
// 첫 헤딩 앞의 머리말(기존 사이드카 내용)은 항상 그대로 둔다.
//
// 헤딩 판정: `## ` 로 시작하고 ` · <base>` 로 끝나는 줄 — base 는 문자열 그대로 일치
// (정규식 안 씀, base 에 공백·`-`·한글 가능).
//
// 섹션 끝 규칙: knownBases 가 주어지면 "그 중 하나로 끝나는 `## ` 줄"만 경계로 본다
// (섹션 본문 안의 사용자 `## 소제목` 은 본문으로 취급). 안 주면 폴백으로 **모든** `## ` 줄이
// 경계 — 이때 본문 안 `## ` 소제목은 섹션을 끊는다(### 이하는 영향 없음).
//
// 줄바꿈 정책: 정규형 = 섹션 사이 빈 줄 1개, 파일 끝 `\n` 1개. insert 는 이 형태로 붙이고,
// 끝 섹션을 remove 하면 앞 텍스트 끝 공백줄을 `\n` 1개로 접는다(정규형 텍스트에 대해 왕복 무손실).

import { baseSortKey } from "./base";

const PREFIX = "## ";
const SEP = " · ";

export interface SectionRange {
  base: string;
  start: number; // 헤딩 줄 시작 offset
  bodyStart: number; // 헤딩 줄 다음 offset
  end: number; // 다음 경계 헤딩 시작 또는 text.length
  heading: string;
  body: string; // text.slice(bodyStart, end), 원문 그대로
}

interface Line {
  start: number;
  text: string; // 개행 제외 (\r 제거)
  next: number; // 다음 줄 시작
}

function splitLines(text: string): Line[] {
  const out: Line[] = [];
  let pos = 0;
  while (pos < text.length) {
    let nl = text.indexOf("\n", pos);
    const next = nl === -1 ? text.length : nl + 1;
    if (nl === -1) nl = text.length;
    let t = text.slice(pos, nl);
    if (t.endsWith("\r")) t = t.slice(0, -1);
    out.push({ start: pos, text: t, next });
    pos = next;
  }
  return out;
}

function endsWithBase(line: string, base: string): boolean {
  return (
    line.startsWith(PREFIX) &&
    line.endsWith(SEP + base) &&
    line.length >= PREFIX.length + SEP.length + base.length
  );
}

// 헤딩 줄이면 base 반환. knownBases 있으면 그 중 하나와 정확히 일치해야 함.
function headingBase(line: string, knownBases?: readonly string[]): string | null {
  if (!line.startsWith(PREFIX)) return null;
  if (knownBases) {
    for (const b of knownBases) if (endsWithBase(line, b)) return b;
    return null;
  }
  const i = line.lastIndexOf(SEP);
  if (i < PREFIX.length) return null;
  const b = line.slice(i + SEP.length);
  return b || null;
}

function isBoundary(line: string, knownBases?: readonly string[]): boolean {
  if (knownBases) return headingBase(line, knownBases) !== null;
  return line.startsWith(PREFIX);
}

export function findSection(
  text: string,
  base: string,
  knownBases?: readonly string[],
): SectionRange | null {
  // 경계 판정에 base 자신도 포함해야 한다.
  const bounds = knownBases && !knownBases.includes(base) ? [...knownBases, base] : knownBases;
  const ls = splitLines(text);
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (!endsWithBase(l.text, base)) continue;
    let end = text.length;
    for (let j = i + 1; j < ls.length; j++) {
      if (isBoundary(ls[j].text, bounds)) {
        end = ls[j].start;
        break;
      }
    }
    return {
      base,
      start: l.start,
      bodyStart: l.next,
      end,
      heading: l.text,
      body: text.slice(l.next, end),
    };
  }
  return null;
}

// 본문 앞 빈 줄·뒤 공백 제거 (첫 줄 들여쓰기는 보존).
function trimBody(body: string): string {
  return body.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/\s+$/, "");
}

export interface InsertInput {
  base: string;
  timeLabel: string;
  body: string;
  sortKey: string;
}

export function insertSection(
  text: string,
  input: InsertInput,
  knownBases?: readonly string[],
): string {
  if (findSection(text, input.base, knownBases)) return text; // 멱등

  const label = input.timeLabel || "시각 미상";
  const chunk = `${PREFIX}${label}${SEP}${input.base}\n\n${trimBody(input.body)}\n`;

  // 기존 녹음 섹션 중 sortKey 가 더 큰 첫 섹션 앞에 끼운다 (동률은 뒤).
  let insertAt = text.length;
  for (const l of splitLines(text)) {
    const b = headingBase(l.text, knownBases);
    if (b === null) continue;
    if (baseSortKey(b) > input.sortKey) {
      insertAt = l.start;
      break;
    }
  }

  const before = text.slice(0, insertAt);
  const after = text.slice(insertAt);
  let prefix = "";
  if (before.length > 0) {
    if (before.endsWith("\n\n")) prefix = "";
    else if (before.endsWith("\n")) prefix = "\n";
    else prefix = "\n\n";
  }
  const gap = after.length > 0 ? "\n" : "";
  return before + prefix + chunk + gap + after;
}

// 헤딩을 못 찾으면 null (텍스트 무변경 — 호출자가 audio: 만 제거).
export function removeSection(
  text: string,
  base: string,
  knownBases?: readonly string[],
): { text: string; body: string } | null {
  const s = findSection(text, base, knownBases);
  if (!s) return null;
  let before = text.slice(0, s.start);
  const after = text.slice(s.end);
  if (after.length === 0 && before.length > 0) {
    before = before.replace(/\n+$/, "") + "\n";
    if (before.trim() === "") before = "";
  }
  return { text: before + after, body: trimBody(s.body) };
}

// 헤딩 유지, 본문만 교체. 헤딩 없으면 null.
export function replaceSectionBody(
  text: string,
  base: string,
  newBody: string,
  knownBases?: readonly string[],
): string | null {
  const s = findSection(text, base, knownBases);
  if (!s) return null;
  const tail = s.end < text.length ? "\n\n" : "\n";
  return text.slice(0, s.bodyStart) + "\n" + trimBody(newBody) + tail + text.slice(s.end);
}

// 앞뒤 공백 trim 후 FNV-1a 32bit -> hex. (`updateMeeting` 이 끝에 `\n` 을 붙이므로 trim 필수)
export function sectionHash(body: string): string {
  const t = body.trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
