import { describe, expect, it } from "vitest";
import { findInTranscript, replaceAll, replaceOne } from "./find";
import { parseTranscript, serializeTranscript, turnsOf } from "./turns";

const SRC = [
  "[00:01] 민수: Hello hello 안녕",
  "",
  "[00:10] 지영: HELLO 세계, hello",
  "",
].join("\n");

function texts(src: string) {
  return turnsOf(parseTranscript(src)).map((t) => t.text);
}

describe("findInTranscript", () => {
  const p = parseTranscript(SRC);
  it("대소문자 무시", () => {
    const m = findInTranscript(p, "hello", false);
    expect(m.map((x) => [x.turnIndex, x.start])).toEqual([
      [0, 0],
      [0, 6],
      [1, 0],
      [1, 10],
    ]);
    expect(m[0].end).toBe(5);
  });
  it("대소문자 구분", () => {
    const m = findInTranscript(p, "hello", true);
    expect(m.map((x) => [x.turnIndex, x.start])).toEqual([
      [0, 6],
      [1, 10],
    ]);
  });
  it("빈 검색어·없는 검색어", () => {
    expect(findInTranscript(p, "", false)).toEqual([]);
    expect(findInTranscript(p, "없음", false)).toEqual([]);
  });
  it("겹치지 않게 센다", () => {
    const q = parseTranscript("[00:01] 민수: aaaa\n\n[00:05] 지영: b\n");
    expect(findInTranscript(q, "aa", true)).toHaveLength(2);
  });
});

describe("replaceOne", () => {
  it("한 곳만 바꾼다", () => {
    const p = parseTranscript(SRC);
    const m = findInTranscript(p, "hello", true)[0];
    const out = replaceOne(p, m, "안녕하세요");
    expect(texts(serializeTranscript(out))).toEqual(["Hello 안녕하세요 안녕", "HELLO 세계, hello"]);
  });
  it("범위가 어긋나면 원본", () => {
    const p = parseTranscript(SRC);
    expect(replaceOne(p, { turnIndex: 9, start: 0, end: 1 }, "x")).toBe(p);
    expect(replaceOne(p, { turnIndex: 0, start: 0, end: 999 }, "x")).toBe(p);
  });
});

describe("replaceAll", () => {
  it("대소문자 무시로 전부 바꾼다", () => {
    const out = replaceAll(parseTranscript(SRC), "hello", "하이", false);
    expect(texts(serializeTranscript(out))).toEqual(["하이 하이 안녕", "하이 세계, 하이"]);
  });
  it("대소문자 구분", () => {
    const out = replaceAll(parseTranscript(SRC), "hello", "하이", true);
    expect(texts(serializeTranscript(out))).toEqual(["Hello 하이 안녕", "HELLO 세계, 하이"]);
  });
  it("왕복: 바꿨다가 되돌리면 원문", () => {
    const p = parseTranscript(SRC);
    const there = replaceAll(p, "세계", "월드", true);
    const back = replaceAll(there, "월드", "세계", true);
    expect(serializeTranscript(back)).toBe(SRC);
  });
  it("일치가 없으면 같은 객체", () => {
    const p = parseTranscript(SRC);
    expect(replaceAll(p, "zzz", "x", true)).toBe(p);
  });
});
