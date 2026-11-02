import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { MeetingUpdate } from "../../api/meetings";
import { useStateHistory } from "../../hooks/useStateHistory";
import {
  diffDocPatch,
  fieldsPatch,
  patchFields,
  type DocSnapshot,
} from "./docPatch";

function snap(over: Partial<DocSnapshot> = {}): DocSnapshot {
  return {
    body: "본문",
    transcript: "",
    summary: "",
    meta: { date: "2026-10-29", time: "14:00", attendees: "철수, 영희" },
    ...over,
  };
}

describe("diffDocPatch", () => {
  it("sends only the body when only the body changed", () => {
    const prev = snap({ transcript: "기존 음성 기록", summary: "### 요약" });
    const next = { ...prev, body: "본문 수정" };
    expect(diffDocPatch(prev, next)).toEqual({ content: "본문 수정" });
  });

  it("returns an empty patch when nothing changed", () => {
    const prev = snap({ transcript: "t" });
    expect(diffDocPatch(prev, { ...prev, __source: "body" })).toEqual({});
  });

  it("diffs meta fields independently", () => {
    const prev = snap();
    const next = { ...prev, meta: { ...prev.meta, time: " 15:00 " } };
    expect(diffDocPatch(prev, next)).toEqual({ time: "15:00" });
  });

  it("keeps the empty-means-delete semantics for a transcript the user cleared", () => {
    const prev = snap({ transcript: "지울 음성 기록" });
    const next = { ...prev, transcript: "" };
    expect(diffDocPatch(prev, next)).toEqual({ transcript: null });
  });

  it("includes forced (previously failed) fields even if unchanged", () => {
    const prev = snap({ transcript: "t" });
    const next = { ...prev, body: "b2" };
    expect(diffDocPatch(prev, next, ["summary"])).toEqual({
      content: "b2",
      summary: null,
    });
  });

  it("patchFields / fieldsPatch round-trip and ignore title", () => {
    const d = snap({ transcript: "t" });
    const patch: MeetingUpdate = { title: "x", ...fieldsPatch(d, ["transcript", "date"]) };
    expect(patchFields(patch)).toEqual(["transcript", "date"]);
  });
});

// CRITICAL (D5): 메모를 연 뒤 디스크의 transcript 사이드카가 바뀌어도 (녹음 연결이
// 섹션을 덧붙임) 폼에서 본문만 고친 저장은 transcript 를 보내지 않아야 한다. 폼과 같은
// 배선 — useStateHistory.onCommit(next, prev) → diffDocPatch — 으로 재현.
describe("open form vs. external transcript change (regression)", () => {
  function setupForm(cacheKey: string, loaded: DocSnapshot) {
    const patches: MeetingUpdate[] = [];
    const hook = renderHook(() =>
      useStateHistory<DocSnapshot>({
        cacheKey,
        initial: loaded,
        commitMs: 1000,
        onCommit: (d, prev) => {
          const p = diffDocPatch(prev, d);
          if (Object.keys(p).length > 0) patches.push(p);
        },
      }),
    );
    return { ...hook, patches };
  }

  it("memo without a transcript: body edit after link does not send transcript", () => {
    // 폼 로드 시점 디스크 = transcript 없음. 이후 서버가 사이드카에 녹음 섹션 추가
    // (폼 상태는 모름 — HISTORY_CACHE 가 디스크를 다시 읽지 않음).
    const { result, patches } = setupForm("d5-no-transcript", snap({ transcript: "" }));
    act(() => {
      result.current.set({ ...result.current.value, body: "본문 한 글자 더" });
      result.current.flush();
    });
    expect(patches).toEqual([{ content: "본문 한 글자 더" }]);
    expect(patches[0]).not.toHaveProperty("transcript");
  });

  it("memo with an existing transcript: body edits never resend the stale transcript", () => {
    const { result, patches } = setupForm(
      "d5-existing-transcript",
      snap({ transcript: "기존 음성 기록", summary: "### 요약" }),
    );
    act(() => {
      result.current.set({ ...result.current.value, body: "수정 1" });
      result.current.flush();
    });
    act(() => {
      result.current.set({ ...result.current.value, body: "수정 2" });
      result.current.flush();
    });
    // undo 도 본문만 되돌려 보냄.
    act(() => {
      result.current.undo();
    });
    expect(patches).toEqual([
      { content: "수정 1" },
      { content: "수정 2" },
      { content: "수정 1" },
    ]);
    for (const p of patches) {
      expect(p).not.toHaveProperty("transcript");
      expect(p).not.toHaveProperty("summary");
    }
  });

  it("restored-from-cache form (remount) still diffs against its own baseline", () => {
    const loaded = snap({ transcript: "기존" });
    const first = setupForm("d5-remount", loaded);
    act(() => {
      first.result.current.set({ ...first.result.current.value, body: "편집" });
      first.result.current.flush();
    });
    first.unmount();
    // 재마운트 시 initial 은 디스크의 새 transcript 지만 cache 가 이김 — 그래도
    // 본문 저장은 transcript 를 보내지 않는다.
    const second = setupForm("d5-remount", snap({ transcript: "기존\n## 녹음 섹션" }));
    act(() => {
      second.result.current.set({ ...second.result.current.value, body: "편집 2" });
      second.result.current.flush();
    });
    expect(second.patches).toEqual([{ content: "편집 2" }]);
  });
});
