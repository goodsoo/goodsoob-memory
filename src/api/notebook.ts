// 노트북 탭 — vault adapter 를 만지는 유일한 곳 (docs/designs/notebook-tab.md Eng Review).
// 읽기 전용: 노트북 탭은 brain 에 아무것도 쓰지 않는다 (쓰면 서버가 brain 전체를 커밋한다).
//
// 노트북 = brain 안 아무 폴더, 허브 README.md frontmatter `type: notebook` 으로 식별.
// 목록은 scanAll("") (brain 전체 내용 read) 대신 listRecursive("") 로 경로만 받아
// `*/README.md` 만 읽는다.

import type { VaultAdapter } from "../lib/vault/adapter";
import { splitFrontmatter } from "../lib/vault/parser";
import { checkCite, type CiteStatus, type ReadFile } from "../lib/notebook/check";
import { parseBriefing, parseTodoList, type Briefing } from "../lib/notebook/digest";
import { parseQuiz, QUIZ_PATH, type QuizParse } from "../lib/notebook/quiz";

export interface NotebookMeta {
  /** 노트북 폴더 (vault 상대) */
  root: string;
  title: string;
}

export interface NotebookDigest {
  root: string;
  title: string;
  briefing: Briefing;
  /** 각주 id → 판정 */
  citeStatus: Map<string, CiteStatus>;
  todos: string[];
  /** null = quiz.json 없음 */
  quiz: QuizParse | null;
  /** `${src}\u0000${quote}` → 판정 (퀴즈 근거 칩용) */
  quizCiteStatus: Map<string, CiteStatus>;
}

export const quizCiteKey = (src: string, quote: string) => `${src}\u0000${quote}`;

const README = "README.md";

// `_`/`.` 세그먼트 = 앱 · 시스템 네임스페이스 (_archive 등). 노트북 후보에서 뺀다.
const isHidden = (path: string) => path.split("/").some((s) => s.startsWith("_") || s.startsWith("."));

function titleOf(root: string, fm: Record<string, unknown>): string {
  return typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : root.split("/").pop() || root;
}

/** 없는 파일 = null. (네트워크 오류도 null — 칩은 "원문 없음" 으로 보인다) */
export async function readOrNull(adapter: VaultAdapter, path: string): Promise<string | null> {
  try {
    return await adapter.read(path);
  } catch {
    return null;
  }
}

export async function listNotebooks(adapter: VaultAdapter): Promise<NotebookMeta[]> {
  const paths = await adapter.listRecursive("");
  const readmes = paths.filter((p) => p.endsWith(`/${README}`) && !isHidden(p));
  const found = await Promise.all(
    readmes.map(async (p) => {
      const raw = await readOrNull(adapter, p);
      if (raw === null) return null;
      const { frontmatter } = splitFrontmatter(raw);
      if (frontmatter.type !== "notebook") return null;
      const root = p.slice(0, -(README.length + 1));
      return { root, title: titleOf(root, frontmatter) };
    }),
  );
  return found
    .filter((n): n is NotebookMeta => n !== null)
    .sort((a, b) => a.title.localeCompare(b.title, "ko"));
}

/** README · 인용 원문 · quiz.json 을 읽어 한 번에 판정한다. 원문은 이 호출 안에서 캐시. */
export async function loadNotebookDigest(adapter: VaultAdapter, root: string): Promise<NotebookDigest> {
  const readmeRaw = await adapter.read(`${root}/${README}`);
  const { frontmatter } = splitFrontmatter(readmeRaw);
  const cache = new Map<string, Promise<string | null>>();
  const read: ReadFile = (p) => {
    let hit = cache.get(p);
    if (!hit) {
      hit = readOrNull(adapter, p);
      cache.set(p, hit);
    }
    return hit;
  };

  const briefing = parseBriefing(readmeRaw);
  const usedIds = new Set(briefing.claims.flatMap((c) => c.refs));
  const citeStatus = new Map<string, CiteStatus>();
  await Promise.all(
    [...briefing.defs.values()]
      .filter((d) => usedIds.has(d.id))
      .map(async (d) => citeStatus.set(d.id, await checkCite(root, d.src, d.quote, read))),
  );

  const quizRaw = await read(`${root}/${QUIZ_PATH}`);
  const quiz = quizRaw === null ? null : parseQuiz(quizRaw);
  const quizCiteStatus = new Map<string, CiteStatus>();
  if (quiz?.ok) {
    const cites = quiz.quiz.questions.flatMap((q) => q.cites);
    await Promise.all(
      cites.map(async (c) =>
        quizCiteStatus.set(quizCiteKey(c.src, c.quote), await checkCite(root, c.src, c.quote, read)),
      ),
    );
  }

  return {
    root,
    title: titleOf(root, frontmatter),
    briefing,
    citeStatus,
    todos: parseTodoList(readmeRaw),
    quiz,
    quizCiteStatus,
  };
}
