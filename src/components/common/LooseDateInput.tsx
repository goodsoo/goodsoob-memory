import { CommittedInput, type CommittedArrowStep } from "@goodsoob/ds";
import {
  parseLooseDate,
  stepDateSegment,
  todayIso,
  weekdayShort,
  type DateSegment,
} from "../../lib/dates";

// 캐럿 위치 → yyyy-mm-dd 의 어느 구간인가. 0-4 년, 5-7 월, 그 외 일.
function dateSegmentAt(caret: number): DateSegment {
  if (caret <= 4) return "year";
  if (caret <= 7) return "month";
  return "day";
}

type Props = {
  value: string;
  onCommit: (next: string) => void;
  fullWidth?: boolean;
  // task 카드 같은 좁은 메타 row 용 — text-xs.
  compact?: boolean;
  // 비어있을 때 포커스하면 오늘 날짜로 시드. 빈 채로 두면 "날짜 없음", 클릭하면
  // 오늘부터 편집 시작하게 하는 빠른 추가 입력용(opt-in — 종료일 등엔 영향 없음).
  seedTodayOnFocus?: boolean;
};

// 너그러운 날짜 input. 상태머신(draft/focus/commit·Enter-blur·Esc-revert·↑↓
// segment step·caret 복원)은 DS CommittedInput 에 위임하고, 날짜 도메인 로직
// (parseLooseDate·요일 suffix·구간 판정+증감·오늘 seed)만 app-glue 로 주입한다.
// borderless variant — 이전 border-0 bg-transparent inline 편집 chrome 재사용.
export function LooseDateInput({
  value,
  onCommit,
  fullWidth = false,
  compact = false,
  seedTodayOnFocus = false,
}: Props) {
  // blur 상태 + 유효 ISO + 요일 있으면 " (요일)" 합쳐 표시. focus 중엔 ISO 원문.
  function format(v: string): string {
    const wd = weekdayShort(value);
    return v && wd ? `${v} (${wd})` : v;
  }

  // ↑↓ — 캐럿이 놓인 구간(년/월/일)만 ±1. 값이 비어 파싱 불가면 첫 ↑↓ 는 오늘로
  // seed(증감 없이). 같은 구간 끝으로 caret 복원.
  function onArrowStep(direction: 1 | -1, caret: number): CommittedArrowStep | null {
    const seed = parseLooseDate(value);
    if (!seed) return { next: todayIso() };
    const segment = dateSegmentAt(caret);
    const next = stepDateSegment(seed, segment, direction);
    const pos = segment === "year" ? 4 : segment === "month" ? 7 : 10;
    return { next, caret: pos };
  }

  // ch unit ≈ 영문 0 width. text-xs 의 ch 가 약간 넉넉해서 한글 1자(`(일)` 같은)
  // 도 추가 보정 없이 display.length 만으로 fit. 보정 더하면 우측 큰 패딩 생김.
  const displayLen = format(value).length;
  const widthCh = Math.max(displayLen, 10);

  return (
    <CommittedInput
      variant="borderless"
      value={value}
      onCommit={onCommit}
      parse={(raw) => parseLooseDate(raw)}
      format={format}
      onArrowStep={onArrowStep}
      onFocus={() => {
        // 비어있을 때 클릭하면 오늘 날짜로 시드 — 거기서부터 편집. 안 건드리면
        // 빈 채로 남아 "날짜 없음".
        if (seedTodayOnFocus && value.trim() === "") {
          onCommit(todayIso());
        }
      }}
      placeholder="yyyy-mm-dd"
      maxLength={10}
      className={`leading-none ${compact ? "text-xs" : "text-sm"}`}
      style={{
        color: "var(--ink)",
        width: fullWidth ? "100%" : `${widthCh}ch`,
      }}
    />
  );
}
