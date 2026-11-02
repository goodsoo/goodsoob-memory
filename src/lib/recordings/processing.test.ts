import { describe, expect, it } from "vitest";
import {
  buildNames,
  diarizeEstimate,
  errorIsDiarize,
  failedChunksText,
  jobErrorText,
  processingErrorMessage,
  stepLabel,
  validateSpeakers,
} from "./processing";

describe("stepLabel / stepProgress", () => {
  it("maps known steps", () => {
    expect(stepLabel("diarize")).toBe("화자 나누는 중");
    expect(stepLabel("queued")).toBe("대기 중");
    expect(stepLabel("corrections 2/5")).toBe("교정 후보 만드는 중 (2/5)");
    expect(stepLabel("anchor")).toBe("교정 위치 찾는 중");
    expect(stepLabel("zzz")).toBe("처리 중");
    expect(stepLabel(undefined)).toBe("처리 중");
  });
});

describe("diarizeEstimate", () => {
  it("quarter of length", () => {
    expect(diarizeEstimate(3600)).toBe("1시간 녹음은 약 15분 걸립니다.");
    expect(diarizeEstimate(1800)).toBe("30분 녹음은 약 8분 걸립니다.");
    expect(diarizeEstimate(14400)).toBe("4시간 녹음은 약 1시간 걸립니다.");
  });
  it("null for unknown", () => {
    expect(diarizeEstimate(null)).toBeNull();
    expect(diarizeEstimate(0)).toBeNull();
  });
});

describe("validateSpeakers", () => {
  it("accepts 1..10", () => {
    expect(validateSpeakers("3")).toEqual({ ok: true, speakers: 3 });
    expect(validateSpeakers(" 10 ")).toEqual({ ok: true, speakers: 10 });
  });
  it("rejects others", () => {
    for (const v of ["", "0", "11", "2.5", "-1", "a"]) expect(validateSpeakers(v).ok).toBe(false);
  });
});

describe("buildNames", () => {
  it("undefined when all empty", () => {
    expect(buildNames(["", " "], 2)).toEqual({ ok: true, names: undefined });
  });
  it("trims trailing blanks", () => {
    expect(buildNames(["가", "나", ""], 3)).toEqual({ ok: true, names: ["가", "나"] });
  });
  it("rejects gap and long", () => {
    expect(buildNames(["가", "", "다"], 3).ok).toBe(false);
    expect(buildNames(["x".repeat(41)], 1).ok).toBe(false);
  });
  it("ignores inputs beyond speakers", () => {
    expect(buildNames(["가", "나"], 1)).toEqual({ ok: true, names: ["가"] });
  });
});

describe("messages", () => {
  it("maps codes", () => {
    expect(processingErrorMessage({ code: "notPro" })).toContain("Pro 맥에서만");
    for (const c of ["badSpeakers", "badNames", "noAudio", "notTranscribed", "notDiarized", "jobRunning", "busy", "noPartial", "spawnFailed"]) {
      expect(processingErrorMessage({ code: c })).not.toBe("");
    }
    expect(processingErrorMessage({ code: "x", message: "서버 메시지" })).toBe("서버 메시지");
  });
  it("interrupted", () => {
    expect(jobErrorText({ error: "interrupted" })).toContain("서버가 재시작된 것 같습니다");
    expect(jobErrorText({ error: "claude 실패" })).toContain("claude 실패");
  });
  it("failed chunks", () => {
    expect(failedChunksText([3, 5])).toContain("3, 5번");
    expect(failedChunksText([])).toBeNull();
  });
  it("errorIsDiarize", () => {
    expect(errorIsDiarize({ kind: "diarize" }, true)).toBe(true);
    expect(errorIsDiarize({ kind: "corrections" }, false)).toBe(false);
    expect(errorIsDiarize(null, false)).toBe(true);
  });
});
