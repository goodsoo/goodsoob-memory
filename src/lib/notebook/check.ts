// 인용 1건 판정 + 노트북 전체 검사. 탭(칩 색)과 CLI(exit 코드)가 같은 판정을 쓰게 하는 접점.
// 파일 읽기는 주입받는다 (탭 = vault adapter, CLI = node:fs). DOM · React import 금지.

import { parseBriefing, resolveSrc, verifyQuote } from "./digest";
import { parseQuiz, QUIZ_PATH } from "./quiz";

/** vault 상대 경로 → 내용. 없으면 null. */
export type ReadFile = (vaultRelPath: string) => Promise<string | null>;

export type CiteStatus =
  | { status: "ok"; path: string; rawStart: number; rawEnd: number }
  | { status: "mismatch"; path: string }
  | { status: "missing"; path: string | null; reason: "outside" | "not-found" };

export async function checkCite(
  notebookRoot: string,
  src: string,
  quote: string,
  read: ReadFile,
): Promise<CiteStatus> {
  const path = resolveSrc(notebookRoot, src);
  if (!path) return { status: "missing", path: null, reason: "outside" };
  const text = await read(path);
  if (text === null) return { status: "missing", path, reason: "not-found" };
  const m = verifyQuote(text, quote);
  return m.ok ? { status: "ok", path, rawStart: m.rawStart, rawEnd: m.rawEnd } : { status: "mismatch", path };
}

export interface CheckFailure {
  where: string;
  message: string;
}

export interface NotebookReport {
  failures: CheckFailure[];
  warnings: CheckFailure[];
  claimCount: number;
  questionCount: number;
}

/** 브리핑 주장 · 각주 · quiz.json(있으면)을 전부 검사. failures 가 0 이어야 소화물 합격. */
export async function checkNotebook(
  notebookRoot: string,
  readme: string,
  read: ReadFile,
): Promise<NotebookReport> {
  const failures: CheckFailure[] = [];
  const warnings: CheckFailure[] = [];
  const b = parseBriefing(readme);
  if (!b.found) failures.push({ where: "README.md", message: "## 지금까지의 결론 섹션이 없습니다." });

  for (const issue of b.issues) {
    const item = { where: `README.md:${issue.line}`, message: issue.message };
    (issue.kind === "unused-def" ? warnings : failures).push(item);
  }

  const citeMessage = (s: CiteStatus, src: string, quote: string): string | null => {
    if (s.status === "ok") return null;
    if (s.status === "mismatch") return `발췌를 원문에서 못 찾음: ${src} "${quote.slice(0, 50)}"`;
    return s.reason === "outside" ? `노트북 밖 경로: ${src}` : `원문 없음: ${src}`;
  };

  const usedIds = new Set(b.claims.flatMap((c) => c.refs));
  for (const def of b.defs.values()) {
    if (!usedIds.has(def.id)) continue;
    const s = await checkCite(notebookRoot, def.src, def.quote, read);
    const msg = citeMessage(s, def.src, def.quote);
    if (msg) failures.push({ where: `README.md:${def.line} [^${def.id}]`, message: msg });
  }

  let questionCount = 0;
  const quizRaw = await read(notebookRoot ? `${notebookRoot}/${QUIZ_PATH}` : QUIZ_PATH);
  if (quizRaw === null) {
    warnings.push({ where: QUIZ_PATH, message: "퀴즈 파일 없음" });
  } else {
    const p = parseQuiz(quizRaw);
    if (!p.ok) {
      failures.push({ where: QUIZ_PATH, message: p.error });
    } else {
      questionCount = p.quiz.questions.length;
      for (const s of p.skipped)
        failures.push({ where: `${QUIZ_PATH} #${s.index}${s.id ? ` (${s.id})` : ""}`, message: s.reason });
      for (const q of p.quiz.questions) {
        for (const c of q.cites) {
          const s = await checkCite(notebookRoot, c.src, c.quote, read);
          const msg = citeMessage(s, c.src, c.quote);
          if (msg) failures.push({ where: `${QUIZ_PATH} ${q.id}`, message: msg });
        }
      }
    }
  }

  return { failures, warnings, claimCount: b.claims.length, questionCount };
}
