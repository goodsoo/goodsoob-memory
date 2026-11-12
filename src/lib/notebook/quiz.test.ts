import { describe, expect, it } from "vitest";
import { mulberry32, parseQuiz, shuffleQuiz, type QuizQuestion } from "./quiz";

const q = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "q-20261112-01",
  q: "질문?",
  choices: ["가", "나", "다", "라"],
  answer: 2,
  explanation: "해설",
  cites: [{ src: "sources/a.md", quote: "발췌" }],
  ...over,
});

const json = (questions: unknown[]) =>
  JSON.stringify({ generated_at: "2026-11-12T10:00:00+09:00", questions });

describe("parseQuiz", () => {
  it("정상", () => {
    const r = parseQuiz(json([q()]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.quiz.questions).toHaveLength(1);
      expect(r.quiz.generated_at).toBe("2026-11-12T10:00:00+09:00");
      expect(r.skipped).toEqual([]);
    }
  });

  it("JSON 깨짐 → ok:false", () => {
    expect(parseQuiz("{ nope").ok).toBe(false);
    expect(parseQuiz("[]").ok).toBe(false);
    expect(parseQuiz(JSON.stringify({ questions: "x" })).ok).toBe(false);
  });

  it("잘못된 문항만 건너뜀", () => {
    const r = parseQuiz(
      json([
        q({ id: "ok" }),
        q({ id: "three", choices: ["a", "b", "c"] }),
        q({ id: "range", answer: 4 }),
        q({ id: "neg", answer: -1 }),
        q({ id: "float", answer: 1.5 }),
        q({ id: "nocite", cites: undefined }),
        q({ id: "emptycite", cites: [] }),
        q({ id: "badcite", cites: [{ src: "a.md" }] }),
        q({ id: "noq", q: "" }),
        "문자열",
      ]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.quiz.questions.map((x) => x.id)).toEqual(["ok"]);
      expect(r.skipped).toHaveLength(9);
      expect(r.skipped[0]).toMatchObject({ index: 1, id: "three" });
    }
  });

  it("id 중복 → 뒤 문항 건너뜀", () => {
    const r = parseQuiz(json([q(), q()]));
    expect(r.ok && r.quiz.questions.length).toBe(1);
    expect(r.ok && r.skipped[0].reason).toContain("중복");
  });
});

describe("shuffleQuiz", () => {
  const base: QuizQuestion[] = Array.from({ length: 8 }, (_, i) => ({
    id: `q-${i}`,
    q: `질문 ${i}`,
    choices: [`${i}-a`, `${i}-b`, `${i}-c`, `${i}-d`],
    answer: i % 4,
    explanation: "",
    cites: [{ src: "s.md", quote: "x" }],
  }));

  it("정답 텍스트 보존 (answer 재매핑)", () => {
    for (let seed = 1; seed < 30; seed++) {
      const out = shuffleQuiz(base, mulberry32(seed));
      for (const s of out) {
        const orig = base.find((b) => b.id === s.id)!;
        expect(s.choices[s.answer]).toBe(orig.choices[orig.answer]);
        expect([...s.choices].sort()).toEqual([...orig.choices].sort());
      }
    }
  });

  it("문항 수 보존 + 원본 불변", () => {
    const snapshot = JSON.stringify(base);
    const out = shuffleQuiz(base, mulberry32(7));
    expect(out.map((x) => x.id).sort()).toEqual(base.map((x) => x.id).sort());
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it("seed 고정 시 결정적, seed 다르면 순서가 달라짐", () => {
    const a = shuffleQuiz(base, mulberry32(42)).map((x) => x.id);
    const b = shuffleQuiz(base, mulberry32(42)).map((x) => x.id);
    const c = shuffleQuiz(base, mulberry32(43)).map((x) => x.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
