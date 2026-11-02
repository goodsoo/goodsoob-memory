import { describe, expect, it } from "vitest";
import type { RecordingReview, ReviewItem } from "../../api/recordings";
import { acceptHighlight, mapReviewHighlights, nextHighlightId, turnTextChanged } from "./review";
import { parseTranscript, serializeTranscript, updateTurnText } from "./turns";

const T = [
  "[00:00] 화자1: 생막보다 잘 썼네요.",
  "",
  "[01:00] 화자0: 스리핀팅에서 그냥 붙이면 됩니다.",
  "",
  "[02:00] 화자1: 만약에 삭출해야 되거나 스리핀팅이면요.",
  "",
].join("\n");

function item(id: number, t: number, over: Partial<ReviewItem> = {}): ReviewItem {
  return { id, t, type: "A", orig: "", sugg: "", ...over };
}

function review(items: ReviewItem[], decisions: RecordingReview["decisions"] = {}): RecordingReview {
  return { items, decisions };
}

describe("mapReviewHighlights", () => {
  const p = parseTranscript(T);

  it("hl[0] 를 시각에 걸친 턴 안에서 찾는다", () => {
    const m = mapReviewHighlights(p, review([item(1, 3, { orig: "생막보다 잘 썼네", sugg: "생각보다 잘 썼네", hl: ["생막보다", "생각보다"] })]));
    expect(m.highlights).toHaveLength(1);
    expect(m.highlights[0]).toMatchObject({ turnIndex: 0, start: 0, end: 4, needle: "생막보다", replacement: "생각보다" });
    expect(m.unmatched).toEqual([]);
    expect(m.remaining).toBe(1);
  });

  it("같은 구절이 여러 턴에 있으면 시각이 가까운 턴", () => {
    const m = mapReviewHighlights(p, review([item(2, 125, { orig: "x", hl: ["스리핀팅", "3D 프린팅"] })]));
    expect(m.highlights[0].turnIndex).toBe(2);
  });

  it("hl 이 없으면 orig 로 찾고, 수락 = sugg", () => {
    const m = mapReviewHighlights(p, review([item(3, 120, { orig: "삭출해야 되거나", sugg: "사출해야 되거나" })]));
    expect(m.highlights[0]).toMatchObject({ turnIndex: 2, needle: "삭출해야 되거나", replacement: "사출해야 되거나" });
  });

  it("hl[0] 를 못 찾으면 orig 로 대체", () => {
    const m = mapReviewHighlights(
      p,
      review([item(4, 60, { orig: "그냥 붙이면", sugg: "그냥 붙이면", hl: ["없는말", "있는말"] })]),
    );
    expect(m.highlights[0]).toMatchObject({ turnIndex: 1, needle: "그냥 붙이면" });
  });

  it("시각이 다른 턴이어도 가까운 턴에서 찾는다", () => {
    const m = mapReviewHighlights(p, review([item(5, 10, { hl: ["만약에", "만일"] })]));
    expect(m.highlights[0].turnIndex).toBe(2);
  });

  it("어디에도 없으면 unmatched", () => {
    const it5 = item(6, 0, { orig: "전혀 없는 문장", sugg: "x" });
    const m = mapReviewHighlights(p, review([it5]));
    expect(m.highlights).toEqual([]);
    expect(m.unmatched).toEqual([it5]);
    expect(m.remaining).toBe(1);
  });

  it("결정된 후보는 빠진다", () => {
    const m = mapReviewHighlights(p, review([item(1, 0, { hl: ["생막보다", "생각보다"] })], { "1": "kept" }));
    expect(m.remaining).toBe(0);
  });

  it("같은 턴 같은 구절 두 후보는 다른 출현에 붙는다", () => {
    const p2 = parseTranscript("[00:00] 화자1: 스리핀팅 그리고 스리핀팅\n\n[00:10] 화자0: 네\n");
    const m = mapReviewHighlights(
      p2,
      review([item(1, 0, { hl: ["스리핀팅", "3D 프린팅"] }), item(2, 0, { hl: ["스리핀팅", "3D 프린팅"] })]),
    );
    expect(m.highlights.map((h) => h.start)).toEqual([0, 9]);
  });

  it("제안이 없으면(B·C) replacement null", () => {
    const m = mapReviewHighlights(p, review([item(7, 0, { type: "B", orig: "잘 썼네요", sugg: "" })]));
    expect(m.highlights[0].replacement).toBeNull();
    expect(acceptHighlight(p, m.highlights[0])).toBeNull();
  });
});

describe("acceptHighlight", () => {
  it("그 구간만 바꾼다", () => {
    const p = parseTranscript(T);
    const m = mapReviewHighlights(p, review([item(2, 125, { hl: ["스리핀팅", "3D 프린팅"] })]));
    const next = acceptHighlight(p, m.highlights[0]);
    expect(next).not.toBeNull();
    const out = serializeTranscript(next!);
    expect(out).toContain("[01:00] 화자0: 스리핀팅에서");
    expect(out).toContain("[02:00] 화자1: 만약에 삭출해야 되거나 3D 프린팅이면요.");
  });

  it("텍스트가 바뀌어 위치가 어긋나면 null", () => {
    const p = parseTranscript(T);
    const m = mapReviewHighlights(p, review([item(1, 0, { hl: ["생막보다", "생각보다"] })]));
    const changed = updateTurnText(p, 0, "다른 말");
    expect(acceptHighlight(changed, m.highlights[0])).toBeNull();
  });
});

describe("nextHighlightId", () => {
  const p = parseTranscript(T);
  const m = mapReviewHighlights(
    p,
    review([item(3, 120, { hl: ["삭출해야", "사출해야"] }), item(1, 0, { hl: ["생막보다", "생각보다"] })]),
  );
  it("턴 순서대로, 끝이면 처음으로", () => {
    expect(m.highlights.map((h) => h.id)).toEqual(["1", "3"]);
    expect(nextHighlightId(m.highlights, null)).toBe("1");
    expect(nextHighlightId(m.highlights, "1")).toBe("3");
    expect(nextHighlightId(m.highlights, "3")).toBe("1");
    expect(nextHighlightId([], null)).toBeNull();
  });
});

describe("turnTextChanged", () => {
  it("그 턴 발화가 바뀌었을 때만 true", () => {
    const p = parseTranscript(T);
    expect(turnTextChanged(p, updateTurnText(p, 1, "고침"), 1)).toBe(true);
    expect(turnTextChanged(p, updateTurnText(p, 1, "고침"), 0)).toBe(false);
  });
});
