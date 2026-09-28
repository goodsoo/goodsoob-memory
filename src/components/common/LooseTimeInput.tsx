import { CommittedInput, type CommittedArrowStep } from "@goodsoob/ds";
import { parseLooseTime, stepTimeSegment } from "../../lib/dates";

// 캐럿 위치 → HH:mm 의 어느 구간인가. 0-2 시, 그 외 분.
function timeSegmentAt(caret: number): "hour" | "minute" {
  return caret <= 2 ? "hour" : "minute";
}

type Props = {
  value: string;
  onCommit: (next: string) => void;
  fullWidth?: boolean;
  compact?: boolean;
};

// 너그러운 시간 input. 상태머신(draft/commit·Enter-blur·Esc-revert·↑↓ segment
// step·caret 복원)은 DS CommittedInput 에 위임하고, 시간 도메인 로직
// (parseLooseTime·시/분 구간 판정+증감·00:00 seed)만 app-glue 로 주입한다.
export function LooseTimeInput({
  value,
  onCommit,
  fullWidth = false,
  compact = false,
}: Props) {
  // ↑↓ — 캐럿이 놓인 구간(시/분)만 ±1. 값이 비어 파싱 불가면 첫 ↑↓ 는 00:00 으로
  // seed(증감 없이). 같은 구간 끝으로 caret 복원.
  function onArrowStep(direction: 1 | -1, caret: number): CommittedArrowStep | null {
    const seed = parseLooseTime(value);
    if (!seed) return { next: "00:00" };
    const segment = timeSegmentAt(caret);
    const next = stepTimeSegment(seed, segment, direction);
    const pos = segment === "hour" ? 2 : 5;
    return { next, caret: pos };
  }

  return (
    <CommittedInput
      variant="borderless"
      value={value}
      onCommit={onCommit}
      parse={(raw) => parseLooseTime(raw)}
      onArrowStep={onArrowStep}
      placeholder="hh:mm"
      maxLength={11}
      className={`leading-none ${compact ? "text-xs" : "text-sm"}`}
      style={{
        color: "var(--ink)",
        width: fullWidth ? "100%" : `${Math.max(value.length, 5)}ch`,
      }}
    />
  );
}
