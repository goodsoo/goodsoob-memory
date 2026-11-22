import { createContext } from "react";
import {
  ClipboardCopy,
  Download,
  FolderInput,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import type { ContextMenuItem, DropdownItem } from "@goodsoob/ds";
import type { Meeting } from "../../api/meetings";

// 메모·폴더 메뉴 항목 — 한 배열을 DS ContextMenu(우클릭·롱프레스)와 DS Dropdown(… 버튼)
// 양쪽에 그대로 넘긴다(DS §9-2-1: separator·label 호환, danger=ContextMenu / tone=Dropdown).
// 아이콘은 label 안에 둔다(Dropdown 항목엔 icon 필드가 없음).
export type MenuEntry = DropdownItem & ContextMenuItem;

const ICON = "h-4 w-4 shrink-0";
const faint = { color: "var(--faint)" };

export type MeetingMenuHandlers = {
  pinned: boolean;
  onTogglePin: () => void;
  onMove: () => void;
  onCopy: () => void;
  onExport: () => void;
  onDelete: () => void;
  deleteDisabled?: boolean;
};

// 고정 / 폴더로 이동 / (구분선) / 마크다운 복사 / 내보내기 / (구분선) / 삭제.
// 사이드바 우클릭과 메모 헤더 … 메뉴가 같은 항목·순서를 쓰는 단일 source.
export function meetingMenuEntries({
  pinned,
  onTogglePin,
  onMove,
  onCopy,
  onExport,
  onDelete,
  deleteDisabled,
}: MeetingMenuHandlers): MenuEntry[] {
  return [
    {
      key: "pin",
      label: (
        <>
          <Star
            className={ICON}
            fill={pinned ? "var(--accent-yellow)" : "none"}
            style={{ color: pinned ? "var(--accent-yellow)" : "var(--faint)" }}
          />
          {pinned ? "고정 해제" : "고정"}
        </>
      ),
      onSelect: onTogglePin,
    },
    {
      key: "move",
      label: (
        <>
          <FolderInput className={ICON} style={faint} />
          폴더로 이동...
        </>
      ),
      onSelect: onMove,
    },
    { key: "sep-1", separator: true },
    {
      key: "copy",
      label: (
        <>
          <ClipboardCopy className={ICON} style={faint} />
          마크다운 복사
        </>
      ),
      onSelect: onCopy,
    },
    {
      key: "export",
      label: (
        <>
          <Download className={ICON} style={faint} />
          내보내기
        </>
      ),
      onSelect: onExport,
    },
    { key: "sep-2", separator: true },
    {
      key: "delete",
      label: (
        <>
          <Trash2 className={ICON} />
          삭제
        </>
      ),
      danger: true,
      tone: "danger",
      disabled: deleteDisabled,
      onSelect: onDelete,
    },
  ];
}

// 폴더 메뉴 — 이름 변경 / 폴더 삭제.
export function folderMenuEntries({
  onRename,
  onDelete,
}: {
  onRename: () => void;
  onDelete: () => void;
}): MenuEntry[] {
  return [
    {
      key: "rename",
      label: (
        <>
          <Pencil className={ICON} style={faint} />
          이름 변경...
        </>
      ),
      onSelect: onRename,
    },
    {
      key: "delete",
      label: (
        <>
          <Trash2 className={ICON} />
          폴더 삭제...
        </>
      ),
      danger: true,
      tone: "danger",
      onSelect: onDelete,
    },
  ];
}

// 사이드바 트리 행이 메뉴 항목·열림 알림을 받는 통로 — SidePanel 이 제공.
// 열림 알림은 "메뉴가 열린 동안 그 행 강조"(contextMeetingId/contextFolder)에만 쓴다.
export type TreeMenus = {
  meetingMenu: (meeting: Meeting) => MenuEntry[];
  folderMenu: (folder: string) => MenuEntry[];
  onMeetingMenuOpenChange: (meetingId: string, open: boolean) => void;
  onFolderMenuOpenChange: (folder: string, open: boolean) => void;
};

export const TreeMenuContext = createContext<TreeMenus | null>(null);
