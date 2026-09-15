import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  LayoutGrid,
  CheckSquare,
  FileText,
  Search,
  Star,
} from "lucide-react";
import {
  useGlobalSearchIndex,
  type SearchDomain,
  type SearchEntry,
} from "../../hooks/useGlobalSearchIndex";
import { Text } from "../common/Text";

// 옵시디안 quick switcher (Cmd+P) 패턴 — vault 4 도메인 통합 검색.
// meeting / task / portfolio / journal 결과 한 list, 행에 도메인 chip + 매칭 highlight.
// 선택 시 도메인별 라우팅 콜백 발사. 모달은 어디서든 발사 가능.

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (entry: SearchEntry) => void;
};

export function QuickSwitcher({ open, onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const index = useGlobalSearchIndex(open);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIdx(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const results = useMemo(() => {
    if (!index.data) return [];
    return search(index.data, query);
  }, [index.data, query]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const r = results[activeIdx];
        if (r) {
          onSelect(r.entry);
          onClose();
        }
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, activeIdx, onClose, onSelect]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-qs-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  useEffect(() => {
    if (activeIdx >= results.length) setActiveIdx(0);
  }, [results.length, activeIdx]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.35)", paddingTop: "12vh" }}
      onClick={onClose}
    >
      <div
        className="flex flex-col overflow-hidden rounded-lg shadow-2xl"
        style={{
          // 크기 고정 — 결과 갯수와 무관하게 일정. 결과 영역은 내부 flex-1
          // overflow-y-auto 가 흡수해 list 비어도/길어도 모달 자체는 흔들림 X.
          width: "min(640px, calc(100vw - 32px))",
          height: "min(560px, calc(100vh - 24vh))",
          backgroundColor: "var(--bg)",
          border: "1px solid var(--line)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex shrink-0 items-center gap-2 px-3 py-2"
          style={{ borderBottom: "1px solid var(--line)" }}
        >
          <Search
            className="h-4 w-4 shrink-0"
            style={{ color: "var(--faint)" }}
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="메모 · 할 일 · 포트폴리오 · 일기 검색..."
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--ink)" }}
          />
          <kbd
            className="rounded px-1.5 py-0.5 text-3xs"
            style={{
              backgroundColor: "var(--surface)",
              color: "var(--faint)",
              border: "1px solid var(--line-2)",
            }}
          >
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {index.isLoading ? (
            <Text variant="caption" color="muted" as="div" className="px-3 py-4 text-center">
              불러오는 중...
            </Text>
          ) : results.length === 0 ? (
            <Text variant="caption" color="muted" as="div" className="px-3 py-4 text-center">
              {query ? "검색 결과가 없습니다" : "검색 대상이 없습니다"}
            </Text>
          ) : (
            results.map((r, i) => (
              <ResultRow
                key={`${r.entry.domain}:${r.entry.id}`}
                idx={i}
                result={r}
                active={i === activeIdx}
                query={query}
                onSelect={() => {
                  onSelect(r.entry);
                  onClose();
                }}
                onHover={() => setActiveIdx(i)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  idx,
  result,
  active,
  query,
  onSelect,
  onHover,
}: {
  idx: number;
  result: Result;
  active: boolean;
  query: string;
  onSelect: () => void;
  onHover: () => void;
}) {
  const { entry, bodyExcerpt } = result;
  const meta = domainMeta(entry.domain);
  const Icon = entry.pinned ? Star : meta.icon;
  const iconColor = entry.pinned ? "var(--accent-yellow)" : meta.color;
  return (
    <button
      type="button"
      data-qs-idx={idx}
      onClick={onSelect}
      onMouseEnter={onHover}
      className="flex w-full items-start gap-2 px-3 py-2 text-left"
      style={{
        backgroundColor: active ? "var(--surface-3)" : undefined,
      }}
    >
      <Icon
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        fill={entry.pinned ? "var(--accent-yellow)" : "none"}
        style={{ color: iconColor }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <Text variant="body" as="span" truncate className="min-w-0 flex-1">
            <Highlight text={entry.title || "(제목 없음)"} query={query} />
          </Text>
          {entry.metaLabel ? (
            <Text
              variant="caption"
              color="muted"
              as="span"
              className="shrink-0 text-2xs tabular-nums"
            >
              {entry.metaLabel}
            </Text>
          ) : null}
          {/* 도메인 chip 은 항상 행 가장 우측 — 모든 행 통일 위치로 시각 anchor */}
          <span
            className="shrink-0 rounded-full px-1.5 py-0.5 text-3xs"
            style={{
              backgroundColor: meta.bg,
              color: meta.color,
            }}
          >
            {meta.label}
          </span>
        </div>
        {bodyExcerpt ? (
          <Text
            variant="caption"
            color="muted"
            as="div"
            className="mt-0.5 truncate"
          >
            <Highlight text={bodyExcerpt} query={query} />
          </Text>
        ) : null}
      </div>
    </button>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark
        key={key++}
        style={{
          backgroundColor: "var(--accent-yellow)",
          color: "var(--ink)",
          padding: "0 1px",
          borderRadius: "2px",
        }}
      >
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
  }
  return <>{parts}</>;
}

// 도메인별 시각 메타 — 결과 행의 아이콘 + chip 색.
function domainMeta(d: SearchDomain): {
  label: string;
  icon: typeof FileText;
  color: string;
  bg: string;
} {
  switch (d) {
    case "meeting":
      return {
        label: "메모",
        icon: FileText,
        color: "var(--accent-ink)",
        bg: "var(--accent-soft)",
      };
    case "task":
      return {
        label: "할 일",
        icon: CheckSquare,
        // tasks 의 work category 와 같은 톤 (주황). 시각 통일.
        color: "var(--cat-work)",
        bg: "var(--surface)",
      };
    case "portfolio":
      return {
        label: "포트폴리오",
        icon: LayoutGrid,
        color: "var(--cat-uiux)",
        bg: "var(--surface)",
      };
    case "journal":
      return {
        label: "일기",
        icon: BookOpen,
        color: "var(--cat-other)",
        bg: "var(--surface)",
      };
  }
}

type Result = {
  entry: SearchEntry;
  score: number;
  bodyExcerpt: string | null;
};

function search(entries: SearchEntry[], query: string): Result[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    // 빈 검색 — 도메인 우선순위 + entry 순서 (도메인별 list 가 이미 적절히 정렬됨).
    // pinned 우선 (메모만 pinned 있음 — 위로).
    const sorted = [...entries].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return DOMAIN_ORDER[a.domain] - DOMAIN_ORDER[b.domain];
    });
    return sorted.map((entry) => ({ entry, score: 0, bodyExcerpt: null }));
  }
  const results: Result[] = [];
  for (const entry of entries) {
    const title = entry.title.toLowerCase();
    const body = entry.body.toLowerCase();
    let score = 0;
    if (title === q) score = 1000;
    else if (title.startsWith(q)) score = 500;
    else if (title.includes(q)) score = 200;
    let bodyMatchIdx = -1;
    if (body.includes(q)) {
      bodyMatchIdx = body.indexOf(q);
      score += 50;
    }
    if (score === 0) continue;
    // pinned 메모는 score boost — 동률일 때 위.
    if (entry.pinned) score += 10;
    const bodyExcerpt =
      bodyMatchIdx !== -1 ? excerpt(entry.body, bodyMatchIdx, q.length) : null;
    results.push({ entry, score, bodyExcerpt });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

const DOMAIN_ORDER: Record<SearchDomain, number> = {
  meeting: 0,
  journal: 1,
  task: 2,
  portfolio: 3,
};

function excerpt(body: string, matchIdx: number, matchLen: number): string {
  const start = Math.max(0, matchIdx - 30);
  const end = Math.min(body.length, matchIdx + matchLen + 50);
  let s = body.slice(start, end);
  s = s.replace(/\s+/g, " ").trim();
  if (start > 0) s = "..." + s;
  if (end < body.length) s = s + "...";
  return s;
}
