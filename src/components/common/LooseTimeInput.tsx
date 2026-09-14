import { useEffect, useRef, useState } from "react";
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

// 너그러운 시간 input. blur/Enter 시 parseLooseTime → HH:mm 정규화.
// 파싱 실패 시 이전 값으로 revert.
export function LooseTimeInput({
  value,
  onCommit,
  fullWidth = false,
  compact = false,
}: Props) {
  const [draft, setDraft] = useState(value);
  const skipCommitRef = useRef(false);
  useEffect(() => {
    // 외부에서 value 바뀌면 draft 동기화. 의도된 sync 패턴.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(value);
  }, [value]);

  function commit() {
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      return;
    }
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (value !== "") onCommit("");
      return;
    }
    if (trimmed === value) return;
    const hhmm = parseLooseTime(trimmed);
    if (hhmm) {
      setDraft(hhmm);
      if (hhmm !== value) onCommit(hhmm);
    } else {
      setDraft(value);
    }
  }

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          skipCommitRef.current = true;
          setDraft(value);
          e.currentTarget.blur();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          // 캐럿이 놓인 구간(시/분)만 ±1. native time input 과 동일.
          e.preventDefault();
          const input = e.currentTarget;
          const caret = input.selectionStart ?? draft.length;
          // 값이 비어 파싱 불가면 첫 ↑↓ 는 00:00 으로 seed (증감 없이).
          const seed = parseLooseTime(draft.trim()) || parseLooseTime(value);
          if (!seed) {
            setDraft("00:00");
            if (value !== "00:00") onCommit("00:00");
            return;
          }
          const segment = timeSegmentAt(caret);
          const next = stepTimeSegment(seed, segment, e.key === "ArrowUp" ? 1 : -1);
          setDraft(next);
          if (next !== value) onCommit(next);
          // 같은 구간 끝으로 캐럿 복원 (re-render 후).
          const pos = segment === "hour" ? 2 : 5;
          requestAnimationFrame(() => input.setSelectionRange(pos, pos));
        }
      }}
      placeholder="hh:mm"
      maxLength={11}
      className={`m-0 appearance-none border-0 bg-transparent p-0 leading-none outline-none ${compact ? "text-xs" : "text-sm"}`}
      style={{
        color: "var(--ink)",
        width: fullWidth ? "100%" : `${Math.max(draft.length, 5)}ch`,
      }}
    />
  );
}
