import { describe, it, expect } from "vitest";

import {
  parseTranscript,
  renameSpeaker,
  serializeTranscript,
  speakersInOrder,
  turnsOf,
  updateTurnText,
  timeToSec,
} from "./turns";
import { BRACKET_SAMPLE, TIMELINE_SAMPLE } from "./__fixtures__/transcripts";

const roundTrip = (t: string, bases?: string[]) =>
  serializeTranscript(parseTranscript(t, bases));

describe("parseTranscript — 실측 형식", () => {
  it("bracket (화자분리.txt) 왕복 바이트 동일", () => {
    const p = parseTranscript(BRACKET_SAMPLE);
    expect(p.format).toBe("bracket");
    const turns = turnsOf(p);
    expect(turns.length).toBeGreaterThan(5);
    expect(turns[0]).toMatchObject({ time: "00:00", timeSec: 0, speaker: "화자1" });
    expect(turns[1]).toMatchObject({ time: "00:18", timeSec: 18, speaker: "화자0" });
    // 발화 안의 `정진용 교수:` 는 화자가 아니라 본문
    expect(turns.find((t) => t.text.startsWith("정진용 교수:"))).toBeTruthy();
    expect(serializeTranscript(p)).toBe(BRACKET_SAMPLE);
  });

  it("timeline (옛 사이드카) 왕복 바이트 동일 — 줄 끝 공백·끝 빈 줄 포함", () => {
    const p = parseTranscript(TIMELINE_SAMPLE);
    expect(p.format).toBe("timeline");
    const turns = turnsOf(p);
    expect(turns[0]).toMatchObject({ time: "00:00", speaker: "함창수" });
    expect(turns[1]).toMatchObject({ time: "00:04", timeSec: 4, speaker: "정진용교수님" });
    expect(turns[1].text).toBe("있다가 ");
    expect(serializeTranscript(p)).toBe(TIMELINE_SAMPLE);
  });

  it("머리말 + 녹음 섹션 헤딩 + 혼합 형식 왕복", () => {
    const B = "20261029-1346";
    const t =
      "\n\n자유 머리말 첫 줄\n둘째 줄\n\n00:01 김\n안녕\n\n00:05 이\n네\n\n" +
      `## 오후 1:46 · ${B}\n\n[00:00] 화자0: 첫 발화\n\n[00:10] 화자1: 둘째\n이어진 줄\n\n## 내 소제목\n메모`;
    const p = parseTranscript(t, [B]);
    expect(p.lead).toBe("\n\n");
    expect(p.blocks[0]).toMatchObject({ kind: "text", raw: "자유 머리말 첫 줄\n둘째 줄" });
    const heads = p.blocks.filter((b) => b.kind === "heading");
    expect(heads[0]).toMatchObject({ base: B });
    expect(heads[1]).toMatchObject({ raw: "## 내 소제목" });
    expect(heads[1]).not.toHaveProperty("base");
    expect(turnsOf(p).map((x) => x.style)).toEqual(["timeline", "timeline", "bracket", "bracket"]);
    expect(turnsOf(p)[3].text).toBe("둘째\n이어진 줄");
    expect(serializeTranscript(p)).toBe(t);
  });

  it("CRLF 도 왕복 보존", () => {
    const t = "[00:01] A: 하나\r\n\r\n[00:02] B: 둘\r\n";
    expect(roundTrip(t)).toBe(t);
  });

  it("plain — 턴이 2개 미만이면 plain, 원문 그대로", () => {
    for (const t of ["", "그냥 메모\n둘째 줄\n", "1:23 안녕\n다음 줄\n", "## 소제목\n김철: 안녕\n"]) {
      const p = parseTranscript(t);
      expect(p.format).toBe("plain");
      expect(serializeTranscript(p)).toBe(t);
    }
  });

  it("timeToSec", () => {
    expect(timeToSec("01:05")).toBe(65);
    expect(timeToSec("1:02:03")).toBe(3723);
  });
});

describe("편집 헬퍼", () => {
  it("speakersInOrder — 첫 등장 순", () => {
    expect(speakersInOrder(parseTranscript(BRACKET_SAMPLE))).toEqual(["화자1", "화자0"]);
  });

  it("renameSpeaker — 그 화자 전체, 형식 유지", () => {
    const p = renameSpeaker(parseTranscript(BRACKET_SAMPLE), "화자1", "정진용");
    const out = serializeTranscript(p);
    expect(out).not.toContain("] 화자1:");
    expect(out).toContain("[00:00] 정진용: 잘 들려요?");
    expect(speakersInOrder(parseTranscript(out))).toEqual(["정진용", "화자0"]);

    const tl = serializeTranscript(renameSpeaker(parseTranscript(TIMELINE_SAMPLE), "함창수", "창수"));
    expect(tl.startsWith("00:00 창수\n있는 곳마다")).toBe(true);
  });

  it("renameSpeaker — 빈 이름·콜론·줄바꿈은 무시", () => {
    const p = parseTranscript(BRACKET_SAMPLE);
    for (const bad of ["", "  ", "a: b", "x\ny"]) expect(renameSpeaker(p, "화자1", bad)).toBe(p);
  });

  it("updateTurnText — 그 턴만, 빈 줄 접고 trim", () => {
    const p = parseTranscript(BRACKET_SAMPLE);
    const out = serializeTranscript(updateTurnText(p, 1, "  고친 발화\n\n\n다음 줄 "));
    const lines = out.split("\n");
    expect(lines[2]).toBe("[00:18] 화자0: 고친 발화");
    expect(lines[3]).toBe("다음 줄");
    // 나머지는 원문 그대로
    expect(out.slice(out.indexOf("[00:28]"))).toBe(BRACKET_SAMPLE.slice(BRACKET_SAMPLE.indexOf("[00:28]")));
    // 재파싱해도 턴 수 동일
    expect(turnsOf(parseTranscript(out)).length).toBe(turnsOf(p).length);
  });

  it("updateTurnText — timeline 형식 유지", () => {
    const p = parseTranscript(TIMELINE_SAMPLE);
    const out = serializeTranscript(updateTurnText(p, 1, "있다가요"));
    expect(out).toContain("00:04 정진용교수님\n있다가요\n\n00:04 함창수");
  });

  it("updateTurnText — 범위 밖 index 는 원본", () => {
    const p = parseTranscript(BRACKET_SAMPLE);
    expect(updateTurnText(p, 999, "x")).toBe(p);
  });
});
