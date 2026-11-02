import { describe, expect, it, vi } from "vitest";
import { flushMeetingDoc, registerDocFlush } from "./docReset";
import { formatClock, formatDuration, recordingErrorMessage } from "../recordings/recordingLabels";

describe("flushMeetingDoc", () => {
  it("등록자 없으면 no-op", () => {
    expect(() => flushMeetingDoc("nobody")).not.toThrow();
  });
  it("등록된 폼의 flush 를 동기로 부르고, 해제 후엔 안 부름", () => {
    const fn = vi.fn();
    const off = registerDocFlush("u1", fn);
    flushMeetingDoc("u1");
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    flushMeetingDoc("u1");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("옛 등록의 해제가 새 등록을 지우지 않음 (remount 순서)", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = registerDocFlush("u2", a);
    registerDocFlush("u2", b);
    offA();
    flushMeetingDoc("u2");
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });
});

describe("recording labels", () => {
  it("시간·길이 형식", () => {
    expect(formatClock("13:05")).toBe("오후 1:05");
    expect(formatClock("00:30")).toBe("오전 12:30");
    expect(formatDuration(45)).toBe("45초");
    expect(formatDuration(1920)).toBe("32분");
    expect(formatDuration(4320)).toBe("1시간 12분");
    expect(formatDuration(null)).toBe("");
  });
  it("409 code → 원인 + 해결", () => {
    expect(recordingErrorMessage({ code: "titleConflict" })).toContain("다른 제목");
    expect(recordingErrorMessage({ code: "x", message: "서버 문구" })).toBe("서버 문구");
  });
});
