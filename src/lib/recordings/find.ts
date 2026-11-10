import { turnsOf, updateTurnText, type ParsedTranscript } from "./turns";

/** turnIndex = turnsOf 기준 순번, [start, end) = 그 턴 text 안의 글자 범위. */
export interface FindMatch {
  turnIndex: number;
  start: number;
  end: number;
}

function occurrences(text: string, q: string, cs: boolean): number[] {
  const hay = cs ? text : text.toLowerCase();
  const needle = cs ? q : q.toLowerCase();
  const out: number[] = [];
  // 소문자화로 길이가 달라지는 드문 글자는 원문 인덱스가 어긋나므로 그 턴은 건너뜁니다.
  if (!needle || hay.length !== text.length) return out;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = hay.indexOf(needle, i + needle.length);
  }
  return out;
}

/** 모든 턴 본문에서 q 를 찾는다(겹침 없이, 순서대로). 빈 q 는 []. */
export function findInTranscript(parsed: ParsedTranscript, q: string, caseSensitive: boolean): FindMatch[] {
  if (!q) return [];
  const res: FindMatch[] = [];
  turnsOf(parsed).forEach((t, turnIndex) => {
    for (const start of occurrences(t.text, q, caseSensitive)) {
      res.push({ turnIndex, start, end: start + q.length });
    }
  });
  return res;
}

/** match 한 곳만 r 로 바꾼다. 범위가 현재 text 와 안 맞으면 원본 그대로. */
export function replaceOne(parsed: ParsedTranscript, match: FindMatch, r: string): ParsedTranscript {
  const turn = turnsOf(parsed)[match.turnIndex];
  if (!turn || match.start < 0 || match.end > turn.text.length || match.start > match.end) return parsed;
  const next = turn.text.slice(0, match.start) + r + turn.text.slice(match.end);
  return updateTurnText(parsed, match.turnIndex, next);
}

/** q 전부를 r 로 바꾼다. 바뀐 턴만 updateTurnText 로 다시 쓴다. */
export function replaceAll(
  parsed: ParsedTranscript,
  q: string,
  r: string,
  caseSensitive: boolean,
): ParsedTranscript {
  if (!q) return parsed;
  let cur = parsed;
  turnsOf(parsed).forEach((t, i) => {
    const hits = occurrences(t.text, q, caseSensitive);
    if (hits.length === 0) return;
    let out = "";
    let pos = 0;
    for (const h of hits) {
      out += t.text.slice(pos, h) + r;
      pos = h + q.length;
    }
    out += t.text.slice(pos);
    if (out !== t.text) cur = updateTurnText(cur, i, out);
  });
  return cur;
}
