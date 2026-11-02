// 교정 후보 → 턴 화면 하이라이트 매핑 (D-R7). 순수 모듈.
import type { RecordingReview, ReviewItem } from "../../api/recordings";
import { turnsOf, updateTurnText, type ParsedTranscript } from "./turns";

export interface ReviewHighlight {
  /** TranscriptTurns 의 하이라이트 슬롯과 같은 모양. id = 후보 id 문자열. */
  id: string;
  turnIndex: number;
  start: number;
  end: number;
  kind: string;
  item: ReviewItem;
  /** 턴 안에서 찾은 구절 (hl[0] 또는 orig). */
  needle: string;
  /** 수락 시 바꿀 문자열. null = 제안 없음(B·C 류) → 수락 불가. */
  replacement: string | null;
}

export interface ReviewMapping {
  /** 결정 안 된 후보 중 위치를 찾은 것, 턴·위치 순. */
  highlights: ReviewHighlight[];
  /** 결정 안 된 후보 중 어느 턴에서도 구절을 찾지 못한 것. */
  unmatched: ReviewItem[];
  /** 결정 안 된 후보 수 (= highlights + unmatched). */
  remaining: number;
}

/** 후보 시각 t(초)에 걸친 턴부터 시각이 가까운 순으로 턴 순번을 나열한다. */
function turnOrderByTime(starts: readonly number[], t: number): number[] {
  let anchor = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= t) anchor = i;
  const idx = starts.map((_, i) => i);
  return idx.sort((a, b) => {
    if (a === anchor) return -1;
    if (b === anchor) return 1;
    const da = Math.abs(starts[a] - t);
    const db = Math.abs(starts[b] - t);
    return da - db || a - b;
  });
}

function candidates(item: ReviewItem): Array<{ needle: string; replacement: string | null }> {
  const out: Array<{ needle: string; replacement: string | null }> = [];
  if (item.hl && item.hl[0]) out.push({ needle: item.hl[0], replacement: item.hl[1] ? item.hl[1] : null });
  if (item.orig && !out.some((c) => c.needle === item.orig)) {
    out.push({ needle: item.orig, replacement: item.sugg ? item.sugg : null });
  }
  return out;
}

/**
 * 후보마다: 시각 t 에 걸친 턴 → 가까운 턴 순으로 hl[0] 를, 못 찾으면 같은 순서로 orig 를 찾는다.
 * 같은 턴에서 이미 쓴 위치와 겹치면 그다음 출현을 쓴다. 결정된 후보는 빠진다.
 */
export function mapReviewHighlights(parsed: ParsedTranscript, review: RecordingReview): ReviewMapping {
  const turns = turnsOf(parsed);
  const starts = turns.map((t) => t.timeSec);
  const taken = new Map<number, Array<[number, number]>>();
  const highlights: ReviewHighlight[] = [];
  const unmatched: ReviewItem[] = [];

  const overlaps = (ti: number, s: number, e: number) =>
    (taken.get(ti) ?? []).some(([a, b]) => s < b && a < e);

  for (const item of review.items) {
    if (review.decisions[String(item.id)]) continue;
    let found: ReviewHighlight | null = null;
    const order = turns.length > 0 ? turnOrderByTime(starts, item.t) : [];
    for (const c of candidates(item)) {
      for (const ti of order) {
        const text = turns[ti].text;
        let from = 0;
        while (from <= text.length) {
          const s = text.indexOf(c.needle, from);
          if (s < 0) break;
          const e = s + c.needle.length;
          if (!overlaps(ti, s, e)) {
            found = {
              id: String(item.id),
              turnIndex: ti,
              start: s,
              end: e,
              kind: item.type,
              item,
              needle: c.needle,
              replacement: c.replacement,
            };
            break;
          }
          from = s + 1;
        }
        if (found) break;
      }
      if (found) break;
    }
    if (found) {
      const arr = taken.get(found.turnIndex) ?? [];
      arr.push([found.start, found.end]);
      taken.set(found.turnIndex, arr);
      highlights.push(found);
    } else {
      unmatched.push(item);
    }
  }
  highlights.sort((a, b) => a.turnIndex - b.turnIndex || a.start - b.start);
  return { highlights, unmatched, remaining: highlights.length + unmatched.length };
}

/** 수락 — 하이라이트 구간만 제안으로 바꾼다. 위치가 어긋났거나 제안이 없으면 null. */
export function acceptHighlight(parsed: ParsedTranscript, h: ReviewHighlight): ParsedTranscript | null {
  if (h.replacement === null) return null;
  const turn = turnsOf(parsed)[h.turnIndex];
  if (!turn || turn.text.slice(h.start, h.end) !== h.needle) return null;
  const next = turn.text.slice(0, h.start) + h.replacement + turn.text.slice(h.end);
  return updateTurnText(parsed, h.turnIndex, next);
}

/** "다음 고칠 곳" — current 다음 하이라이트 (끝이면 처음으로). 없으면 null. */
export function nextHighlightId(highlights: readonly ReviewHighlight[], current: string | null): string | null {
  if (highlights.length === 0) return null;
  const i = current === null ? -1 : highlights.findIndex((h) => h.id === current);
  return highlights[(i + 1) % highlights.length].id;
}

/** 턴 text 가 바뀌었는가 (직접 고침 커밋 감지). */
export function turnTextChanged(before: ParsedTranscript, after: ParsedTranscript, turnIndex: number): boolean {
  const a = turnsOf(before)[turnIndex];
  const b = turnsOf(after)[turnIndex];
  return !!a && !!b && a.text !== b.text;
}
