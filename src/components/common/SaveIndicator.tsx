import { Loader2, Circle } from "lucide-react";
import { Button } from "./Button";

type Props = {
  // 저장 진행 중(typing~mutation). 호출자에서 (mutation isPending OR hasUnsavedChange) 등으로 전달.
  isPending: boolean;
  isError: boolean;
  // 있으면 error 상태에서 클릭 가능한 재시도 버튼. 없으면 표시만.
  onRetry?: () => void;
};

// 저장 상태 표시 — spinner(저장 중) ↔ 외곽선 원(저장됨·실패). 메모장·일기·빠른 캡처 공용.
// idle(아직 아무 변경 없음) 구분은 호출자가 담당(렌더 안 함). 깜빡임 회피로 debounce 없이
// typing 시점부터 spinner.
export function SaveIndicator({ isPending, isError, onRetry }: Props) {
  const state: "error" | "spinner" | "success" = isError
    ? "error"
    : isPending
      ? "spinner"
      : "success";

  const dotColor =
    state === "error" ? "var(--down)" : "var(--ok)";

  const title =
    state === "error"
      ? "저장 실패 — 재시도"
      : state === "spinner"
        ? "저장 중"
        : "저장됨";

  const inner = (
    <span
      className="relative inline-flex items-center justify-center"
      style={{ width: "0.875rem", height: "0.875rem" }}
    >
      {/* spinner — pending 일 때만 fade-in */}
      <Loader2
        className="absolute inset-0 h-3.5 w-3.5"
        style={{
          color: "var(--faint)",
          opacity: state === "spinner" ? 1 : 0,
          transition: "opacity 180ms ease",
          animation: "spin 1.6s linear infinite",
        }}
      />
      {/* 외곽선 원 (border only) — error / success, spinner 와 같은 stroke */}
      <Circle
        className="absolute inset-0 h-3.5 w-3.5"
        style={{
          color: dotColor,
          opacity: state === "spinner" ? 0 : 1,
          transform: state === "spinner" ? "scale(0.6)" : "scale(1)",
          transition:
            "opacity 180ms ease, color 180ms ease, transform 180ms ease",
        }}
      />
    </span>
  );

  if (state === "error" && onRetry) {
    return (
      <Button
        variant="icon"
        onClick={onRetry}
        title={title}
        aria-label={title}
        className="rounded p-1"
      >
        {inner}
      </Button>
    );
  }
  return (
    <span title={title} aria-label={title} className="inline-flex items-center p-1">
      {inner}
    </span>
  );
}
