import { describe, it, expect } from "vitest";
import type { MeetingUpdate } from "../../api/meetings";
import { diffDocPatch, type DocSnapshot } from "./docPatch";
import { createSaveRetryStore, isSaveErrorVisible, runSave } from "./saveRetry";

function snap(over: Partial<DocSnapshot> = {}): DocSnapshot {
  return {
    body: "본문",
    transcript: "",
    summary: "",
    meta: { date: "2026-10-29", time: "14:00", attendees: "" },
    ...over,
  };
}

// 직렬화된 mutation 흉내 — 각 call 은 앞 call 이 끝난 뒤 실행되고, 테스트가 결과를 지정.
function serialSender() {
  const calls: MeetingUpdate[] = [];
  const outcomes: Array<"ok" | "fail"> = [];
  let chain: Promise<unknown> = Promise.resolve();
  const send = (patch: MeetingUpdate) => {
    const run = chain.then(() => {
      const i = calls.push(patch) - 1;
      if ((outcomes[i] ?? "ok") === "fail") throw new Error("iCloud 지연");
    });
    chain = run.catch(() => {});
    return run;
  };
  return { send, calls, outcomes };
}

describe("runSave — 실패 칸 보존·표시·자동 복구", () => {
  it("M1(body) 실패 + M2(summary) 성공: 에러 유지 후 body 를 현재 값으로 자동 복구", async () => {
    const store = createSaveRetryStore();
    const { send, calls, outcomes } = serialSender();
    // M1 실패, M2 성공, 복구 send 실패 → 복구는 1회만, 에러 상태 유지 검증
    outcomes.push("fail", "ok", "fail");
    let committed = snap({ body: "본문 v1" });
    const current = () => committed;

    const base = snap();
    // M1: debounce 저장 {content}
    const p1 = runSave(store, "u", diffDocPatch(base, committed, store.get("u").fields), send, current);
    // C2: M1 in flight 중 즉시 commit — retry 칸 비어 있음 → summary 만
    const prev = committed;
    committed = { ...committed, body: "본문 v2", summary: "### 요약" };
    const c2 = diffDocPatch(prev, { ...prev, summary: "### 요약" }, store.get("u").fields);
    expect(c2).toEqual({ summary: "### 요약" });
    const p2 = runSave(store, "u", c2, send, current);

    await p1;
    // M1 실패 직후: body 남음, M2 진행 중이라 indicator 는 아직(pending)
    expect([...store.get("u").fields]).toEqual(["body"]);
    expect(isSaveErrorVisible(store.get("u"))).toBe(false);

    await p2;
    // M2 성공 → 남은 body 를 현재 committed 값으로 복구 send (3번째 call)
    expect(calls[2]).toEqual({ content: "본문 v2" });
    // 복구 실패 → 무한 루프 없이 멈추고 에러 표시
    expect(calls).toHaveLength(3);
    expect([...store.get("u").fields]).toEqual(["body"]);
    expect(isSaveErrorVisible(store.get("u"))).toBe(true);
    expect(store.get("u").error).toBeInstanceOf(Error);
  });

  it("복구 성공 시 retry 칸 비워지고 에러 해제", async () => {
    const store = createSaveRetryStore();
    const { send, calls, outcomes } = serialSender();
    outcomes.push("fail", "ok", "ok");
    const committed = snap({ body: "최신 본문", summary: "s" });
    const p1 = runSave(store, "u", { content: "옛 본문" }, send, () => committed);
    const p2 = runSave(store, "u", { summary: "s" }, send, () => committed);
    await Promise.all([p1, p2]);
    // 상위 runSave 가 복구까지 await 하므로 여기선 완료
    expect(calls).toEqual([{ content: "옛 본문" }, { summary: "s" }, { content: "최신 본문" }]);
    expect(store.get("u").fields.size).toBe(0);
    expect(isSaveErrorVisible(store.get("u"))).toBe(false);
    expect(store.get("u").error).toBeNull();
  });

  it("단독 실패는 즉시 에러 표시, 같은 칸 성공 저장이 지운다 (복구 send 없음)", async () => {
    const store = createSaveRetryStore();
    const { send, calls, outcomes } = serialSender();
    outcomes.push("fail", "ok");
    await runSave(store, "u", { content: "a" }, send, () => snap());
    expect(isSaveErrorVisible(store.get("u"))).toBe(true);
    // 다음 저장은 diff 에 강제 포함된 body 를 보냄
    const patch = diffDocPatch(snap({ body: "a" }), snap({ body: "a" }), store.get("u").fields);
    expect(patch).toEqual({ content: "a" });
    await runSave(store, "u", patch, send, () => snap({ body: "a" }));
    expect(calls).toHaveLength(2);
    expect(isSaveErrorVisible(store.get("u"))).toBe(false);
  });

  it("store 는 모듈 상태라 구독자(remount 된 폼)가 같은 에러를 본다", async () => {
    const store = createSaveRetryStore();
    let notified = 0;
    const unsub = store.subscribe(() => notified++);
    store.begin("u");
    store.fail("u", ["body"], new Error("x"));
    unsub();
    // 새 인스턴스(remount) 가 읽어도 그대로
    expect(isSaveErrorVisible(store.get("u"))).toBe(true);
    expect(notified).toBe(2);
    store.dismiss("u");
    expect(store.get("u").dismissed).toBe(true);
    expect(isSaveErrorVisible(store.get("u"))).toBe(true);
    store.clear("u");
    expect(store.get("u").fields.size).toBe(0);
  });
});
