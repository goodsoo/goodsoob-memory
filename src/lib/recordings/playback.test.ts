import { describe, expect, it } from "vitest";
import {
  RATES,
  activeTurnAt,
  formatPlayTime,
  nextRate,
  nextTurnTarget,
  prevTurnTarget,
} from "./playback";

const S = [5, 20, 40];

describe("nextRate", () => {
  it("한 단계씩 오르내린다", () => {
    expect(nextRate(1, 1)).toBe(1.25);
    expect(nextRate(1, -1)).toBe(0.75);
    expect(nextRate(1.5, 1)).toBe(1.75);
  });
  it("양 끝에서 고정", () => {
    expect(nextRate(2, 1)).toBe(2);
    expect(nextRate(0.75, -1)).toBe(0.75);
  });
  it("목록 밖 값은 가장 가까운 단계 기준", () => {
    expect(nextRate(1.1, 1)).toBe(1.25);
    expect(RATES).toContain(nextRate(3, -1));
  });
});

describe("activeTurnAt", () => {
  it("첫 문단 전 = -1", () => {
    expect(activeTurnAt(S, 0)).toBe(-1);
    expect(activeTurnAt(S, 4.99)).toBe(-1);
  });
  it("경계는 시작 시각 포함", () => {
    expect(activeTurnAt(S, 5)).toBe(0);
    expect(activeTurnAt(S, 19.9)).toBe(0);
    expect(activeTurnAt(S, 20)).toBe(1);
  });
  it("마지막 문단 뒤", () => {
    expect(activeTurnAt(S, 9999)).toBe(2);
  });
  it("빈 목록", () => {
    expect(activeTurnAt([], 10)).toBe(-1);
  });
});

describe("prevTurnTarget", () => {
  it("1.5초 넘게 지났으면 현재 문단 시작", () => {
    expect(prevTurnTarget(S, 21.6, 1)).toBe(20);
  });
  it("정확히 1.5초면 앞 문단", () => {
    expect(prevTurnTarget(S, 21.5, 1)).toBe(5);
  });
  it("1.5초 이내면 앞 문단", () => {
    expect(prevTurnTarget(S, 20.5, 1)).toBe(5);
  });
  it("첫 문단 초반이면 첫 문단 시작, 문단 전이면 0", () => {
    expect(prevTurnTarget(S, 5.5, 0)).toBe(5);
    expect(prevTurnTarget(S, 2, -1)).toBe(0);
    expect(prevTurnTarget([], 2, -1)).toBe(0);
  });
});

describe("nextTurnTarget", () => {
  it("다음 문단 시작", () => {
    expect(nextTurnTarget(S, 0)).toBe(20);
    expect(nextTurnTarget(S, -1)).toBe(5);
  });
  it("마지막 문단이면 null", () => {
    expect(nextTurnTarget(S, 2)).toBeNull();
    expect(nextTurnTarget([], -1)).toBeNull();
  });
});

describe("formatPlayTime", () => {
  it("m:ss / h:mm:ss", () => {
    expect(formatPlayTime(0)).toBe("0:00");
    expect(formatPlayTime(83.9)).toBe("1:23");
    expect(formatPlayTime(3599)).toBe("59:59");
    expect(formatPlayTime(3600)).toBe("1:00:00");
    expect(formatPlayTime(3723)).toBe("1:02:03");
  });
  it("비정상 값은 0:00", () => {
    expect(formatPlayTime(-3)).toBe("0:00");
    expect(formatPlayTime(NaN)).toBe("0:00");
  });
});
