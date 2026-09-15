import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus } from "lucide-react";
import { usePortfolioCategories } from "../../hooks/usePortfolio";

type Props = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  // 입력창에 표시되는 label width 강제 (form grid 안에서). 미지정 = w-full.
  className?: string;
};

// 카테고리 입력 — vault union 의 카드 frontmatter.category 들을 자동완성 후보로.
// 매치 없는 입력을 commit 하면 그 자리에서 새 카테고리 생성 (옵시디안 tag 패턴).
// 모든 카테고리가 동등 — master list / builtin / 색 구분 없음. 카드 0 → 빈 후보, 사용자
// 가 어떤 값이든 commit 가능. 마지막 카드가 그 슬러그를 떼면 후보에서 자동 소멸.
export function CategoryCombobox({
  value,
  onChange,
  placeholder = "카테고리를 입력하세요",
  autoFocus,
  className,
}: Props) {
  const categories = usePortfolioCategories();
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLUListElement | null>(null);
  const listboxId = useId();
  // draft 의 latest 값 추적 — onBlur / outside-click handler 의 stale closure 회피
  // (selectRow 가 commit 후 input.blur() 발사하면 onBlur handler 가 옛 closure draft 로
  // commit 다시 호출해 새 값 덮어쓰던 race).
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  // popover 를 portal 로 띄워 부모 scroll/overflow clip 회피. wrap rect 기반 fixed positioning.
  const [popRect, setPopRect] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  // 외부 value 변경 (예: AI 제안 적용) 시 draft 동기화.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // outside click 으로 popover 닫고 draft commit. portal popover 영역 안 click 은 보존.
  // draftRef 사용 — handler 자체는 open 변화 시에만 재바인딩 (draft 변화로 매 keystroke
  // 리바인딩 X).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      commit(draftRef.current);
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // popover 위치 계산 — open 시 + scroll/resize 시. wrap rect 기반 fixed positioning.
  useEffect(() => {
    if (!open) {
      setPopRect(null);
      return;
    }
    const update = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPopRect({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true); // capture: scroll container 도 포함
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const trimmed = draft.trim();
  // 자동완성 후보 = vault union 안 startsWith(trimmed) 매칭. 빈 입력은 전체.
  // case-insensitive — 카테고리 slug 는 영문/한글 혼재 가능, 대소문자 영문 후보면 차분히.
  const matches = useMemo(() => {
    if (!trimmed) return categories;
    const lower = trimmed.toLowerCase();
    return categories.filter((c) => c.toLowerCase().includes(lower));
  }, [categories, trimmed]);

  // 완전 일치 후보가 없고 trimmed 가 비어있지 않으면 "새로 만들기" 행 표시.
  const exactMatch = matches.some((c) => c === trimmed);
  const showCreateRow = trimmed.length > 0 && !exactMatch;
  const totalRows = matches.length + (showCreateRow ? 1 : 0);

  // highlight 가 row 범위 밖이면 0 으로 리셋.
  useEffect(() => {
    if (highlight >= totalRows) setHighlight(0);
  }, [highlight, totalRows]);

  const commit = (next: string) => {
    const t = next.trim();
    if (!t) {
      // 빈 commit = 변경 X (옛 값 유지) + draft 복원.
      setDraft(value);
      return;
    }
    if (t !== value) onChange(t);
    setDraft(t);
  };

  const selectRow = (idx: number) => {
    if (idx < matches.length) {
      commit(matches[idx]);
    } else if (showCreateRow) {
      commit(trimmed);
    }
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((i) => Math.min(totalRows - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && totalRows > 0) {
        selectRow(highlight);
      } else {
        commit(draft);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(value);
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={wrapRef} className={`relative ${className ?? "w-full"}`}>
      <div
        className="flex items-center rounded-md"
        style={{
          backgroundColor: "var(--surface)",
          border: "1px solid var(--line)",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          autoFocus={autoFocus}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // popover 안 click 으로 들어오는 blur 는 onDown handler 가 처리.
            // 아무 row 도 안 누른 단순 blur 는 draft commit. draftRef 로 latest —
            // selectRow 가 commit 후 호출하는 blur 가 옛 closure 로 덮어쓰는 race 회피.
            if (!wrapRef.current?.matches(":focus-within")) {
              commit(draftRef.current);
              setOpen(false);
            }
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="flex-1 rounded-md bg-transparent px-2 py-1.5 text-sm outline-none"
          style={{ color: "var(--ink)" }}
        />
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o);
            inputRef.current?.focus();
          }}
          aria-label="후보 펼치기"
          className="px-1.5"
          style={{ color: "var(--faint)" }}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && totalRows > 0 && popRect
        ? createPortal(
            <ul
              ref={popoverRef}
              id={listboxId}
              role="listbox"
              className="max-h-56 overflow-y-auto rounded-md py-1 shadow-lg"
              style={{
                position: "fixed",
                left: popRect.left,
                top: popRect.top,
                width: popRect.width,
                zIndex: 1000,
                backgroundColor: "var(--surface)",
                border: "1px solid var(--line)",
              }}
            >
              {matches.map((slug, idx) => {
                const active = idx === highlight;
                return (
                  <li
                    key={slug}
                    role="option"
                    aria-selected={slug === value}
                    onMouseEnter={() => setHighlight(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectRow(idx);
                    }}
                    className="cursor-pointer px-2 py-1.5 text-sm"
                    style={{
                      backgroundColor: active
                        ? "var(--surface-3)"
                        : "transparent",
                      color: "var(--ink)",
                    }}
                  >
                    {slug}
                  </li>
                );
              })}
              {showCreateRow ? (
                <li
                  role="option"
                  aria-selected={false}
                  onMouseEnter={() => setHighlight(matches.length)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectRow(matches.length);
                  }}
                  className="flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-sm"
                  style={{
                    backgroundColor:
                      highlight === matches.length
                        ? "var(--surface-3)"
                        : "transparent",
                    color: "var(--sub)",
                    borderTop:
                      matches.length > 0
                        ? "1px solid var(--line-2)"
                        : "none",
                  }}
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <span>새로 만들기: </span>
                  <span style={{ color: "var(--ink)" }}>
                    "{trimmed}"
                  </span>
                </li>
              ) : null}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
