import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RecordingEntry } from "../../api/recordings";
import { parseBase } from "../../lib/recordings/base";
import { mergeRecordings, type MemoRef } from "../../lib/recordings/merge";

const calls: string[] = [];
const toastShow = vi.fn();
const completeMock = vi.fn(async (_base: string) => {
  calls.push("complete");
  return {};
});
const linkMock = vi.fn(async (_vars: unknown) => {
  calls.push("link");
  return {};
});
let memos: MemoRef[] = [];

// DS Modal(Base UI)·SearchField 는 테스트 환경에서 DS 옆폴더의 react 를 불러 훅이 깨진다 → 열림이면 그대로 렌더.
vi.mock("@goodsoob/ds", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@goodsoob/ds")>();
  const Modal = ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null;
  const Slot = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  Modal.Header = Slot;
  Modal.Body = Slot;
  Modal.Footer = Slot;
  // SearchField 도 DS 쪽 lucide(react 2벌)를 써서 깨진다 → 평범한 input.
  const SearchField = ({ onClear: _c, ...rest }: import("@goodsoob/ds").SearchFieldProps) => <input {...rest} />;
  return { ...mod, Modal, SearchField, useToast: () => ({ show: toastShow }) };
});
vi.mock("../../hooks/useMeetings", () => ({
  useMeetings: () => ({ data: memos }),
}));
vi.mock("../../hooks/useRecordings", () => ({
  useLinkRecording: () => ({ link: linkMock, isPending: false }),
  useCompleteRecording: () => ({ mutateAsync: completeMock, isPending: false }),
}));

import { SEND_NOTICE, SendToMemoDialog } from "./SendToMemoDialog";

const NO_STT = { done: true, moved: false, rawPromoted: false, anchored: false, diarized: false, reviewLeft: 0 };
const BASE = "20261105-1540";

function makeItem(over: Partial<RecordingEntry> = {}) {
  const e: RecordingEntry = {
    base: BASE,
    parsed: parseBase(BASE),
    hasM4a: true,
    hasTxt: false,
    stt: { ...NO_STT },
    job: null,
    durationSec: 600,
    creationTime: null,
    syncPending: false,
    firstLine: null,
    ...over,
    ...(over.stt ? { stt: { ...NO_STT, ...over.stt } } : {}),
  };
  return mergeRecordings([e], [], [])[0];
}

const correction = () => makeItem({ stt: { ...NO_STT, diarized: true } });
const corrected = () => makeItem({ hasTxt: true });

function renderDialog(item = correction(), over: Partial<Parameters<typeof SendToMemoDialog>[0]> = {}) {
  const props = {
    item,
    open: true,
    onClose: vi.fn(),
    remaining: 0,
    flush: vi.fn(async () => {
      calls.push("flush");
      return true;
    }),
    onSent: vi.fn(),
    ...over,
  };
  render(<SendToMemoDialog {...props} />);
  return props;
}

beforeEach(() => {
  calls.length = 0;
  toastShow.mockClear();
  completeMock.mockClear();
  linkMock.mockClear();
  memos = [{ id: "inbox/회의.md", uid: "u1", title: "주간 회의", date: "2026-11-05", mtime: 0, audio: [] }];
});
afterEach(cleanup);

describe("SendToMemoDialog", () => {
  it("고정 안내 + 남은 고칠 곳 문구", () => {
    renderDialog(correction(), { remaining: 4 });
    expect(screen.getByTestId("send-notice").textContent).toBe(`${SEND_NOTICE} 남은 고칠 곳 4개는 그대로 둡니다.`);
  });

  it("correction: flush → complete → link 순서로 부르고 onSent", async () => {
    const p = renderDialog(correction());
    fireEvent.click(screen.getByRole("button", { name: /주간 회의/ }));
    await waitFor(() => expect(p.onSent).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(["flush", "complete", "link"]);
    expect(completeMock).toHaveBeenCalledWith(BASE);
    expect(linkMock).toHaveBeenCalledWith({ base: BASE, memoUid: "u1" });
  });

  it("corrected: complete 를 건너뛴다", async () => {
    const p = renderDialog(corrected());
    fireEvent.click(screen.getByRole("button", { name: /주간 회의/ }));
    await waitFor(() => expect(p.onSent).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(["flush", "link"]);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("link 실패: 창은 열린 채 에러 토스트, 다시 누르면 complete 없이 link 만", async () => {
    linkMock.mockImplementationOnce(async () => {
      calls.push("link");
      throw Object.assign(new Error("x"), { code: "busy" });
    });
    const p = renderDialog(correction());
    fireEvent.click(screen.getByRole("button", { name: /주간 회의/ }));
    await waitFor(() => expect(toastShow).toHaveBeenCalled());
    expect(toastShow.mock.calls[0][1]).toEqual({ variant: "down" });
    expect(p.onSent).not.toHaveBeenCalled();
    expect(p.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();

    calls.length = 0;
    await waitFor(() => expect(screen.getByRole("button", { name: /주간 회의/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /주간 회의/ }));
    await waitFor(() => expect(p.onSent).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(["flush", "link"]);
  });

  it("flush 실패면 complete·link 를 부르지 않는다", async () => {
    renderDialog(correction(), { flush: vi.fn(async () => false) });
    fireEvent.click(screen.getByRole("button", { name: /주간 회의/ }));
    await waitFor(() => expect(completeMock).not.toHaveBeenCalled());
    expect(linkMock).not.toHaveBeenCalled();
  });

  it("새 메모: 펼치면 primary 새 메모로 보내기", async () => {
    const p = renderDialog(corrected());
    fireEvent.click(screen.getByRole("button", { name: "새 메모" }));
    fireEvent.change(screen.getByPlaceholderText("제목을 입력하세요"), { target: { value: "새 회의" } });
    fireEvent.click(screen.getByRole("button", { name: "새 메모로 보내기" }));
    await waitFor(() => expect(p.onSent).toHaveBeenCalledTimes(1));
    expect(linkMock).toHaveBeenCalledWith({ base: BASE, newMemo: { title: "새 회의", folder: "inbox" } });
  });
});
