import { ChevronUp, ChevronDown, ChevronRight, X, CaseSensitive } from "lucide-react";

type Props = {
  query: string;
  onQueryChange: (v: string) => void;
  caseSensitive: boolean;
  onToggleCase: () => void;
  // 1-based 현재 위치, 전체 개수. 매치 없으면 active=0.
  active: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  // ── 바꾸기 (▸ 펼침) ──
  expanded: boolean;
  onToggleExpanded: () => void;
  replaceValue: string;
  onReplaceChange: (v: string) => void;
  onReplaceOne: () => void;
  onReplaceAll: () => void;
  // 편집 모드에서만 치환 가능 — 보기 모드면 바꾸기 줄 비활성 + 안내.
  canReplace: boolean;
};

// 메모장 우상단에 떠 있는 탭 내 찾기 / 바꾸기 바. Cmd+F 로 열고 Esc 로 닫는다.
// 왼쪽 ▸ 토글로 바꾸기 줄을 펼치는 2단 구조 (브라우저·VSCode 멘탈모델).
// 찾기: Enter/↓ = 다음, Shift+Enter/↑ = 이전. 바꾸기: Enter = 바꾸기, Mod+Enter = 전체 바꾸기.
// 동작은 부모(MeetingForm)가 처리.
export function FindBar({
  query,
  onQueryChange,
  caseSensitive,
  onToggleCase,
  active,
  total,
  onNext,
  onPrev,
  onClose,
  inputRef,
  expanded,
  onToggleExpanded,
  replaceValue,
  onReplaceChange,
  onReplaceOne,
  onReplaceAll,
  canReplace,
}: Props) {
  const noResult = query !== "" && total === 0;
  const replaceDisabled = !canReplace || total === 0;

  return (
    <div
      className="absolute right-4 top-16 z-30 flex items-start gap-1 rounded-lg px-1.5 py-1 shadow-md"
      style={{
        backgroundColor: "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      <button
        type="button"
        onClick={onToggleExpanded}
        title={expanded ? "바꾸기 접기" : "바꾸기 펼치기"}
        aria-expanded={expanded}
        className="mt-0.5 shrink-0 rounded p-1"
        style={{ color: "var(--faint)" }}
      >
        <ChevronRight
          className="h-4 w-4 transition-transform"
          style={{ transform: expanded ? "rotate(90deg)" : "none" }}
        />
      </button>

      <div className="flex flex-col gap-1">
        {/* 찾기 줄 */}
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) onPrev();
                else onNext();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                onNext();
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                onPrev();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="현재 탭에서 찾기"
            spellCheck={false}
            autoCorrect="off"
            className="w-44 bg-transparent px-1.5 py-0.5 text-sm outline-none"
            style={{ color: "var(--ink)" }}
          />
          <span
            className="min-w-[3.5rem] shrink-0 whitespace-nowrap text-right text-xs tabular-nums"
            style={{ color: noResult ? "var(--down)" : "var(--faint)" }}
          >
            {noResult
              ? "결과 없음"
              : total === 0
                ? ""
                : active === 0
                  ? `${total}개`
                  : `${active} / ${total}`}
          </span>
          <button
            type="button"
            onClick={onToggleCase}
            title="대소문자 구분"
            className="rounded p-1"
            style={{
              color: caseSensitive ? "var(--text-inverse)" : "var(--faint)",
              backgroundColor: caseSensitive ? "var(--accent)" : "transparent",
            }}
          >
            <CaseSensitive className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onPrev}
            disabled={total === 0}
            title="이전 (Shift+Enter)"
            className="rounded p-1 disabled:opacity-30"
            style={{ color: "var(--sub)" }}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={total === 0}
            title="다음 (Enter)"
            className="rounded p-1 disabled:opacity-30"
            style={{ color: "var(--sub)" }}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="닫기 (Esc)"
            className="rounded p-1"
            style={{ color: "var(--sub)" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 바꾸기 줄 — ▸ 펼침 시만. 보기 모드면 비활성 + 안내. */}
        {expanded ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={replaceValue}
              onChange={(e) => onReplaceChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (e.metaKey || e.ctrlKey) onReplaceAll();
                  else onReplaceOne();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                }
              }}
              placeholder="바꿀 내용을 입력하세요"
              spellCheck={false}
              autoCorrect="off"
              disabled={!canReplace}
              className="w-44 bg-transparent px-1.5 py-0.5 text-sm outline-none disabled:opacity-50"
              style={{ color: "var(--ink)" }}
            />
            {canReplace ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onReplaceOne}
                  disabled={replaceDisabled}
                  title="현재 매치 바꾸기 (Enter)"
                  className="rounded px-1.5 py-0.5 text-xs disabled:opacity-30"
                  style={{ color: "var(--sub)" }}
                >
                  바꾸기
                </button>
                <button
                  type="button"
                  onClick={onReplaceAll}
                  disabled={replaceDisabled}
                  title="전체 바꾸기 (Cmd+Enter)"
                  className="rounded px-1.5 py-0.5 text-xs disabled:opacity-30"
                  style={{ color: "var(--sub)" }}
                >
                  전체 바꾸기
                </button>
              </div>
            ) : (
              <span
                className="px-1 text-xs"
                style={{ color: "var(--faint)" }}
              >
                편집 모드에서 바꿀 수 있습니다
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
