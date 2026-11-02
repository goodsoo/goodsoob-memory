import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

import { TranscriptTurns } from "./TranscriptTurns";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const T = "[00:00] 화자1: 잘 들려요?\n\n[00:18] 화자0: 네 화면으로 띄우겠습니다.\n\n[00:28] 화자1: 계시나요?\n";

describe("TranscriptTurns", () => {
  it("참석자 줄 + 턴 렌더", () => {
    const { container } = render(<TranscriptTurns text={T} />);
    expect(screen.getByText("참석자 2명")).toBeTruthy();
    expect(container.querySelectorAll("[data-turn-index]")).toHaveLength(3);
    expect(screen.getByText("네 화면으로 띄우겠습니다.")).toBeTruthy();
  });

  it("발화 클릭 → 편집 → Enter 확정 시 직렬화 텍스트로 onChange", () => {
    const onChange = vi.fn();
    render(<TranscriptTurns text={T} onChange={onChange} />);
    fireEvent.click(screen.getByText("네 화면으로 띄우겠습니다."));
    const ta = screen.getByLabelText("화자0 00:18 발화 편집") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "네 화면 띄우겠습니다." } });
    fireEvent.keyDown(ta, { key: "Enter" });
    fireEvent.blur(ta);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe(T.replace("네 화면으로 띄우겠습니다.", "네 화면 띄우겠습니다."));
  });

  it("Esc 는 취소 — onChange 없음", () => {
    const onChange = vi.fn();
    render(<TranscriptTurns text={T} onChange={onChange} />);
    fireEvent.click(screen.getByText("계시나요?"));
    const ta = screen.getByLabelText("화자1 00:28 발화 편집");
    fireEvent.change(ta, { target: { value: "바꿈" } });
    fireEvent.keyDown(ta, { key: "Escape" });
    fireEvent.blur(ta);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("계시나요?")).toBeTruthy();
  });

  it("참석자 이름 클릭 → 이름 변경 → 전체 치환", () => {
    const onChange = vi.fn();
    render(<TranscriptTurns text={T} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "화자1 이름 변경" }));
    const input = screen.getByRole("textbox", { name: "화자1 이름 변경" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "정진용" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(T.replaceAll("화자1:", "정진용:"));
  });

  it("readOnly — 편집 진입 없음", () => {
    const onChange = vi.fn();
    render(<TranscriptTurns text={T} onChange={onChange} readOnly />);
    fireEvent.click(screen.getByText("계시나요?"));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "화자1 이름 변경" })).toBeNull();
  });

  it("plain — renderPlain 우선, 없으면 편집 가능 textarea", () => {
    const { rerender } = render(
      <TranscriptTurns text="그냥 메모" renderPlain={() => <p>평문뷰</p>} />,
    );
    expect(screen.getByText("평문뷰")).toBeTruthy();
    const onChange = vi.fn();
    rerender(<TranscriptTurns text="그냥 메모" onChange={onChange} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("그냥 메모");
    fireEvent.change(ta, { target: { value: "그냥 메모2" } });
    expect(onChange).toHaveBeenCalledWith("그냥 메모2");
  });

  it("하이라이트 클릭 → onHighlightClick, 편집 진입 안 함", () => {
    const onHl = vi.fn();
    const { container } = render(
      <TranscriptTurns
        text={T}
        onChange={() => {}}
        highlights={[{ turnIndex: 1, start: 2, end: 6, id: "h1", kind: "A" }]}
        onHighlightClick={onHl}
      />,
    );
    const mark = container.querySelector('[data-highlight-id="h1"]') as HTMLElement;
    expect(mark.textContent).toBe("화면으로");
    fireEvent.click(mark);
    expect(onHl).toHaveBeenCalledWith("h1");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("시각 클릭 → onSeek(sec, 섹션 base)", () => {
    const B = "20261029-1346";
    const onSeek = vi.fn();
    render(
      <TranscriptTurns text={`머리말\n\n## 오후 1:46 · ${B}\n\n${T}`} audioBases={[B]} onSeek={onSeek} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "00:18 부터 듣기" }));
    expect(onSeek).toHaveBeenCalledWith(18, B);
  });

  it("onSeek 없으면 섹션 플레이어를 연다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 206 })));
    const B = "20261029-1346";
    const { container } = render(
      <TranscriptTurns text={`## 오후 1:46 · ${B}\n\n${T}`} audioBases={[B]} />,
    );
    expect(screen.getByLabelText(`${B} 녹음 재생`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "00:18 부터 듣기" }));
    await waitFor(() => expect(container.querySelector("audio")).not.toBeNull());
  });
});
