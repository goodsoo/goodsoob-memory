import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, MoreVertical } from "lucide-react";
import {
  type MeetingMarkdownInput,
  type MeetingMarkdownSection,
} from "../../lib/markdown";
import { copyMeetingMarkdown } from "../../lib/meetingExport";
import { Button } from "../common/Button";
import { MeetingMenuItems } from "./MeetingMenuItems";

type Props = {
  meeting: MeetingMarkdownInput;
  // 현재 탭 — 헤더(제목/일시/참석) 뒤에 이 탭 내용을 붙여 복사.
  section?: MeetingMarkdownSection;
  pinned: boolean;
  onTogglePin: () => void;
  onMove: () => void;
  // 내보내기 — 부모가 섹션 선택 모달을 연다 (섹션별 파일 저장).
  onExport: () => void;
  onError?: (message: string) => void;
  onDelete: () => void;
  deleteDisabled?: boolean;
};

const MENU_WIDTH = 184;

// 메모 헤더 우측 "..." 메뉴 — 사이드바 우클릭 메뉴와 동일 항목 (MeetingMenuItems 공유).
// 드롭다운은 body 로 portal — PageHeaderBar 의 overflow-hidden 에 잘리지 않게 fixed 위치.
export function MeetingActionMenu({
  meeting,
  section,
  pinned,
  onTogglePin,
  onMove,
  onExport,
  onError,
  onDelete,
  deleteDisabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // open 시 trigger rect 로 fixed 위치 계산 (우측 정렬, 버튼 아래).
  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, [open]);

  // 외부 클릭 닫기 (trigger + 메뉴 둘 다 제외) + ESC + 스크롤/리사이즈 닫기.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReflow = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open]);

  async function handleCopy() {
    const ok = await copyMeetingMarkdown(meeting, section);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1000);
      setOpen(false);
    } else {
      onError?.("복사에 실패했습니다. 권한 또는 환경을 확인하고 다시 시도하세요.");
    }
  }

  function handleExport() {
    setOpen(false);
    onExport();
  }

  function handleDelete() {
    setOpen(false);
    onDelete();
  }

  return (
    <div ref={triggerRef} className="relative">
      <Button
        variant="ghost"
        onClick={() => setOpen((o) => !o)}
        title="메모 메뉴"
        aria-label="메모 메뉴"
        aria-haspopup="menu"
        aria-expanded={open}
        className="px-1.5 py-1"
        style={{
          border: "1px solid var(--line-2)",
          color: copied ? "var(--down)" : "var(--faint)",
          backgroundColor: open ? "var(--surface-3)" : undefined,
        }}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <MoreVertical className="h-3.5 w-3.5" />
        )}
      </Button>

      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-50 overflow-hidden rounded-lg py-1 text-sm shadow-lg"
              style={{
                top: pos.top,
                right: pos.right,
                width: MENU_WIDTH,
                backgroundColor: "var(--surface)",
                border: "1px solid var(--line)",
              }}
            >
              <MeetingMenuItems
                pinned={pinned}
                onTogglePin={() => {
                  setOpen(false);
                  onTogglePin();
                }}
                onMove={() => {
                  setOpen(false);
                  onMove();
                }}
                onCopy={() => void handleCopy()}
                onExport={handleExport}
                onDelete={handleDelete}
                deleteDisabled={deleteDisabled}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
