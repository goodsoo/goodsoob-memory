import { useState } from "react";
import { Dropdown } from "@goodsoob/ds";
import { Check, MoreVertical } from "lucide-react";
import {
  type MeetingMarkdownInput,
  type MeetingMarkdownSection,
} from "../../lib/markdown";
import { copyMeetingMarkdown } from "../../lib/meetingExport";
import { Button } from "../common/Button";
import { meetingMenuEntries } from "./MeetingMenuItems";

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

// 메모 헤더 우측 "..." 메뉴 — 사이드바 우클릭 메뉴와 동일 항목(meetingMenuEntries 공유).
// DS Dropdown: 포털·위치·바깥 클릭/ESC 닫기는 DS 가 소유(PageHeaderBar overflow 에 안 잘림).
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

  async function handleCopy() {
    const ok = await copyMeetingMarkdown(meeting, section);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1000);
    } else {
      onError?.(
        "복사에 실패했습니다. 권한 또는 환경을 확인하고 다시 시도하세요.",
      );
    }
  }

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          variant="ghost"
          title="메모 메뉴"
          aria-label="메모 메뉴"
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
      }
      items={meetingMenuEntries({
        pinned,
        onTogglePin,
        onMove,
        onCopy: () => void handleCopy(),
        onExport,
        onDelete,
        deleteDisabled,
      })}
    />
  );
}
