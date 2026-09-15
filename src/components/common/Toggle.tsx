// on/off 토글 (switch). 디자인 토큰 기반, role="switch" + 키보드 접근성(Space/Enter).
//  - p-0.5 패딩이 knob 의 상하좌우 균등 gap 보장 → knob 은 패딩 안에서만 이동.
//  - on = btn-primary 트랙, off = border-default 트랙. knob 은 bg-surface + 그림자로
//    트랙 위 형태가 또렷.
//  - size: md (h-6 w-11, 기본) / sm (h-5 w-9).

type Size = "sm" | "md";

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  size?: Size;
  // 접근성 라벨 (보이는 라벨이 따로 있으면 생략 가능).
  ariaLabel?: string;
  title?: string;
  className?: string;
};

const SIZES: Record<Size, { track: string; knob: string; on: string }> = {
  sm: { track: "h-5 w-9", knob: "h-4 w-4", on: "translateX(1rem)" },
  md: { track: "h-6 w-11", knob: "h-5 w-5", on: "translateX(1.25rem)" },
};

export function Toggle({
  checked,
  onChange,
  disabled = false,
  size = "md",
  ariaLabel,
  title,
  className = "",
}: Props) {
  const s = SIZES[size];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      title={title}
      className={`inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${s.track} ${className}`}
      style={{ background: checked ? "var(--btn-primary)" : "var(--line)" }}
    >
      <span
        className={`shrink-0 rounded-full shadow-sm transition-transform ${s.knob}`}
        style={{
          background: "var(--surface)",
          transform: checked ? s.on : "translateX(0)",
        }}
      />
    </button>
  );
}
