// 노트북 브리핑 파서 + 인용 대조 (docs/designs/notebook-tab.md "파일 계약" · Eng Review).
//
// 순수 함수만 둔다 — 텍스트 in / 결과 out. 앱(NotebookTab)과 검증 CLI(scripts/verify-notebook.ts)
// 가 같은 판정을 쓰도록 DOM · React · adapter import 금지 (tsconfig.server.json 에도 걸린다).
//
// 브리핑 = README 의 `## 지금까지의 결론` 섹션(다음 H2 직전까지). 인용 = GFM 각주:
//   본문  `문장[^n]`
//   정의  `[^n]: <노트북 루트 기준 경로> "<원문 발췌>"`  (한 줄, 발췌 = 첫 `"` ~ 줄 마지막 `"`)

export const BRIEFING_HEADING = "지금까지의 결론";
export const TODO_HEADING = "조사 필요";

export const MARKERS = {
  judgment: "(내 판단)",
  ai: "(AI 해석)",
} as const;

/** source = 각주 1개 이상 / judgment·ai = 마커 (마커가 각주보다 우선) / unsupported = 둘 다 없음 */
export type ClaimKind = "source" | "judgment" | "ai" | "unsupported";

export type ClaimSegment = { text: string } | { ref: string };

export interface Claim {
  /** `[^n]` 과 마커를 지운 표시용 본문 (여러 줄은 공백 1칸으로 이음) */
  text: string;
  /** 마커를 지운 본문을 글 · 인용 조각으로 — 인용 번호를 원래 문장 뒤에 렌더할 때 쓴다 */
  segments: ClaimSegment[];
  refs: string[];
  kind: ClaimKind;
  /** 불릿 중첩 깊이. 문단 = 0 */
  depth: number;
  bullet: boolean;
  /** 원문 1-based 줄 번호 (CLI 메시지용) */
  line: number;
}

export interface FootnoteDef {
  id: string;
  src: string;
  quote: string;
  line: number;
}

export type IssueKind = "unsupported" | "missing-def" | "bad-def" | "unused-def";

export interface BriefingIssue {
  kind: IssueKind;
  line: number;
  message: string;
}

export interface BriefingHeading {
  /** 3 = `###`, 4 = `####` … (섹션 안 소제목. H2 는 섹션 경계라 여기 안 옴) */
  level: number;
  text: string;
  line: number;
}

/** 브리핑을 문서 순서대로 — 소제목과 주장 단위(문단 · 불릿)가 섞인다. */
export type BriefingBlock = { type: "heading"; heading: BriefingHeading } | { type: "claim"; claim: Claim };

export interface Briefing {
  found: boolean;
  claims: Claim[];
  blocks: BriefingBlock[];
  defs: Map<string, FootnoteDef>;
  issues: BriefingIssue[];
}

interface SectionLine {
  text: string;
  /** 1-based */
  line: number;
}

const H2_RE = /^##\s+(.+?)\s*#*\s*$/;
const HEADING_RE = /^#{1,6}\s/;
const DEF_RE = /^\[\^([^\]\s]+)\]:\s*(.*)$/;
const REF_RE = /\[\^([^\]\s]+)\]/g;
const BULLET_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

/** `## {heading}` 부터 다음 H2 직전까지의 줄 (제목 줄 제외). 없으면 null. */
export function extractSection(
  md: string,
  heading: string,
): { lines: SectionLine[] } | null {
  const all = md.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < all.length; i++) {
    const m = all[i].match(H2_RE);
    if (m && m[1].trim() === heading) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return null;
  const lines: SectionLine[] = [];
  for (let i = start; i < all.length; i++) {
    if (H2_RE.test(all[i])) break;
    lines.push({ text: all[i], line: i + 1 });
  }
  return { lines };
}

/** 문서 전체에서 각주 정의를 모은다. 문법이 틀린 정의는 issue 로만 남기고 defs 엔 안 넣는다. */
export function parseFootnoteDefs(md: string): {
  defs: Map<string, FootnoteDef>;
  issues: BriefingIssue[];
} {
  const defs = new Map<string, FootnoteDef>();
  const issues: BriefingIssue[] = [];
  md.split(/\r?\n/).forEach((raw, i) => {
    const m = raw.match(DEF_RE);
    if (!m) return;
    const line = i + 1;
    const [, id, rest] = m;
    const first = rest.indexOf('"');
    const last = rest.lastIndexOf('"');
    const src = first >= 0 ? rest.slice(0, first).trim() : "";
    if (first < 0 || last <= first || !src) {
      issues.push({
        kind: "bad-def",
        line,
        message: `각주 [^${id}] 문법 오류: [^${id}]: <경로> "<발췌>" 한 줄이어야 합니다.`,
      });
      return;
    }
    defs.set(id, { id, src, quote: rest.slice(first + 1, last), line });
  });
  return { defs, issues };
}

function classify(rawText: string): Pick<Claim, "text" | "refs" | "kind" | "segments"> {
  const refs = [...rawText.matchAll(REF_RE)].map((m) => m[1]);
  let body = rawText.replace(/\s+/g, " ").trim();
  let kind: ClaimKind = refs.length > 0 ? "source" : "unsupported";
  for (const [k, marker] of Object.entries(MARKERS) as Array<[keyof typeof MARKERS, string]>) {
    if (body.startsWith(marker)) {
      kind = k;
      body = body.slice(marker.length).trim();
      break;
    }
  }
  // 인용 번호를 원래 문장 위치에 두기 위해 본문을 글 · 인용 조각으로 나눈다.
  const segments: ClaimSegment[] = [];
  let last = 0;
  for (const m of body.matchAll(REF_RE)) {
    const t = body.slice(last, m.index).replace(/\s+$/, "");
    if (t) segments.push({ text: t });
    segments.push({ ref: m[1] });
    last = m.index! + m[0].length;
  }
  const tail = body.slice(last);
  if (tail.trim()) segments.push({ text: tail });
  const text = body.replace(REF_RE, "").replace(/\s+/g, " ").trim();
  return { text, refs, kind, segments };
}

export function parseBriefing(md: string): Briefing {
  const { defs, issues } = parseFootnoteDefs(md);
  const section = extractSection(md, BRIEFING_HEADING);
  if (!section) return { found: false, claims: [], blocks: [], defs, issues };

  interface Draft {
    parts: string[];
    depth: number;
    bullet: boolean;
    line: number;
    indent: number;
  }
  const drafts: Draft[] = [];
  const headings: BriefingHeading[] = [];
  let cur: Draft | null = null;
  // 열린 불릿들의 들여쓰기 스택 — 깊이 = 자기보다 얕은 열린 불릿 수.
  let indentStack: number[] = [];

  for (const { text, line } of section.lines) {
    if (!text.trim()) {
      // 빈 줄은 문단을 닫는다. 불릿은 다음 불릿/들여쓴 줄이 이어갈 수 있게 열어둠.
      if (cur && !cur.bullet) cur = null;
      continue;
    }
    if (HEADING_RE.test(text) || DEF_RE.test(text)) {
      const h = text.match(/^(#{3,6})\s+(.+?)\s*#*\s*$/);
      if (h) headings.push({ level: h[1].length, text: h[2], line });
      cur = null;
      indentStack = [];
      continue;
    }
    const b = text.match(BULLET_RE);
    if (b) {
      const indent = b[1].replace(/\t/g, "    ").length;
      while (indentStack.length && indentStack[indentStack.length - 1] >= indent) indentStack.pop();
      cur = { parts: [b[2]], depth: indentStack.length, bullet: true, line, indent };
      indentStack.push(indent);
      drafts.push(cur);
      continue;
    }
    const indent = (text.match(/^\s*/)?.[0] ?? "").replace(/\t/g, "    ").length;
    if (cur && (!cur.bullet || indent > cur.indent)) {
      cur.parts.push(text.trim());
      continue;
    }
    // 들여쓰기 없는 비-불릿 줄 = 새 문단
    indentStack = [];
    cur = { parts: [text.replace(/^>\s?/, "")], depth: 0, bullet: false, line, indent: 0 };
    drafts.push(cur);
  }

  const used = new Set<string>();
  const claims: Claim[] = drafts.map((d) => {
    const { text, refs, kind, segments } = classify(d.parts.join(" "));
    for (const r of refs) {
      used.add(r);
      if (!defs.has(r) && !issues.some((i) => i.kind === "bad-def" && i.message.includes(`[^${r}]`))) {
        issues.push({ kind: "missing-def", line: d.line, message: `각주 [^${r}] 정의가 없습니다.` });
      }
    }
    if (kind === "unsupported") {
      issues.push({
        kind: "unsupported",
        line: d.line,
        message: `근거 없음: 각주나 ${MARKERS.judgment}/${MARKERS.ai} 마커가 필요합니다. "${text.slice(0, 40)}"`,
      });
    }
    return { text, refs, kind, segments, depth: d.depth, bullet: d.bullet, line: d.line };
  });

  for (const def of defs.values()) {
    if (!used.has(def.id)) {
      issues.push({ kind: "unused-def", line: def.line, message: `각주 [^${def.id}] 가 본문에서 안 쓰입니다.` });
    }
  }
  issues.sort((a, b) => a.line - b.line);
  const blocks: BriefingBlock[] = [
    ...headings.map((heading) => ({ type: "heading" as const, heading })),
    ...claims.map((claim) => ({ type: "claim" as const, claim })),
  ].sort((a, b) => (a.type === "heading" ? a.heading.line : a.claim.line) - (b.type === "heading" ? b.heading.line : b.claim.line));
  return { found: true, claims, blocks, defs, issues };
}

export type QuoteMatch = { ok: true; rawStart: number; rawEnd: number } | { ok: false };

/**
 * 발췌가 원문에 글자 그대로 있는지. 공백 · 줄바꿈 연속만 1칸으로 접어 비교하고
 * (마크다운 기호는 건드리지 않음 — 오탐보다 미탐이 안전), 원문 오프셋 [rawStart, rawEnd) 을 돌려준다.
 */
export function verifyQuote(srcText: string, quote: string): QuoteMatch {
  const q = quote.replace(/\s+/g, " ").trim();
  if (!q) return { ok: false };
  let norm = "";
  const map: number[] = []; // norm index → raw index
  let prevSpace = false;
  for (let i = 0; i < srcText.length; i++) {
    const ch = srcText[i];
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      prevSpace = true;
      norm += " ";
    } else {
      prevSpace = false;
      norm += ch;
    }
    map.push(i);
  }
  const at = norm.indexOf(q);
  if (at < 0) return { ok: false };
  // q 는 trim 돼 있어 끝 글자가 공백이 아니다 → 원문 1:1 대응.
  return { ok: true, rawStart: map[at], rawEnd: map[at + q.length - 1] + 1 };
}

/** 노트북 루트 기준 src → vault 상대 경로. 노트북 밖(`..` · 절대경로 · 드라이브)이면 null. */
export function resolveSrc(notebookRoot: string, src: string): string | null {
  const s = src.trim();
  if (!s || s.startsWith("/") || s.includes("\\") || /^[A-Za-z]:/.test(s)) return null;
  const segs: string[] = [];
  for (const seg of s.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return null;
    segs.push(seg);
  }
  if (!segs.length) return null;
  const rel = segs.join("/");
  return notebookRoot ? `${notebookRoot}/${rel}` : rel;
}

/** `## 조사 필요` 섹션의 불릿 텍스트 (중첩 포함, 순서대로). */
export function parseTodoList(md: string): string[] {
  const section = extractSection(md, TODO_HEADING);
  if (!section) return [];
  const out: string[] = [];
  for (const { text } of section.lines) {
    const b = text.match(BULLET_RE);
    if (b && b[2].trim()) out.push(b[2].trim());
  }
  return out;
}
