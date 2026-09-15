import {
  ClipboardCopy,
  Download,
  FolderInput,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "../common/Button";

// 메모 메뉴의 공유 아이템 — 사이드바 우클릭 메뉴와 타이틀바 … 메뉴가 같은 항목/순서를
// 쓰도록 단일 source. 고정 / 폴더로 이동 / (구분선) / 마크다운 복사 / 내보내기 /
// (구분선) / 삭제. 위치(고정 좌표 vs 버튼 아래 포털)는 각 surface 가 담당.
export type MeetingMenuItemsProps = {
  pinned: boolean;
  onTogglePin: () => void;
  onMove: () => void;
  onCopy: () => void;
  onExport: () => void;
  onDelete: () => void;
  deleteDisabled?: boolean;
};

export function MeetingMenuItems({
  pinned,
  onTogglePin,
  onMove,
  onCopy,
  onExport,
  onDelete,
  deleteDisabled,
}: MeetingMenuItemsProps) {
  return (
    <>
      <MenuItem
        label={pinned ? "고정 해제" : "고정"}
        icon={
          <Star
            className="h-3.5 w-3.5 shrink-0"
            fill={pinned ? "var(--accent-yellow)" : "none"}
            style={{
              color: pinned ? "var(--accent-yellow)" : "var(--faint)",
            }}
          />
        }
        onClick={onTogglePin}
      />
      <MenuItem
        label="폴더로 이동..."
        icon={
          <FolderInput
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: "var(--faint)" }}
          />
        }
        onClick={onMove}
      />
      <MenuDivider />
      <MenuItem
        label="마크다운 복사"
        icon={
          <ClipboardCopy
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: "var(--faint)" }}
          />
        }
        onClick={onCopy}
      />
      <MenuItem
        label="내보내기"
        icon={
          <Download
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: "var(--faint)" }}
          />
        }
        onClick={onExport}
      />
      <MenuDivider />
      <MenuItem
        label="삭제"
        icon={<Trash2 className="h-3.5 w-3.5 shrink-0" />}
        danger
        disabled={deleteDisabled}
        onClick={onDelete}
      />
    </>
  );
}

function MenuDivider() {
  return (
    <div
      className="my-1 h-px"
      style={{ backgroundColor: "var(--line)" }}
    />
  );
}

export function MenuItem({
  label,
  icon,
  danger,
  disabled,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="w-full justify-start gap-2 rounded-none px-3 py-1.5 font-normal disabled:opacity-40"
      style={{
        color: danger ? "var(--down-ink)" : "var(--ink)",
      }}
    >
      {icon}
      <span>{label}</span>
    </Button>
  );
}
