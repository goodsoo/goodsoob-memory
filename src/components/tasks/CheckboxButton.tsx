// 체크박스 button — pending / done / cancelled 3 state. pending 은 회색 테두리
// (--faint). done/cancelled 는 완료/취소가 의미 우선. e.stopPropagation 내장
// — 부모 행의 click navigate 와 충돌 없음.
// hit zone: 시각은 18x18 이지만 button 자체는 p-1.5 + -m-1.5 로 30x30 클릭 영역.
// negative margin 으로 layout footprint 는 18x18 유지 → 행 높이/간격 변동 0,
// 부모 click (행 edit/navigate) 보다 먼저 catch 되어 오작동 차단.
export function CheckboxButton({
  status,
  shape = "square",
  onClick,
}: {
  status: "pending" | "done" | "cancelled";
  // 루틴 row 에서는 "circle" — 원형 체크박스. 태스크는 default "square".
  // 같은 사이드바에 두 종류가 섞일 때 시각으로만 type 구분 가능 (라벨 X).
  shape?: "square" | "circle";
  onClick: () => void;
}) {
  const pendingBorder = "var(--faint)";
  const pendingFill = "transparent";
  return (
    <button
      type="button"
      aria-label={
        status === "cancelled"
          ? "취소 해제"
          : status === "done"
            ? "완료 취소"
            : "완료"
      }
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="group/check -m-1.5 flex shrink-0 items-center justify-center p-1.5"
    >
      <span
        aria-hidden
        className={`flex h-[18px] w-[18px] items-center justify-center border transition ${
          shape === "circle" ? "rounded-full" : "rounded-md"
        } ${
          status === "done"
            ? "bg-[var(--sub)]"
            : status === "cancelled"
              ? "border-[var(--line)] bg-[var(--surface)]"
              : "group-hover/check:brightness-95"
        }`}
        style={{
          minHeight: 18,
          minWidth: 18,
          borderColor:
            status === "pending"
              ? pendingBorder
              : status === "done"
                ? "var(--sub)"
                : undefined,
          borderWidth: status === "pending" ? 1.5 : undefined,
          backgroundColor: status === "pending" ? pendingFill : undefined,
        }}
      >
        {status === "done" ? (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className="h-3 w-3"
          style={{ color: "var(--text-inverse)" }}
          aria-hidden
        >
          <path
            d="M3 8l3 3 7-7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : status === "cancelled" ? (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className="h-3 w-3"
          style={{ color: "var(--faint)" }}
          aria-hidden
        >
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className="h-3 w-3 opacity-0 transition-opacity group-hover/check:opacity-50"
          style={{ color: "var(--ink)" }}
          aria-hidden
        >
          <path
            d="M3 8l3 3 7-7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      </span>
    </button>
  );
}
