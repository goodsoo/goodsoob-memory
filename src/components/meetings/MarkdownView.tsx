import { cloneElement, createContext, isValidElement, useContext, useMemo, type ReactNode } from "react";
import { Plus } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { toggleTaskCheckboxAt } from "../../lib/markdownTask";
import { expandObsidianEmbeds, makeEmbedResolver } from "../../lib/markdown/obsidianEmbed";
import { VaultImageIndexContext } from "../../lib/markdown/VaultImageIndexProvider";
import { vaultAssetSrc } from "../../lib/portfolio/assetUrl";
import { VaultContext } from "../../lib/vault/VaultProvider";

// vault 안 이미지 경로 해석. http(s)/data/asset/blob 은 그대로, "/" 절대 경로는
// convertFileSrc, 그 외 상대 경로는 vaultRoot 기준. vaultRoot null 이면 src 그대로
// (테스트 환경 / provider 밖 호출 fallback).
function resolveImageSrc(
  src: string | undefined,
  vaultRoot: string | null,
): string | undefined {
  if (!src) return undefined;
  if (/^(https?:|data:|asset:|blob:|file:)/i.test(src)) return src;
  if (!vaultRoot) return src;
  // 절대 경로: vault root prefix 검사 (밖 path 면 그대로). 단순화 — vaultAssetSrc 가
  // root 안 상대 경로 받도록 설계됐으니 절대 경로면 root 분리 시도.
  if (src.startsWith("/")) {
    const r = vaultRoot.endsWith("/") ? vaultRoot.slice(0, -1) : vaultRoot;
    if (src.startsWith(r + "/")) return vaultAssetSrc(vaultRoot, src.slice(r.length + 1));
    return src; // vault 밖 절대 경로 — 손대지 않음
  }
  return vaultAssetSrc(vaultRoot, src);
}

type Props = {
  content: string;
  // body source 직접 mutation — 체크박스 클릭 토글용. 없으면 read-only.
  onChange?: (next: string) => void;
  // task 라인 우측 hover 시 노출되는 "할 일 추가" 버튼 콜백. 라인 raw 텍스트
  // (`- [ ] foo --- 내일 #work` 형식) 그대로 넘김 — 편집 모드 ⌘Enter 와 동일
  // 시그니처라 부모는 같은 핸들러 (lineToTaskPrefill → TaskAddModal) 로 연결한다.
  onAddTaskFromLine?: (lineText: string) => void;
};

// pre 안쪽 code 인지 추적 — 4-space indented block 은 language class 가 없어
// className 만 보면 inline 으로 오해됨. ancestry context 가 가장 안전.
const InsidePreContext = createContext(false);

// task-list-item li 의 children 에서 remark-gfm default checkbox 제거.
// rehype 가 만든 hast 의 <p> wrapper 는 react-markdown 이 우리 components.p (함수)
// 로 렌더하므로 type 비교가 안 됨 → 트리 깊이 탐색으로 첫 input[type=checkbox] 찾아
// null 로 치환 + 직후 공백 1칸 strip.
function extractTaskInline(children: ReactNode): ReactNode {
  const ctx = { phase: "before" as "before" | "stripped" | "done" };
  return visitForCheckbox(children, ctx);
}

function visitForCheckbox(
  node: ReactNode,
  ctx: { phase: "before" | "stripped" | "done" },
): ReactNode {
  if (ctx.phase === "done") return node;

  if (Array.isArray(node)) {
    return node.map((c) => visitForCheckbox(c, ctx));
  }

  if (typeof node === "string") {
    if (ctx.phase === "stripped") {
      ctx.phase = "done";
      return node.startsWith(" ") || node.startsWith("\t") ? node.slice(1) : node;
    }
    return node;
  }

  if (ctx.phase === "before" && isValidElement(node)) {
    const props = node.props as { type?: string; children?: ReactNode } | undefined;
    if (node.type === "input" && props?.type === "checkbox") {
      ctx.phase = "stripped";
      return null;
    }
    if (props?.children !== undefined) {
      return cloneElement(node, undefined, visitForCheckbox(props.children, ctx));
    }
  }
  return node;
}

export function MarkdownView({ content, onChange, onAddTaskFromLine }: Props) {
  // VaultContext 는 provider 밖에서도 null 로 안전 — 테스트 환경 (jsdom) 호환.
  const vaultCtx = useContext(VaultContext);
  const vaultRoot = vaultCtx?.vaultRoot ?? null;
  // Obsidian `![[파일]]` 임베드 → 표준 이미지 마크다운. 인덱스 없으면(provider 밖/로딩 중)
  // 원본 그대로 — 미해석 임베드는 텍스트로 보일 뿐 깨지지 않음.
  const imageIndex = useContext(VaultImageIndexContext);
  const rendered = useMemo(
    () => (imageIndex ? expandObsidianEmbeds(content, makeEmbedResolver(imageIndex)) : content),
    [content, imageIndex],
  );
  return (
    <div
      // font-size 는 wrapper 에서 inherit — 메모장은 default 1rem, 일기는 15px.
      // 이전엔 text-base 가 직접 박혀 일기 wrapper 의 15px 가 가려졌음 (편집 15 ↔ 보기 16 점프).
      className="markdown-view leading-relaxed"
      // index.css 의 `.font-serif { font-weight: 600 }` base 룰 가로채기 — 일기처럼
      // wrapper 가 font-serif 일 때 본문도 600 으로 끌려가는 footgun 차단.
      // h1-h6 / strong / em 자체 weight 는 각 컴포넌트 className 이 덮어씀.
      style={{ color: "var(--ink)", fontWeight: 400 }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-6 mb-3 font-serif text-2xl font-bold first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-5 mb-2 font-serif text-xl font-semibold first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-4 mb-2 font-serif text-lg font-semibold first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-4 mb-2 font-serif text-base font-semibold first:mt-0">
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5
              className="mt-3 mb-1.5 font-serif text-sm font-semibold uppercase tracking-wide first:mt-0"
              style={{ color: "var(--sub)" }}
            >
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6
              className="mt-3 mb-1.5 font-serif text-xs font-semibold uppercase tracking-wide first:mt-0"
              style={{ color: "var(--faint)" }}
            >
              {children}
            </h6>
          ),
          p: ({ children }) => (
            <p className="my-2 whitespace-pre-wrap leading-relaxed">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-6">{children}</ul>
          ),
          ol: ({ children, start }) => (
            <ol
              start={start}
              className="my-2 list-decimal space-y-1 pl-6"
            >
              {children}
            </ol>
          ),
          li: ({ children, node, className }) => {
            const classes =
              (node?.properties as { className?: unknown } | undefined)?.className;
            const classArr = Array.isArray(classes) ? classes : [];
            const isTask =
              classArr.includes("task-list-item") ||
              (typeof className === "string" && className.includes("task-list-item"));
            const offset = node?.position?.start?.offset;
            if (!isTask || offset == null) {
              return <li>{children}</li>;
            }
            // source 의 task marker 상태 (mdast checked 보다 안전 — onChange 후 즉시 반영).
            const m = content.slice(offset).match(/^(\s*[-*+]\s+)\[([ xX])\]/);
            const checked = m ? m[2].toLowerCase() === "x" : false;
            const inlineKids = extractTaskInline(children);
            const clickable = !!onChange;
            return (
              // -ml-6: 부모 ul 의 pl-6 (bullet list 용 marker 공간) 을 task 만 회수.
              //        같은 ul 안의 bullet li 는 그대로 marker 보임.
              // items-start + [&>span>p]:my-0: 여러 줄 task 도 체크박스가 첫 줄 앞에
              //        붙도록 top-align. mt-[5px] 가 (line-height 26 - checkbox 16) / 2
              //        — 첫 줄 텍스트의 vertical center 와 정렬.
              // group + relative: 좌측 gutter 영역 (li.visual-left 의 -1.5rem 위치 = 본문
              //   wrapper 의 px-6 padding 안) 에 absolute "+" 버튼. li 내부 inline flow
              //   는 그대로, 버튼은 hover 시에만 노출.
              // before:* — invisible hit-area 24px 좌측 확장. li 와 + 버튼 사이 갭에서
              //   마우스가 group-hover off 되던 깜빡임 차단.
              <li className="task-list-item group relative -ml-6 flex list-none items-start gap-2 [&>span>p]:my-0 before:absolute before:left-[-1.5rem] before:top-0 before:h-full before:w-6 before:content-['']">
                {onAddTaskFromLine ? (
                  <button
                    type="button"
                    onClick={() => {
                      const end = content.indexOf("\n", offset);
                      const lineText = content.slice(offset, end === -1 ? undefined : end);
                      onAddTaskFromLine(lineText);
                    }}
                    title="할 일로 추가"
                    aria-label="할 일로 추가"
                    className="absolute opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                    // size 를 inline 으로 박아 cascade 충돌 차단. minHeight: 0 은 글로벌
                    // `button { min-height: 44px }` (index.css) 우회 — 안 풀면 button 이
                    // 두 줄 높이로 부풂.
                    style={{
                      left: "-1.5rem",
                      top: "5px",
                      width: "1rem",
                      height: "1rem",
                      minHeight: 0,
                      padding: 0,
                      lineHeight: 1,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "0.25rem",
                      color: "var(--sub)",
                    }}
                  >
                    <Plus size={14} strokeWidth={2} aria-hidden />
                  </button>
                ) : null}
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly={!clickable}
                  disabled={!clickable}
                  onChange={() => {
                    if (!onChange) return;
                    onChange(toggleTaskCheckboxAt(content, offset));
                  }}
                  className={`mt-[5px] h-4 w-4 flex-shrink-0 ${
                    clickable ? "cursor-pointer" : ""
                  }`}
                  style={{ accentColor: "var(--down)" }}
                />
                <span
                  className="flex-1"
                  style={
                    checked
                      ? { color: "var(--faint)", textDecoration: "line-through" }
                      : undefined
                  }
                >
                  {inlineKids}
                </span>
              </li>
            );
          },
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
              style={{ color: "var(--sub)" }}
            >
              {children}
            </a>
          ),
          img: ({ src, alt, title }) => {
            const resolved = resolveImageSrc(
              typeof src === "string" ? src : undefined,
              vaultRoot,
            );
            return (
              <img
                src={resolved}
                alt={alt ?? ""}
                title={title}
                loading="lazy"
                className="my-3 block max-w-full rounded"
                style={{ border: "1px solid var(--line-2)" }}
              />
            );
          },
          // p 의 whitespace-pre-wrap 가 \n 을 시각적 줄바꿈으로 처리하므로,
          // mdast hard break (`  \n`) 가 <br> + 직후 "\n" 를 생성하면 줄이 2 번 끊김.
          // <br> 자체를 null 처리해 soft/hard break 모두 1줄로 — Obsidian 동작과 동일.
          br: () => null,
          // footnote ref (e.g. [^1] → <sup><a>1</a></sup>)
          sup: ({ children, className }) => (
            <sup
              className={className}
              style={{ fontSize: "0.75em", color: "var(--sub)" }}
            >
              {children}
            </sup>
          ),
          // footnote 정의 영역 (remark-gfm 가 본문 끝에 <section class="footnotes"> 로 박음).
          section: ({ children, node }) => {
            const classes =
              (node?.properties as { className?: unknown } | undefined)?.className;
            const isFootnotes = Array.isArray(classes) && classes.includes("footnotes");
            if (!isFootnotes) return <section>{children}</section>;
            return (
              <section
                className="mt-8 pt-3 text-sm"
                style={{
                  borderTop: "1px solid var(--line)",
                  color: "var(--sub)",
                }}
              >
                {children}
              </section>
            );
          },
          code: ({ children, className }) => {
            // pre ancestry 가 곧 block code — language class 없는 4-space indented 도 잡힘.
            // eslint-disable-next-line react-hooks/rules-of-hooks
            const insidePre = useContext(InsidePreContext);
            if (insidePre) {
              return (
                <code className={`${className ?? ""} font-mono text-sm`}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded px-1 py-0.5 font-mono text-sm"
                style={{
                  // surface-active — light/dark 모두 surface (모달 배경) 보다 한 단계 진함.
                  // 모달 안 (bg-surface) 위에서도, 메모장 main (bg-base) 위에서도 가시성.
                  backgroundColor: "var(--surface-2)",
                  color: "var(--ink)",
                }}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <InsidePreContext.Provider value={true}>
              <pre
                className="my-3 overflow-auto rounded p-3 font-mono text-sm whitespace-pre"
                style={{ backgroundColor: "var(--surface-2)" }}
              >
                {children}
              </pre>
            </InsidePreContext.Provider>
          ),
          blockquote: ({ children }) => (
            <blockquote
              className="my-3 pl-4 italic"
              style={{
                borderLeft: "2px solid var(--line)",
                color: "var(--sub)",
              }}
            >
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr
              className="my-6"
              style={{ borderColor: "var(--line)" }}
            />
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-auto">
              <table className="min-w-full border-collapse text-sm">
                {children}
              </table>
            </div>
          ),
          th: ({ children, node }) => {
            const align = (node?.properties as { align?: string } | undefined)?.align;
            return (
              <th
                className="px-2 py-1.5 font-semibold"
                style={{
                  borderBottom: "1px solid var(--line)",
                  // code/pre 와 같은 톤 — 모달 (surface) 위에서도 base 위에서도 분간.
                  backgroundColor: "var(--surface-2)",
                  textAlign: (align as "left" | "center" | "right" | undefined) ?? "left",
                }}
              >
                {children}
              </th>
            );
          },
          td: ({ children, node }) => {
            const align = (node?.properties as { align?: string } | undefined)?.align;
            return (
              <td
                className="px-2 py-1.5"
                style={{
                  borderBottom: "1px solid var(--line)",
                  textAlign: align as "left" | "center" | "right" | undefined,
                }}
              >
                {children}
              </td>
            );
          },
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => (
            <del
              className="line-through"
              style={{ color: "var(--faint)" }}
            >
              {children}
            </del>
          ),
        }}
      >
        {rendered}
      </ReactMarkdown>
    </div>
  );
}

