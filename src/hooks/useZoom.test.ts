import { beforeEach, describe, expect, it } from "vitest";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  getZoom,
  resetZoom,
  setZoomFactor,
  zoomIn,
  zoomOut,
} from "./useZoom";

// apply() 는 document.documentElement.style.zoom (CSS zoom) 으로 적용 — jsdom 에서
// DOM 부수효과는 무해하므로 store 로직 (clamp/step/persist) 만 검증.

const STORAGE_KEY = "goodsoob:zoom";

describe("useZoom store", () => {
  beforeEach(() => {
    localStorage.clear();
    resetZoom(); // current 를 1 로 정규화 (모듈 상태가 테스트 간 공유됨)
  });

  it("기본값은 100% (1.0)", () => {
    expect(getZoom()).toBe(1);
  });

  it("zoomIn 은 0.1 step 으로 확대", () => {
    zoomIn();
    expect(getZoom()).toBeCloseTo(1.1, 10);
    zoomIn();
    expect(getZoom()).toBeCloseTo(1.2, 10);
  });

  it("zoomOut 은 0.1 step 으로 축소", () => {
    zoomOut();
    expect(getZoom()).toBeCloseTo(0.9, 10);
  });

  it("ZOOM_MAX 를 넘지 않는다", () => {
    for (let i = 0; i < 50; i++) zoomIn();
    expect(getZoom()).toBe(ZOOM_MAX);
  });

  it("ZOOM_MIN 아래로 내려가지 않는다", () => {
    for (let i = 0; i < 50; i++) zoomOut();
    expect(getZoom()).toBe(ZOOM_MIN);
  });

  it("reset 은 100% 로 되돌린다", () => {
    zoomIn();
    zoomIn();
    resetZoom();
    expect(getZoom()).toBe(1);
  });

  it("setZoomFactor 는 0.1 단위로 반올림 + clamp (float drift 차단)", () => {
    setZoomFactor(1.23456);
    expect(getZoom()).toBe(1.2);
    setZoomFactor(5);
    expect(getZoom()).toBe(ZOOM_MAX);
    setZoomFactor(0.1);
    expect(getZoom()).toBe(ZOOM_MIN);
  });

  it("배율을 localStorage 에 저장한다", () => {
    setZoomFactor(1.3);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1.3");
    resetZoom();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
  });

  it("DOM 에 zoom 스타일을 반영한다 (브라우저 fallback)", () => {
    setZoomFactor(1.4);
    expect(document.documentElement.style.zoom).toBe("1.4");
  });
});
