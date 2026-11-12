// 노트북 탭 — 자료에 묶인 소화물(브리핑 · 객관식 퀴즈) 뷰어 (docs/designs/notebook-tab.md).
// 사이드바 = 노트북 목록, 메인 = 브리핑 / 퀴즈 / 조사 필요 + 원문 열람(발췌 하이라이트).
//
// ⚠️ 브리핑을 react-markdown 으로 렌더하지 않는다: GFM 각주 ref 는 `#user-content-fn-n` 앵커라
// 클릭 시 hash 가 바뀌고 App.readTabFromHash 가 모르는 hash 를 "오늘" 탭으로 보낸다.
// lib/notebook/digest 로 주장 단위로 쪼갠 뒤 `[^n]` 을 지운 본문 + 별도 인용 버튼으로 그린다.

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Alert, Button, NavItem, Tabs, useToast } from "@goodsoob/ds";
import type { Claim, ClaimKind } from "../../lib/notebook/digest";
import type { CiteStatus } from "../../lib/notebook/check";
import { quizCiteKey, type NotebookDigest } from "../../api/notebook";
import { useNotebookDigest, useNotebookFile, useNotebooks } from "../../hooks/useNotebooks";
import { copyText } from "../../lib/clipboard";
import { EmptyState } from "../common/EmptyState";
import { Modal } from "../common/Modal";
import { PageHeaderBar } from "../common/PageHeaderBar";
import { Text } from "../common/Text";
import type { OpenCite } from "./CiteButton";
import { QuizPanel } from "./QuizPanel";

// ── 사이드바 ────────────────────────────────────────────────────────────────

type SidePanelProps = {
  selected: string | null;
  onSelect: (root: string) => void;
};

export function NotebookSidePanel({ selected, onSelect }: SidePanelProps) {
  const { data, isLoading, isError } = useNotebooks();
  return (
    <div className="flex h-full flex-col">
      <div
        className="flex shrink-0 items-center px-4"
        style={{ height: "var(--page-header-h)", borderBottom: "1px solid var(--line)" }}
      >
        <h2 className="font-serif text-sm font-medium" style={{ color: "var(--ink)" }}>
          노트북
        </h2>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-1 py-1" aria-label="노트북">
        {isLoading ? null : isError ? (
          <Text variant="caption" color="danger" as="div" className="px-3 py-2">
            노트북 목록을 불러오지 못했습니다. 앱 서버가 켜져 있는지 확인하세요.
          </Text>
        ) : !data?.length ? (
          <Text variant="caption" color="muted" as="div" className="px-3 py-2">
            노트북이 없습니다. 폴더의 README.md frontmatter 에 type: notebook 을 적으면 여기에 나타납니다.
          </Text>
        ) : (
          data.map((nb) => (
            <NavItem
              key={nb.root}
              active={nb.root === selected}
              onClick={() => onSelect(nb.root)}
              aria-current={nb.root === selected ? "true" : undefined}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate" style={{ color: "var(--ink)" }}>
                  {nb.title}
                </span>
                <span className="truncate text-2xs" style={{ color: "var(--faint)" }}>
                  {nb.root}
                </span>
              </span>
            </NavItem>
          ))
        )}
      </nav>
    </div>
  );
}

// ── 메인 ────────────────────────────────────────────────────────────────────

type PageProps = {
  root: string | null;
  onSelect: (root: string) => void;
};

export function NotebookPage({ root, onSelect }: PageProps) {
  const list = useNotebooks();
  // 고른 게 없으면 첫 노트북을 연다 (목록 1개뿐인 지금 기본 동작).
  useEffect(() => {
    if (!root && list.data?.length) onSelect(list.data[0].root);
  }, [root, list.data, onSelect]);
  const exists = !root || !list.data || list.data.some((n) => n.root === root);
  const digest = useNotebookDigest(exists ? root : null);
  const title = digest.data?.title ?? list.data?.find((n) => n.root === root)?.title ?? "노트북";

  return (
    <div className="relative flex min-h-svh flex-col lg:h-full lg:min-h-0">
      <PageHeaderBar
        center={
          <Text variant="h4" as="h2" truncate>
            {title}
          </Text>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isLoading || digest.isLoading ? null : !list.data?.length ? (
          <EmptyState
            className="px-6 py-16"
            icon={<BookOpen className="h-6 w-6" aria-hidden />}
            title="노트북이 없습니다"
            description="brain 폴더의 README.md frontmatter 에 type: notebook 을 적으면 노트북이 됩니다. 소화물은 채팅에서 /study 로 만듭니다."
          />
        ) : !exists ? (
          <EmptyState
            className="px-6 py-16"
            title="노트북을 찾을 수 없습니다"
            description="폴더가 옮겨졌거나 README.md 의 type 이 바뀌었을 수 있습니다. 목록에서 다른 노트북을 선택하세요."
          />
        ) : digest.isError ? (
          <div className="mx-auto w-full max-w-3xl px-5 py-6">
            <Alert variant="down" title="노트북을 읽지 못했습니다">
              README.md 를 읽는 중 오류가 났습니다. 앱 서버가 켜져 있는지 확인하고 다시 여세요.
            </Alert>
          </div>
        ) : digest.data ? (
          <NotebookDetail key={digest.data.root} digest={digest.data} />
        ) : null}
      </div>
    </div>
  );
}

type View = "briefing" | "quiz" | "todo";


function NotebookDetail({ digest }: { digest: NotebookDigest }) {
  const [view, setView] = useState<View>("briefing");
  const [cite, setCite] = useState<OpenCite | null>(null);
  const quizCount = digest.quiz?.ok ? digest.quiz.quiz.questions.length : 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-6">
      <Tabs
        items={[
          { key: "briefing", label: "브리핑", badge: digest.briefing.claims.length },
          { key: "quiz", label: "퀴즈", badge: quizCount },
          { key: "todo", label: "조사 필요", badge: digest.todos.length },
        ]}
        active={view}
        onChange={(k) => setView(k as View)}
      />
      {view === "briefing" ? (
        <BriefingView digest={digest} onOpenCite={setCite} />
      ) : view === "quiz" ? (
        <QuizPanel
          quiz={digest.quiz}
          citeStatusOf={(src, quote) => digest.quizCiteStatus.get(quizCiteKey(src, quote))}
          onOpenCite={setCite}
        />
      ) : (
        <TodoView digest={digest} />
      )}
      <SourceViewer cite={cite} onClose={() => setCite(null)} />
    </div>
  );
}

// ── 브리핑 ──────────────────────────────────────────────────────────────────

// 브리핑은 문서처럼 읽혀야 한다. 출처는 의심이 들 때만 보는 보조 정보라 문장 끝 작은 위첨자 번호로만 두고,
// 대조에 실패한 것만 빨간 글자로 드러낸다. 종류 라벨도 자료(기본)는 생략, 판단 · 해석 · 근거 없음만 앞에 작게.
const KIND_PREFIX: Partial<Record<ClaimKind, string>> = {
  judgment: "내 판단",
  ai: "AI 해석",
  unsupported: "근거 없음",
};
const KIND_COLOR: Record<ClaimKind, string> = {
  source: "var(--ink)",
  judgment: "var(--sub)",
  ai: "var(--sub)",
  unsupported: "var(--faint)",
};

function BriefingView({ digest, onOpenCite }: { digest: NotebookDigest; onOpenCite: (c: OpenCite) => void }) {
  const { briefing, citeStatus } = digest;
  const stats = useMemo(() => {
    const refs = briefing.claims.flatMap((c) => c.refs);
    const broken = refs.filter((r) => citeStatus.get(r)?.status !== "ok").length;
    return { total: refs.length, broken };
  }, [briefing, citeStatus]);

  if (!briefing.found) {
    return (
      <EmptyState
        className="px-6 py-12"
        title="브리핑이 없습니다"
        description="README.md 에 ## 지금까지의 결론 섹션이 없습니다. 채팅에서 /study 로 이 노트북의 소화를 요청하세요."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Text variant="caption" color="muted" as="p">
        주장 {briefing.claims.length}개 · 인용 {stats.total}개
        {stats.broken > 0 ? (
          <span style={{ color: "var(--down-ink)" }}> · 원문 대조 실패 {stats.broken}개</span>
        ) : stats.total > 0 ? (
          " · 모두 원문과 일치"
        ) : null}
      </Text>
      <ul className="flex flex-col gap-2">
        {briefing.claims.map((c) => (
          <ClaimRow key={c.line} claim={c} digest={digest} onOpenCite={onOpenCite} />
        ))}
      </ul>
      <Text variant="caption" color="muted" as="p" className="pt-2" style={{ borderTop: "1px solid var(--line)" }}>
        인용 번호는 발췌가 노트북 자료 파일에 글자 그대로 있는지만 대조합니다. 자료 파일이 웹 원문과 같은지, 발췌가
        주장을 실제로 뒷받침하는지는 확인하지 않습니다.
      </Text>
    </div>
  );
}

function ClaimRow({
  claim,
  digest,
  onOpenCite,
}: {
  claim: Claim;
  digest: NotebookDigest;
  onOpenCite: (c: OpenCite) => void;
}) {
  const prefix = KIND_PREFIX[claim.kind];
  return (
    <li
      className="flex gap-2 text-sm leading-relaxed"
      style={{
        color: KIND_COLOR[claim.kind],
        paddingLeft: claim.depth ? `calc(var(--space-20) * ${claim.depth})` : undefined,
      }}
    >
      <span aria-hidden className="shrink-0 select-none" style={{ color: "var(--faint)", visibility: claim.bullet ? undefined : "hidden" }}>
        •
      </span>
      <p className="min-w-0">
        {prefix ? (
          <span className="mr-1.5 text-2xs whitespace-nowrap" style={{ color: "var(--faint)" }}>
            {prefix}
          </span>
        ) : null}
        <InlineMarkdown text={claim.text} />
        {claim.refs.map((id, i) => (
          <CiteMark
            key={`${id}-${i}`}
            id={id}
            def={digest.briefing.defs.get(id)}
            status={digest.citeStatus.get(id)}
            onOpen={onOpenCite}
          />
        ))}
      </p>
    </li>
  );
}

/** 문장 끝 인용 위첨자. 앵커가 아니라 버튼 — 누르면 원문 열람, 올리면 경로 · 발췌. */
function CiteMark({
  id,
  def,
  status,
  onOpen,
}: {
  id: string;
  def: { src: string; quote: string } | undefined;
  status: CiteStatus | undefined;
  onOpen: (c: OpenCite) => void;
}) {
  const broken = !def ? "각주 없음" : status?.status === "mismatch" ? "원문에서 못 찾음" : status?.status !== "ok" ? "원문 없음" : null;
  return (
    <sup className="ml-0.5">
      <button
        type="button"
        disabled={!def}
        onClick={def ? () => onOpen({ src: def.src, quote: def.quote, status }) : undefined}
        title={def ? `${def.src} · “${def.quote}”${broken ? ` · ${broken}` : ""}` : `각주 [^${id}] 정의가 없습니다`}
        aria-label={broken ? `인용 ${id}, ${broken}` : `인용 ${id}, 원문 보기`}
        className={`rounded-sm px-0.5 text-2xs tabular-nums hover:underline ${broken ? "font-semibold" : ""}`}
        style={{ color: broken ? "var(--down-ink)" : "var(--faint)" }}
      >
        {broken ? `${id} ${broken}` : id}
      </button>
    </sup>
  );
}

// 주장 본문은 인라인 서식(굵게 · 기울임 · 코드 · 링크)만 렌더한다. 각주 `[^n]` 은 digest 가 이미 지웠고,
// 블록 요소는 풀어서 글자만 남긴다. 링크는 새 창 — hash 를 바꾸지 않게.
const INLINE_ELEMENTS = ["p", "strong", "em", "code", "a", "del"];
function InlineMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      allowedElements={INLINE_ELEMENTS}
      unwrapDisallowed
      components={{
        p: ({ children }) => <>{children}</>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="rounded px-1 text-xs" style={{ background: "var(--surface-2)" }}>
            {children}
          </code>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

// ── 원문 열람 ───────────────────────────────────────────────────────────────

function SourceViewer({ cite, onClose }: { cite: OpenCite | null; onClose: () => void }) {
  const status = cite?.status;
  const path = status && status.status !== "missing" ? status.path : status?.path ?? null;
  const file = useNotebookFile(cite && path ? path : null);
  const markRef = useRef<HTMLElement>(null);
  const text = file.data ?? null;

  useEffect(() => {
    if (text !== null) markRef.current?.scrollIntoView({ block: "center" });
  }, [text, cite]);

  const problem =
    !status || status.status === "missing"
      ? status?.status === "missing" && status.reason === "outside"
        ? "노트북 폴더 밖을 가리키는 경로라 열지 않습니다."
        : "원문 파일이 없습니다. 옮겨졌거나 삭제됐을 수 있습니다."
      : status.status === "mismatch"
        ? "이 발췌를 원문에서 찾지 못했습니다. 소화 단계에서 바뀌었거나 지어낸 인용일 수 있습니다."
        : null;

  return (
    <Modal open={!!cite} onClose={onClose} size="lg" orientation="vertical" ariaLabel="원문">
      {cite ? (
        <>
          <div className="flex shrink-0 items-start justify-between gap-3 p-4" style={{ borderBottom: "1px solid var(--line)" }}>
            <div className="flex min-w-0 flex-col gap-1">
              <Text variant="h4" as="h2" truncate>
                {cite.src}
              </Text>
              <Text variant="caption" color="muted" as="p">
                발췌 “{cite.quote}”
              </Text>
            </div>
            <Button size="sm" variant="ghost" onClick={onClose}>
              닫기
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {problem ? (
              <div className="pb-4">
                <Alert variant="down">{problem}</Alert>
              </div>
            ) : null}
            {text !== null ? (
              <pre className="text-sm leading-relaxed whitespace-pre-wrap break-words" style={{ color: "var(--ink)", fontFamily: "inherit" }}>
                {status?.status === "ok" ? (
                  <>
                    {text.slice(0, status.rawStart)}
                    <mark ref={markRef} style={{ background: "var(--accent-soft)", color: "var(--ink)" }}>
                      {text.slice(status.rawStart, status.rawEnd)}
                    </mark>
                    {text.slice(status.rawEnd)}
                  </>
                ) : (
                  text
                )}
              </pre>
            ) : null}
          </div>
        </>
      ) : null}
    </Modal>
  );
}

// ── 조사 필요 ───────────────────────────────────────────────────────────────

function TodoView({ digest }: { digest: NotebookDigest }) {
  const toast = useToast();
  if (digest.todos.length === 0) {
    return (
      <EmptyState
        className="px-6 py-12"
        title="조사할 항목이 없습니다"
        description="README.md 의 ## 조사 필요 섹션에 불릿으로 적으면 여기에 나타납니다."
      />
    );
  }
  async function copy() {
    const text = `다음 항목을 조사해 sources/ 에 정리해 주세요. 노트북: ${digest.root}\n\n${digest.todos
      .map((t) => `- ${t}`)
      .join("\n")}`;
    const ok = await copyText(text);
    toast.show(ok ? "조사 요청을 복사했습니다." : "복사에 실패했습니다. 브라우저 권한을 확인하세요.", {
      variant: ok ? undefined : "down",
    });
  }
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2 pl-5" style={{ listStyle: "disc", color: "var(--ink)" }}>
        {digest.todos.map((t, i) => (
          <li key={i} className="text-sm leading-relaxed">
            {t}
          </li>
        ))}
      </ul>
      <div>
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          조사 요청 복사
        </Button>
      </div>
    </div>
  );
}
