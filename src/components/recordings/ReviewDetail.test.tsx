import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReviewDetail } from "./ReviewDetail";
import type { ReviewHighlight } from "../../lib/recordings/review";

afterEach(cleanup);

function hl(over: Partial<ReviewHighlight> = {}): ReviewHighlight {
  return {
    id: "1",
    turnIndex: 0,
    start: 0,
    end: 4,
    kind: "A",
    item: { id: 1, t: 0, type: "A", conf: "높음", orig: "생막보다 잘", sugg: "생각보다 잘", note: "문맥상" },
    needle: "생막보다",
    replacement: "생각보다",
    ...over,
  };
}

describe("ReviewDetail", () => {
  it("원문 → 제안 · 메모 · 확신도 + 세 액션", () => {
    const onAccept = vi.fn();
    const onKeep = vi.fn();
    const onEdit = vi.fn();
    render(<ReviewDetail highlight={hl()} busy={false} onAccept={onAccept} onKeep={onKeep} onEdit={onEdit} />);
    expect(screen.getByText("생막보다")).toBeTruthy();
    expect(screen.getByText("생각보다")).toBeTruthy();
    expect(screen.getByText("문맥상")).toBeTruthy();
    expect(screen.getByText("오인식 · 확신 높음")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "수락" }));
    fireEvent.click(screen.getByRole("button", { name: "원문 유지" }));
    fireEvent.click(screen.getByRole("button", { name: "직접 고침" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("제안이 없으면 수락 없음", () => {
    render(
      <ReviewDetail highlight={hl({ replacement: null })} busy={false} onAccept={() => {}} onKeep={() => {}} onEdit={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "수락" })).toBeNull();
  });
});
