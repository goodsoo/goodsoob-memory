import { Eye, Pencil } from "lucide-react";
import { Button } from "./Button";

// 편집/보기 세그먼트 토글 — [편집 | 보기] 두 칸을 다 보여주고 현재 칸만 채움.
// 단일 칩(현재 상태를 액션 라벨로 오독)의 모호함 제거: 채워진 칸 = 지금 상태,
// 옆 칸 누르면 전환 (GitHub Write/Preview·iOS 세그먼트 패턴). 메모장 3탭 +
// 일기 오버레이 공용. onToggle 은 단순 flip — 비활성 칸 클릭만 발사.
export function ModeChip({
  viewMode,
  onToggle,
}: {
  viewMode: "edit" | "view";
  onToggle: () => void;
}) {
  const isEdit = viewMode === "edit";
  return (
    <div
      role="group"
      aria-label="편집·보기 전환"
      className="inline-flex items-center gap-0.5 rounded-md p-0.5"
      style={{
        border: "1px solid var(--line-2)",
        backgroundColor: "var(--surface)",
      }}
    >
      <ModeSegment
        label="편집"
        icon={<Pencil className="h-3 w-3" />}
        active={isEdit}
        activeBg="var(--accent-soft)"
        activeText="var(--accent-ink)"
        onClick={() => {
          if (!isEdit) onToggle();
        }}
      />
      <ModeSegment
        label="보기"
        icon={<Eye className="h-3 w-3" />}
        active={!isEdit}
        activeBg="var(--surface-3)"
        activeText="var(--ink)"
        onClick={() => {
          if (isEdit) onToggle();
        }}
      />
    </div>
  );
}

function ModeSegment({
  label,
  icon,
  active,
  activeBg,
  activeText,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  // active 칸의 배경·글자색 — 편집은 파랑 accent, 보기는 모노톤(중립 surface).
  activeBg: string;
  activeText: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label} 모드`}
      title={`${label} 모드  ⌘⇧E`}
      leftIcon={icon}
      className="rounded px-1.5 py-0.5"
      style={{
        backgroundColor: active ? activeBg : "transparent",
        color: active ? activeText : "var(--faint)",
        cursor: active ? "default" : "pointer",
      }}
    />
  );
}
