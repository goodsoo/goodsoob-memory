import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import { TranscriptView } from "./TranscriptView";
import { matchHeadingBase } from "../../lib/recordings/turns";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const B1 = "20260826_카페미팅_정진용-공경철";
const B2 = "20260901 회의 a-b";

describe("matchHeadingBase", () => {
  it("exact match only", () => {
    expect(matchHeadingBase(`## 오후 2:00 · ${B1}`, [B1, B2])).toBe(B1);
    expect(matchHeadingBase(`## 오후 2:00 · ${B2}`, [B1, B2])).toBe(B2);
    expect(matchHeadingBase("## 사용자 소제목", [B1])).toBeNull();
    expect(matchHeadingBase("## x · other", [B1])).toBeNull();
    expect(matchHeadingBase(`### x · ${B1}`, [B1])).toBeNull();
  });
});

describe("TranscriptView", () => {
  it("renders play button only for audio headings", () => {
    const t = `머리말\n## 오후 2:00 · ${B1}\n김: 안녕\n## 내 소제목\n본문\n## 오후 3:00 · ${B2}\n끝\n`;
    render(<TranscriptView transcript={t} attendees="" audio={[B1, B2]} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    const link = screen.getByText(B1) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(`#recording-${encodeURIComponent(B1)}`);
  });

  it("text without matching headings is unchanged", () => {
    const t = "## 소제목\n김철: 1:23 안녕\n둘째 줄\n";
    const { container, rerender } = render(<TranscriptView transcript={t} attendees="김철" />);
    expect(container.textContent).toBe(t);
    rerender(<TranscriptView transcript={t} attendees="김철" audio={[B1]} />);
    expect(container.textContent).toBe(t);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("keeps timestamp chips inside sections", () => {
    const t = `## 2:00 · ${B1}\n0:05 안녕\n`;
    const { container } = render(<TranscriptView transcript={t} attendees="" audio={[B1]} />);
    expect(container.textContent).toContain("0:05 안녕");
    expect(container.querySelectorAll(".font-mono").length).toBeGreaterThan(0);
  });

  it("opens one player at a time; 404 shows missing", async () => {
    const f = vi.fn(
      async (u: string) =>
        new Response(null, { status: u.includes(encodeURIComponent(B2)) ? 404 : 206 }),
    );
    vi.stubGlobal("fetch", f);
    const t = `## a · ${B1}\nx\n## b · ${B2}\ny\n`;
    const { container } = render(<TranscriptView transcript={t} attendees="" audio={[B1, B2]} />);
    fireEvent.click(screen.getByLabelText(`${B1} 녹음 재생`));
    await waitFor(() => expect(container.querySelector("audio")).not.toBeNull());
    fireEvent.click(screen.getByLabelText(`${B2} 녹음 재생`));
    await waitFor(() => expect(screen.getByText("녹음 파일 없음")).toBeTruthy());
    expect(container.querySelector("audio")).toBeNull();
    expect(container.querySelectorAll("[data-testid=section-audio]")).toHaveLength(1);
  });

  it("503 shows sync pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    render(<TranscriptView transcript={`## a · ${B1}\nx\n`} attendees="" audio={[B1]} />);
    fireEvent.click(screen.getByLabelText(`${B1} 녹음 재생`));
    await waitFor(() => expect(screen.getByText(/동기화 대기 중/)).toBeTruthy());
  });
});
