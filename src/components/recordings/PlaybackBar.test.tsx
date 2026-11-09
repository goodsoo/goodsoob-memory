import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { PlaybackBar } from "./PlaybackBar";
import type { RecordingPlayer } from "../../hooks/useAudioPlayback";

// DS Dropdown(Base UI)은 테스트 환경에서 DS 옆폴더의 react 를 불러 훅이 깨진다(앱 번들은 dedupe 로 정상).
vi.mock("@goodsoob/ds", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@goodsoob/ds")>();
  return {
    ...mod,
    Dropdown: ({ trigger, items }: import("@goodsoob/ds").DropdownProps) => (
      <span>
        {trigger}
        {items
          ?.filter((it) => !it.separator)
          .map((it) => (
            <button key={it.key} type="button" data-menu-item onClick={it.onSelect}>
              {it.label}
            </button>
          ))}
      </span>
    ),
  };
});

afterEach(cleanup);

function fake(over: Partial<RecordingPlayer> = {}): RecordingPlayer {
  return {
    audioRef: createRef<HTMLAudioElement>(),
    audioProps: { src: "/x.m4a" },
    state: "ready",
    playing: false,
    currentSec: 83,
    durationSec: 547,
    rate: 1.25,
    retrying: false,
    toggle: vi.fn(),
    seek: vi.fn(),
    skip: vi.fn(),
    setRate: vi.fn(),
    cycleRate: vi.fn(),
    retry: vi.fn(),
    ...over,
  };
}

function setup(player: RecordingPlayer, following = true) {
  const onResumeFollow = vi.fn();
  const onOpenHelp = vi.fn();
  render(
    <PlaybackBar
      player={player}
      following={following}
      onResumeFollow={onResumeFollow}
      onOpenHelp={onOpenHelp}
    />,
  );
  return { onResumeFollow, onOpenHelp };
}

describe("PlaybackBar", () => {
  it("시간과 배속을 표시한다", () => {
    setup(fake());
    expect(screen.getByText("1:23 / 9:07")).toBeTruthy();
    expect(screen.getByRole("button", { name: "재생 속도" }).textContent).toContain("1.25배");
  });

  it("재생·뒤로·앞으로·단축키 버튼이 player 를 부른다", () => {
    const p = fake();
    const { onOpenHelp } = setup(p);
    fireEvent.click(screen.getByRole("button", { name: "재생" }));
    fireEvent.click(screen.getByRole("button", { name: "5초 뒤로" }));
    fireEvent.click(screen.getByRole("button", { name: "5초 앞으로" }));
    fireEvent.click(screen.getByRole("button", { name: "단축키" }));
    expect(p.toggle).toHaveBeenCalledTimes(1);
    expect(p.skip).toHaveBeenNthCalledWith(1, -5);
    expect(p.skip).toHaveBeenNthCalledWith(2, 5);
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
  });

  it("재생 중이면 일시정지 라벨", () => {
    setup(fake({ playing: true }));
    expect(screen.getByRole("button", { name: "일시정지" })).toBeTruthy();
  });

  it("위치 막대를 움직이면 seek", () => {
    const p = fake();
    setup(p);
    fireEvent.change(screen.getByLabelText("재생 위치"), { target: { value: "120" } });
    expect(p.seek).toHaveBeenCalledWith(120);
  });

  it("'현재 위치로' 는 following=false 일 때만", () => {
    const a = setup(fake(), true);
    expect(screen.queryByRole("button", { name: "현재 위치로" })).toBeNull();
    cleanup();
    const b = setup(fake(), false);
    fireEvent.click(screen.getByRole("button", { name: "현재 위치로" }));
    expect(b.onResumeFollow).toHaveBeenCalledTimes(1);
    expect(a.onResumeFollow).not.toHaveBeenCalled();
  });

  it("syncPending 은 문장 + 다시 시도", () => {
    const p = fake({ state: "syncPending" });
    setup(p);
    expect(screen.getByText(/iCloud 에서 받는 중/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(p.retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("재생 위치")).toBeNull();
  });

  it("missing 은 다시 시도 없음", () => {
    setup(fake({ state: "missing" }));
    expect(screen.getByText(/녹음 파일이 없습니다/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
  });
});
