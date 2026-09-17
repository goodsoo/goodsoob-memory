import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Minus,
  Table,
} from "lucide-react";
import type { SlashTargetKind } from "../../lib/markdownTyping";
import { NavItem } from "../../ds/NavItem";
import { Text } from "../common/Text";

export type SlashOption = {
  id: string;
  label: string;
  hint: string;
  keywords: string[]; // filter 매칭용 — 한글 + 영문
  target: SlashTargetKind;
  Icon: React.ComponentType<{ className?: string }>;
};

const OPTIONS: SlashOption[] = [
  {
    id: "h1",
    label: "제목 1",
    hint: "# ",
    keywords: ["h1", "heading1", "제목1", "title", "header1", "큰제목"],
    target: { type: "heading", level: 1 },
    Icon: Heading1,
  },
  {
    id: "h2",
    label: "제목 2",
    hint: "## ",
    keywords: ["h2", "heading2", "제목2", "header2"],
    target: { type: "heading", level: 2 },
    Icon: Heading2,
  },
  {
    id: "h3",
    label: "제목 3",
    hint: "### ",
    keywords: ["h3", "heading3", "제목3", "header3"],
    target: { type: "heading", level: 3 },
    Icon: Heading3,
  },
  {
    id: "bullet",
    label: "점 목록",
    hint: "- ",
    keywords: ["bullet", "list", "ul", "점", "목록", "list", "리스트"],
    target: { type: "bullet" },
    Icon: List,
  },
  {
    id: "ordered",
    label: "번호 목록",
    hint: "1. ",
    keywords: ["ordered", "ol", "번호", "숫자", "number", "ol"],
    target: { type: "ordered" },
    Icon: ListOrdered,
  },
  {
    id: "checkbox",
    label: "체크박스",
    hint: "- [ ] ",
    keywords: ["check", "checkbox", "todo", "task", "체크", "할일", "투두"],
    target: { type: "checkbox" },
    Icon: CheckSquare,
  },
  {
    id: "quote",
    label: "인용",
    hint: "> ",
    keywords: ["quote", "blockquote", "인용", "quote"],
    target: { type: "quote" },
    Icon: Quote,
  },
  {
    id: "code",
    label: "코드 블록",
    hint: "```",
    keywords: ["code", "fence", "코드", "code-block"],
    target: { type: "code-fence" },
    Icon: Code,
  },
  {
    id: "hr",
    label: "구분선",
    hint: "---",
    keywords: ["hr", "divider", "rule", "구분선", "선"],
    target: { type: "hr" },
    Icon: Minus,
  },
  {
    id: "table",
    label: "표",
    hint: "table",
    keywords: ["table", "표", "테이블"],
    target: { type: "table" },
    Icon: Table,
  },
];

function filterOptions(filter: string): SlashOption[] {
  const q = filter.trim().toLowerCase();
  if (!q) return OPTIONS;
  return OPTIONS.filter((o) =>
    o.keywords.some((k) => k.toLowerCase().startsWith(q)) ||
    o.label.toLowerCase().includes(q),
  );
}

// 부모 컴포넌트 (MeetingForm) 가 같은 매칭 함수로 popover 닫기 결정 — 같은 파일에서
// export 해야 룰 일관. Fast refresh 회피를 위해 함수 export 허용 disable.
// eslint-disable-next-line react-refresh/only-export-components
export function getSlashOptionsForFilter(filter: string): SlashOption[] {
  return filterOptions(filter);
}

type Props = {
  filter: string;
  selectedIndex: number;
  onSelect: (option: SlashOption) => void;
  onClose: () => void;
  // viewport 좌표 (fixed positioning). body 로 portal 되므로 clipping ancestor 무관.
  // 호출부 (SourceBodyEditor) 가 옵션 수 + 모달 bottom 기준으로 flip 까지 결정해 넘김.
  anchorTop: string;
  anchorLeft: string;
};

export function SlashCommandPopover({
  filter,
  selectedIndex,
  onSelect,
  anchorTop,
  anchorLeft,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const options = useMemo(() => filterOptions(filter), [filter]);

  // selected item 을 viewport 안으로 스크롤.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (options.length === 0) {
    // 필터가 아무것도 안 맞으면 안내만 — 닫지는 않음 (사용자가 backspace 하면 다시 보일 수 있게).
    return createPortal(
      <Text
        variant="caption"
        color="secondary"
        as="div"
        role="listbox"
        className="fixed z-[70] w-[200px] rounded-md p-2 shadow-md"
        style={{
          top: anchorTop,
          left: anchorLeft,
          backgroundColor: "var(--surface)",
          border: "1px solid var(--line)",
        }}
      >
        일치하는 명령이 없음
      </Text>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={listRef}
      role="listbox"
      aria-label="슬래시 커맨드"
      className="fixed z-[70] max-h-[400px] w-[200px] overflow-y-auto rounded-md py-1 shadow-md"
      style={{
        top: anchorTop,
        left: anchorLeft,
        backgroundColor: "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      {options.map((o, i) => {
        const active = i === selectedIndex;
        return (
          <NavItem
            key={o.id}
            icon={<o.Icon className="h-3.5 w-3.5 flex-shrink-0" />}
            active={active}
            role="option"
            aria-selected={active}
            data-index={i}
            // mousedown 으로 처리 — textarea blur 가 click 보다 먼저 발생해서 click 까지
            // 갈 때 이미 popover 가 닫혀버림.
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(o);
            }}
            className="rounded-none px-3 py-1.5"
            style={{
              color: active ? "var(--ink)" : "var(--sub)",
              backgroundColor: active ? "var(--surface-3)" : undefined,
            }}
          >
            <span className="flex-1">{o.label}</span>
            <Text
              variant="caption"
              color="muted"
              as="span"
              className="font-mono text-3xs tabular-nums"
            >
              {o.hint}
            </Text>
          </NavItem>
        );
      })}
    </div>,
    document.body,
  );
}
