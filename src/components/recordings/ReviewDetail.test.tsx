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
    expect(screen.getByText("잘못 들은 말 · 확신 높음")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "바꾸기" }));
    fireEvent.click(screen.getByRole("button", { name: "그대로 두기" }));
    fireEvent.click(screen.getByRole("button", { name: "직접 고치기" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("제안이 없으면 바꾸기 없음", () => {
    render(
      <ReviewDetail highlight={hl({ replacement: null })} busy={false} onAccept={() => {}} onKeep={() => {}} onEdit={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "바꾸기" })).toBeNull();
    // 바꿀 말이 없으면 원문에 취소선을 긋지 않는다.
    expect(screen.getByText("생막보다").style.textDecoration).toBe("");
  });

  it("C 종류만 이름 누르기 안내 + 새 종류 라벨", () => {
    const { rerender } = render(
      <ReviewDetail highlight={hl()} busy={false} onAccept={() => {}} onKeep={() => {}} onEdit={() => {}} />,
    );
    expect(screen.queryByText("문단 위 이름을 눌러 말한 사람을 바꿉니다.")).toBeNull();
    rerender(
      <ReviewDetail
        highlight={hl({ item: { ...hl().item, type: "C" } })}
        busy={false}
        onAccept={() => {}}
        onKeep={() => {}}
        onEdit={() => {}}
      />,
    );
    expect(screen.getByText("문단 위 이름을 눌러 말한 사람을 바꿉니다.")).toBeTruthy();
    expect(screen.getByText(/말한 사람이 틀림/)).toBeTruthy();
  });

  it("확신도 '-'(미기재)는 숨김", () => {
    render(
      <ReviewDetail
        highlight={hl({ item: { ...hl().item, type: "B", conf: "-" } })}
        busy={false}
        onAccept={() => {}}
        onKeep={() => {}}
        onEdit={() => {}}
      />,
    );
    expect(screen.queryByText(/확신/)).toBeNull();
  });
});
