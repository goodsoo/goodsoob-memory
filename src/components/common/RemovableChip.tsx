import type { ReactNode } from "react";
import { X } from "lucide-react";

// 입력 폼 안의 chip — 참석자 / 태그 등 사용자가 박은 값. SelectableChip 와는 다르게
// 토글이 아니라 단순 remove (우측 정사각형 X 버튼). MetaRow 안 textarea 비슷한
// 높이로 맞춰서 다른 input row (날짜/시간) 와 baseline 자연스럽게 정렬.
//   - 높이: 1.25rem (20px) 고정. icon-button 정사각형과 같음.
//   - 글자: 11px (한글 10px 가독성 낮음)
//   - X 버튼: 1rem 정사각형, icon 0.625rem (10px). hover 시 bg-surface 어두워짐.

type Props = {
  children: ReactNode;
  onRemove: () => void;
  ariaLabel?: string;
};

export function RemovableChip({ children, onRemove, ariaLabel }: Props) {
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded pl-1.5 pr-0.5 text-[12px] leading-none"
      style={{
        backgroundColor: "var(--surface-2)",
        color: "var(--ink)",
      }}
    >
      <span className="whitespace-nowrap">{children}</span>
      <button
        type="button"
        // input 의 onBlur 가 먼저 발사되면 typing 중인 draft 가 chip 으로 commit 됨.
        // mousedown 으로 prevent + 직접 remove.
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove();
        }}
        aria-label={ariaLabel}
        // hover/hit 영역을 보이는 icon 크기와 같게 — 박스 12px, icon 10px (살짝 inset).
        className="inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-[var(--surface-3)]"
        style={{ color: "var(--faint)" }}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}
