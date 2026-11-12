// 노트북 퀴즈 (`<notebook>/_digest/quiz.json`) 스키마 검증 + 셔플.
// 읽기 전용 — 진도 · 오답 저장 없음 (docs/designs/notebook-tab.md eng review 결정).
// 순수 함수만 (DOM · React import 금지 — scripts/verify-notebook.ts 가 같이 쓴다).

export const QUIZ_PATH = "_digest/quiz.json";
export const CHOICE_COUNT = 4;

export interface QuizCite {
  src: string;
  quote: string;
}

export interface QuizQuestion {
  id: string;
  q: string;
  choices: string[];
  answer: number;
  explanation: string;
  cites: QuizCite[];
}

export interface Quiz {
  generated_at: string | null;
  questions: QuizQuestion[];
}

export interface SkippedQuestion {
  index: number;
  id: string | null;
  reason: string;
}

export type QuizParse =
  | { ok: true; quiz: Quiz; skipped: SkippedQuestion[] }
  | { ok: false; error: string };

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function checkQuestion(v: unknown): QuizQuestion | string {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "문항이 객체가 아닙니다";
  const o = v as Record<string, unknown>;
  if (!isStr(o.id)) return "id 없음";
  if (!isStr(o.q)) return "q 없음";
  if (!Array.isArray(o.choices) || o.choices.length !== CHOICE_COUNT || !o.choices.every(isStr))
    return `choices 는 문자열 ${CHOICE_COUNT}개여야 합니다`;
  if (typeof o.answer !== "number" || !Number.isInteger(o.answer) || o.answer < 0 || o.answer >= CHOICE_COUNT)
    return `answer 는 0~${CHOICE_COUNT - 1} 정수여야 합니다`;
  if (
    !Array.isArray(o.cites) ||
    o.cites.length === 0 ||
    !o.cites.every((c) => c && typeof c === "object" && isStr((c as QuizCite).src) && isStr((c as QuizCite).quote))
  )
    return "cites 는 {src, quote} 1개 이상이어야 합니다";
  return {
    id: o.id,
    q: o.q,
    choices: o.choices as string[],
    answer: o.answer,
    explanation: typeof o.explanation === "string" ? o.explanation : "",
    cites: (o.cites as QuizCite[]).map((c) => ({ src: c.src, quote: c.quote })),
  };
}

/** quiz.json 원문 → 유효 문항 + 건너뛴 문항. 파일 자체가 깨졌으면 ok:false. */
export function parseQuiz(raw: string): QuizParse {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `JSON 파싱 실패: ${(e as Error).message}` };
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    return { ok: false, error: "최상위가 객체가 아닙니다" };
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.questions)) return { ok: false, error: "questions 배열이 없습니다" };

  const questions: QuizQuestion[] = [];
  const skipped: SkippedQuestion[] = [];
  const seen = new Set<string>();
  o.questions.forEach((v, index) => {
    const rawId =
      v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string"
        ? ((v as { id: string }).id)
        : null;
    const r = checkQuestion(v);
    if (typeof r === "string") {
      skipped.push({ index, id: rawId, reason: r });
    } else if (seen.has(r.id)) {
      skipped.push({ index, id: r.id, reason: "id 중복" });
    } else {
      seen.add(r.id);
      questions.push(r);
    }
  });
  return {
    ok: true,
    quiz: { generated_at: typeof o.generated_at === "string" ? o.generated_at : null, questions },
    skipped,
  };
}

/** 결정적 PRNG (테스트용 seed). 앱은 Math.random 을 넘긴다. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(arr: readonly T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 문항 순서 + 각 문항 보기 순서를 섞는다. answer 는 정답 보기를 따라 옮긴다. 원본 불변. */
export function shuffleQuiz(questions: readonly QuizQuestion[], rand: () => number = Math.random): QuizQuestion[] {
  return shuffled(questions, rand).map((q) => {
    const order = shuffled(
      q.choices.map((_, i) => i),
      rand,
    );
    return {
      ...q,
      choices: order.map((i) => q.choices[i]),
      answer: order.indexOf(q.answer),
    };
  });
}
