import { describe, expect, it } from "vitest";
import { recordingErrorMessage } from "./recordingLabels";

describe("recordingErrorMessage", () => {
  const codes = ["rawReadonly", "linked", "conflict", "notCorrected", "syncPending", "noAudio"];
  for (const code of codes) {
    it(`${code} 는 서버 문구 대신 한국어 안내를 쓴다`, () => {
      const msg = recordingErrorMessage({ code, message: "server raw" });
      expect(msg).not.toBe("server raw");
      expect(msg).not.toContain("—");
    });
  }
  it("세부 문구", () => {
    expect(recordingErrorMessage({ code: "rawReadonly" })).toContain("말한 사람 나누기를 먼저");
    expect(recordingErrorMessage({ code: "syncPending" })).toContain("iCloud");
    expect(recordingErrorMessage({ code: "alreadyMoved" })).toContain("음성 기록이");
    expect(recordingErrorMessage({ code: "noTranscript" })).toContain("받아쓰기");
  });
  it("모르는 코드는 서버 메시지", () => {
    expect(recordingErrorMessage({ code: "zzz", message: "서버" })).toBe("서버");
  });
});
