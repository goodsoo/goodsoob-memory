// 전사 텍스트 ↔ 화자별 턴 구조. 순수 모듈 — 서버·클라 공용.
//
// 지원 형식 (실측):
//  - bracket  (화자분리 merge.py): `[mm:ss] 이름: 발화` 한 줄 한 턴, 빈 줄 구분.
//  - timeline (옛 사이드카):       `mm:ss 이름` 줄 + 다음 줄부터 발화, 빈 줄 구분.
//  - `#`~`######` 헤딩 줄은 heading 블록 (메모 사이드카의 `## {시각} · {base}` 녹음 섹션 경계).
//  - 그 외 줄은 text 블록으로 원문 그대로 보존(머리말·소제목 아래 메모 등).
// 한 파일 안에 두 형식이 섞여도 턴마다 style 을 기억 → 읽은 형식 그대로 다시 쓴다.
// 턴이 2개 미만이면 format "plain" (호출측이 평문 textarea 로 표시).
//
// 무손실: 블록마다 내용 뒤 공백(빈 줄·개행)을 trail 로 들고, lead 는 첫 블록 앞 공백.
// 블록 렌더는 필드에서 원문을 정확히 재구성하도록 설계 → 수정 안 한 입력은 바이트 동일 왕복.

export type TurnStyle = "bracket" | "timeline";
export type TranscriptFormat = TurnStyle | "plain";

export interface TurnBlock {
  kind: "turn";
  /** 원문 표기 그대로 (`00:18`, `1:02:03`). */
  time: string;
  timeSec: number;
  speaker: string;
  /** 발화. 여러 줄이면 `\n` 으로 이어짐 (원문 줄 끝 공백 보존). */
  text: string;
  style: TurnStyle;
  /** timeline 형식 이름 줄 끝 공백(`\r` 포함) — 왕복 보존용. */
  headTail: string;
  trail: string;
}

export interface HeadingBlock {
  kind: "heading";
  raw: string;
  /** `## … · {base}` 의 base (knownBases 가 있으면 그 중 일치하는 것만). */
  base?: string;
  trail: string;
}

export interface TextBlock {
  kind: "text";
  raw: string;
  trail: string;
}

export type Block = TurnBlock | HeadingBlock | TextBlock;

export interface ParsedTranscript {
  format: TranscriptFormat;
  /** 첫 블록 앞 공백 줄. */
  lead: string;
  blocks: Block[];
}

const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?`;
const BRACKET_RE = new RegExp(String.raw`^\[(${TIME})\] ([^\n]+?): ([^\n]*)$`);
const TIMELINE_RE = new RegExp(String.raw`^(${TIME}) (\S[^\n]*?)([ \t\r]*)$`);
const HEADING_RE = /^#{1,6} /;
const MAX_SPEAKER = 24;
const SEP = " · ";

export function timeToSec(t: string): number {
  const parts = t.split(":").map((p) => parseInt(p, 10));
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** `## …` 헤딩 줄이 ` · {base}` 로 끝나면 일치하는 base (긴 것 우선), 아니면 null. */
export function matchHeadingBase(line: string, audio: readonly string[]): string | null {
  if (!line.startsWith("## ")) return null;
  let best: string | null = null;
  for (const b of audio) {
    if (!b) continue;
    const tail = SEP + b;
    if (
      line.endsWith(tail) &&
      line.length >= 3 + tail.length &&
      (best === null || b.length > best.length)
    ) {
      best = b;
    }
  }
  return best;
}

function headingBaseOf(line: string, knownBases?: readonly string[]): string | undefined {
  if (knownBases) return matchHeadingBase(line, knownBases) ?? undefined;
  if (!line.startsWith("## ")) return undefined;
  const i = line.lastIndexOf(SEP);
  if (i < 3) return undefined;
  const b = line.slice(i + SEP.length).trim();
  return b || undefined;
}

const isBlank = (l: string) => /^[ \t\r]*$/.test(l);

function bracketMatch(line: string) {
  const m = BRACKET_RE.exec(line);
  if (!m || m[2].length > MAX_SPEAKER) return null;
  return { time: m[1], speaker: m[2], text: m[3] };
}

function timelineHeader(line: string) {
  const m = TIMELINE_RE.exec(line);
  if (!m || m[2].length > MAX_SPEAKER) return null;
  return { time: m[1], speaker: m[2], headTail: m[3] };
}

export function parseTranscript(text: string, knownBases?: readonly string[]): ParsedTranscript {
  const lines = text.split("\n");
  const starts: number[] = [];
  {
    let off = 0;
    for (const l of lines) {
      starts.push(off);
      off += l.length + 1;
    }
  }
  const n = lines.length;

  // 턴 시작 줄인지 — timeline 은 다음 줄이 발화(비어있지 않고 헤딩·턴 시작 아님)여야 함.
  const isTurnStartAt = (i: number): boolean => {
    if (bracketMatch(lines[i])) return true;
    if (!timelineHeader(lines[i])) return false;
    const next = lines[i + 1];
    return (
      next !== undefined &&
      !isBlank(next) &&
      !HEADING_RE.test(next) &&
      !bracketMatch(next) &&
      !timelineHeader(next)
    );
  };
  // 이어지는 줄(발화 연속·text 블록 연속) 종료 조건.
  const isBreak = (i: number) =>
    i >= n || isBlank(lines[i]) || HEADING_RE.test(lines[i]) || isTurnStartAt(i);

  type NoTrail<T> = T extends unknown ? Omit<T, "trail"> : never;
  type Raw = { block: NoTrail<Block>; a: number; b: number };
  const raws: Raw[] = [];
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    if (HEADING_RE.test(line)) {
      const base = headingBaseOf(line, knownBases);
      raws.push({
        block: base ? { kind: "heading", raw: line, base } : { kind: "heading", raw: line },
        a: i,
        b: i + 1,
      });
      i++;
      continue;
    }
    const bm = bracketMatch(line);
    if (bm) {
      let j = i + 1;
      while (!isBreak(j)) j++;
      const textLines = [bm.text, ...lines.slice(i + 1, j)];
      raws.push({
        block: {
          kind: "turn",
          time: bm.time,
          timeSec: timeToSec(bm.time),
          speaker: bm.speaker,
          text: textLines.join("\n"),
          style: "bracket",
          headTail: "",
        },
        a: i,
        b: j,
      });
      i = j;
      continue;
    }
    if (isTurnStartAt(i)) {
      const h = timelineHeader(line)!;
      let j = i + 2;
      while (!isBreak(j)) j++;
      raws.push({
        block: {
          kind: "turn",
          time: h.time,
          timeSec: timeToSec(h.time),
          speaker: h.speaker,
          text: lines.slice(i + 1, j).join("\n"),
          style: "timeline",
          headTail: h.headTail,
        },
        a: i,
        b: j,
      });
      i = j;
      continue;
    }
    let j = i + 1;
    while (!isBreak(j)) j++;
    raws.push({ block: { kind: "text", raw: lines.slice(i, j).join("\n") }, a: i, b: j });
    i = j;
  }

  let bracket = 0;
  let timeline = 0;
  for (const r of raws) {
    if (r.block.kind !== "turn") continue;
    if (r.block.style === "bracket") bracket++;
    else timeline++;
  }
  if (bracket + timeline < 2) {
    return {
      format: "plain",
      lead: "",
      blocks: text === "" ? [] : [{ kind: "text", raw: text, trail: "" }],
    };
  }

  const blocks: Block[] = raws.map((r, k) => {
    const end = starts[r.b - 1] + lines[r.b - 1].length;
    const nextStart = k + 1 < raws.length ? starts[raws[k + 1].a] : text.length;
    return { ...r.block, trail: text.slice(end, nextStart) } as Block;
  });
  return {
    format: bracket >= timeline ? "bracket" : "timeline",
    lead: raws.length ? text.slice(0, starts[raws[0].a]) : text,
    blocks,
  };
}

function renderBlock(b: Block): string {
  if (b.kind === "heading" || b.kind === "text") return b.raw;
  if (b.style === "bracket") return `[${b.time}] ${b.speaker}: ${b.text}`;
  return b.text === ""
    ? `${b.time} ${b.speaker}${b.headTail}`
    : `${b.time} ${b.speaker}${b.headTail}\n${b.text}`;
}

export function serializeTranscript(p: ParsedTranscript): string {
  let out = p.lead;
  for (const b of p.blocks) out += renderBlock(b) + b.trail;
  return out;
}

/** 블록 배열에서 turn 만 (하이라이트 turnIndex 기준 순서). */
export function turnsOf(p: ParsedTranscript): TurnBlock[] {
  return p.blocks.filter((b): b is TurnBlock => b.kind === "turn");
}

/** 첫 등장 순 unique 화자. 색 배정 순서의 기준. */
export function speakersInOrder(p: ParsedTranscript): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of turnsOf(p)) {
    if (!seen.has(t.speaker)) {
      seen.add(t.speaker);
      out.push(t.speaker);
    }
  }
  return out;
}

/**
 * 화자 이름 일괄 변경. 빈 이름·줄바꿈·`:`(bracket 재파싱 깨짐)·너무 긴 이름은 무시(원본 반환).
 * 기존 다른 화자 이름으로 바꾸면 두 화자가 합쳐진다(의도된 동작).
 */
export function renameSpeaker(p: ParsedTranscript, from: string, to: string): ParsedTranscript {
  const name = to.trim();
  if (!name || name === from || !validSpeakerName(name)) return p;
  return {
    ...p,
    blocks: p.blocks.map((b) => (b.kind === "turn" && b.speaker === from ? { ...b, speaker: name } : b)),
  };
}

function validSpeakerName(name: string): boolean {
  return !/[\n\r:]/.test(name) && name.length <= MAX_SPEAKER;
}

/**
 * 턴 하나의 화자만 바꾼다(화자분리가 잘못 붙인 발화 고치기). index = turn 순번(turnsOf 기준).
 * 이름 규칙은 renameSpeaker 와 같고, 범위 밖·같은 화자·잘못된 이름이면 원본 반환.
 */
export function setTurnSpeaker(p: ParsedTranscript, index: number, speaker: string): ParsedTranscript {
  const name = speaker.trim();
  if (!name || !validSpeakerName(name)) return p;
  let k = -1;
  let hit = false;
  const blocks = p.blocks.map((b) => {
    if (b.kind !== "turn") return b;
    k++;
    if (k !== index || b.speaker === name) return b;
    hit = true;
    return { ...b, speaker: name };
  });
  return hit ? { ...p, blocks } : p;
}

/** 아직 안 쓰는 가장 작은 `화자N` — 화자분리가 놓친 사람을 새로 추가할 때. */
export function nextSpeakerName(speakers: readonly string[]): string {
  const used = new Set(speakers);
  let n = 0;
  while (used.has(`화자${n}`)) n++;
  return `화자${n}`;
}

/**
 * 발화 교체. index = turn 순번(turnsOf 기준). 빈 줄은 블록 경계라 접고 앞뒤 공백 trim.
 * 범위 밖 index 는 원본 반환.
 */
export function updateTurnText(p: ParsedTranscript, index: number, text: string): ParsedTranscript {
  const clean = text
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]*(?:\n[ \t]*)+/g, "\n")
    .trim();
  let k = -1;
  let hit = false;
  const blocks = p.blocks.map((b) => {
    if (b.kind !== "turn") return b;
    k++;
    if (k !== index) return b;
    hit = true;
    return { ...b, text: clean };
  });
  return hit ? { ...p, blocks } : p;
}
