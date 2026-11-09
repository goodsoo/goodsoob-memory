import { describe, expect, it } from "vitest";
import type { RecordingEntry } from "../../api/recordings";
import { parseBase } from "../../lib/recordings/base";
import { mergeRecordings, type MemoRef } from "../../lib/recordings/merge";
import { CLAUDE_NOTE, statusView } from "./RecordingStatusLine";

const NO_STT = { done: false, moved: false, rawPromoted: false, anchored: false, diarized: false, reviewLeft: 0 };
const BASE = "20261105-1540";

function entry(over: Partial<RecordingEntry> = {}): RecordingEntry {
  return {
    base: BASE,
    parsed: parseBase(BASE),
    hasM4a: true,
    hasTxt: false,
    stt: { ...NO_STT },
    job: null,
    durationSec: 1800,
    creationTime: null,
    syncPending: false,
    firstLine: null,
    ...over,
    ...(over.stt ? { stt: { ...NO_STT, ...over.stt } } : {}),
  };
}

function memo(uid: string, title: string, audio: string[] = [BASE]): MemoRef {
  return { id: `inbox/${uid}.md`, uid, title, date: null, mtime: 0, audio };
}

function item(e: RecordingEntry, memos: MemoRef[] = [], trashed: MemoRef[] = []) {
  return mergeRecordings([e], memos, trashed)[0];
}

const none = { remaining: null };

describe("statusView — A 표 상태별", () => {
  it("undecided / waiting: 기다리는 중, 버튼 없음", () => {
    const v = statusView(item(entry()), none);
    expect(v.kind).toBe("text");
    expect(v.text).toBe("자동 받아쓰기를 기다리는 중입니다.");
    expect(v.primary).toBeUndefined();
    expect(v.secondary).toBeUndefined();
  });

  it("undecided / raw: primary 말한 사람 나누기", () => {
    const v = statusView(item(entry({ stt: { ...NO_STT, done: true } })), none);
    expect(v.text).toBe("자동 받아쓰기 상태입니다. 말한 사람을 나누면 문단별로 듣고 고칠 수 있습니다.");
    expect(v.primary).toMatchObject({ action: "split", label: "말한 사람 나누기", variant: "primary" });
    expect(v.secondary).toBeUndefined();
  });

  it("undecided / processing: Spinner + step 라벨, 버튼 없음", () => {
    const v = statusView(
      item(
        entry({
          stt: { ...NO_STT, done: true },
          job: { state: "running", pidAlive: true, kind: "diarize", step: "diarize" },
        }),
      ),
      none,
    );
    expect(v.kind).toBe("processing");
    expect(v.text).toBe("말한 사람 나누는 중. 다른 녹음으로 넘어가도 계속 진행됩니다.");
    expect(v.primary).toBeUndefined();
  });

  it("undecided / error (나누기): Alert + 다시 실행 → 나누기 창", () => {
    const v = statusView(
      item(entry({ stt: { ...NO_STT, done: true }, job: { state: "error", pidAlive: false, kind: "diarize" } })),
      none,
    );
    expect(v.kind).toBe("error");
    expect(v.text).toContain("작업이 중단되었습니다.");
    expect(v.primary).toMatchObject({ action: "rerunSplit", label: "다시 실행" });
    expect(v.claudeNote).toBeFalsy();
  });

  it("undecided / error (고칠 곳 찾기, 실패 부분 있음): 실패한 부분만 다시 실행 + 다시 실행", () => {
    const v = statusView(
      item(
        entry({
          stt: { ...NO_STT, done: true, diarized: true },
          job: { state: "error", pidAlive: false, kind: "corrections", error: "타임아웃.", failedChunks: [3, 5] },
        }),
      ),
      none,
    );
    expect(v.kind).toBe("error");
    expect(v.text).toBe("타임아웃. 원인을 확인한 뒤 다시 실행을 누르세요. 3, 5번 부분은 고칠 곳 찾기에 실패했습니다.");
    expect(v.primary).toMatchObject({ action: "retryFailed", label: "실패한 부분만 다시 실행", variant: "primary" });
    expect(v.secondary).toMatchObject({ action: "rerunFixes", label: "다시 실행", variant: "secondary" });
    expect(v.claudeNote).toBe(true);
  });

  it("undecided / error (고칠 곳 찾기, 실패 부분 없음): 다시 실행 하나", () => {
    const v = statusView(
      item(
        entry({
          stt: { ...NO_STT, done: true, diarized: true },
          job: { state: "error", pidAlive: false, kind: "corrections" },
        }),
      ),
      none,
    );
    expect(v.primary).toMatchObject({ action: "rerunFixes", variant: "primary" });
    expect(v.secondary).toBeUndefined();
  });

  it("undecided / correction: primary 메모로 보내기 + ghost 고칠 곳 찾기(Claude 안내 title)", () => {
    const v = statusView(item(entry({ stt: { ...NO_STT, done: true, diarized: true } })), none);
    expect(v.text).toBe("문단을 눌러 고치고, 시각을 눌러 그 부분부터 듣습니다.");
    expect(v.primary).toMatchObject({ action: "send", label: "메모로 보내기", variant: "primary" });
    expect(v.secondary).toMatchObject({ action: "findFixes", label: "고칠 곳 찾기", variant: "ghost", title: CLAUDE_NOTE });
  });

  describe("undecided / review", () => {
    const rev = item(entry({ stt: { ...NO_STT, done: true, diarized: true, anchored: true, reviewLeft: 5 } }));

    it("전체 남은 수를 세고 위치 못 찾은 수를 덧붙인다 + primary 보내기 / secondary 다음 고칠 곳", () => {
      const v = statusView(rev, { remaining: 5, unmatched: 2 });
      expect(v.text).toBe("고칠 곳 5개 남음 (본문에서 위치를 못 찾은 2개 포함). 밑줄을 눌러 바꾸거나 그대로 둡니다.");
      expect(v.primary).toMatchObject({ action: "send", variant: "primary" });
      expect(v.secondary).toMatchObject({ action: "nextReview", label: "다음 고칠 곳", variant: "secondary" });
      expect(v.secondary?.disabled).toBe(false);
    });

    it("불러오는 중이면 다음 고칠 곳 꺼짐", () => {
      const v = statusView(rev, { remaining: null });
      expect(v.text).toBe("고칠 곳을 불러오는 중입니다.");
      expect(v.secondary?.disabled).toBe(true);
    });

    it("밑줄 0개 + 위치 못 찾은 것만 남음", () => {
      const v = statusView(rev, { remaining: 2, unmatched: 2 });
      expect(v.text).toContain("고칠 곳 2개 남음");
      expect(v.text).toContain("본문에서 위치를 못 찾았습니다");
      expect(v.secondary?.disabled).toBe(true);
    });
  });

  it("undecided / corrected: primary 메모로 보내기 (orphan 이면 연결 복구 path)", () => {
    const v = statusView(item(entry({ hasTxt: true, stt: { ...NO_STT, done: true } })), none);
    expect(v.text).toBe("고치기를 마쳤습니다. 보낼 메모를 고릅니다.");
    expect(v.primary).toMatchObject({ action: "send", variant: "primary" });
    expect(v.orphanPath).toBeNull();

    const o = statusView(item(entry({ hasTxt: true, orphan: "work/회의.md" })), none);
    expect(o.orphanPath).toBe("work/회의.md");
  });

  it("textOnly (보낼 수 있음): corrected 와 같다", () => {
    const v = statusView(item(entry({ hasM4a: false, hasTxt: true })), none);
    expect(v.primary).toMatchObject({ action: "send" });
  });

  it("textOnly (보낼 수 없음): 안내만, 버튼 없음", () => {
    const v = statusView(item(entry({ hasM4a: false, hasTxt: true, stt: { ...NO_STT, rawPromoted: true } })), none);
    expect(v.text).toBe(
      "녹음 파일 없이 자동 받아쓰기만 남아 고치거나 보낼 수 없습니다. 필요 없으면 오른쪽 위 메뉴에서 삭제하세요.",
    );
    expect(v.primary).toBeUndefined();
    expect(v.secondary).toBeUndefined();
  });

  it("linked: '{제목}' 메모로 보냈습니다 + primary 메모 열기", () => {
    const v = statusView(item(entry({ stt: { ...NO_STT, done: true, moved: true } }), [memo("u1", "주간 회의")]), none);
    expect(v.text).toBe("'주간 회의' 메모로 보냈습니다. 고칠 곳은 메모의 음성 기록에서 고칩니다.");
    expect(v.primary).toMatchObject({ action: "openMemo", label: "메모 열기", variant: "primary" });
  });

  it("moveIncomplete: 옮기는 중 문구 추가", () => {
    const v = statusView(item(entry({ hasTxt: true }), [memo("u1", "주간 회의")]), none);
    expect(v.text).toBe("'주간 회의' 메모로 보냈습니다. 고칠 곳은 메모의 음성 기록에서 고칩니다. 메모로 옮기는 중입니다.");
    expect(v.primary).toMatchObject({ action: "openMemo" });
  });

  it("trash: secondary 메모 복원", () => {
    const v = statusView(item(entry({ stt: { ...NO_STT, moved: true } }), [], [memo("u2", "지난 회의")]), none);
    expect(v.text).toBe(
      "이 녹음을 보낸 메모 '지난 회의' 가 휴지통에 있습니다. 메모를 복원하면 음성 기록도 함께 돌아옵니다.",
    );
    expect(v.primary).toBeUndefined();
    expect(v.secondary).toMatchObject({ action: "restoreMemo", label: "메모 복원", variant: "secondary" });
  });

  it("transcriptMissing: 안내만", () => {
    const v = statusView(item(entry({ stt: { ...NO_STT, moved: true }, orphan: false })), none);
    expect(v.text).toBe(
      "보냈던 메모가 휴지통에서 비워져 음성 기록도 함께 지워졌습니다. 필요 없으면 오른쪽 위 메뉴에서 삭제하세요.",
    );
    expect(v.primary).toBeUndefined();
    expect(v.secondary).toBeUndefined();
  });

  it("모든 상태에서 primary 는 최대 1개, 문구에 em dash 없음", () => {
    const samples = [
      statusView(item(entry({ stt: { ...NO_STT, done: true } })), none),
      statusView(item(entry({ stt: { ...NO_STT, diarized: true } })), none),
      statusView(item(entry({ stt: { ...NO_STT, diarized: true, anchored: true, reviewLeft: 2 } })), { remaining: 2 }),
      statusView(item(entry({ hasTxt: true })), none),
    ];
    for (const v of samples) {
      const primaries = [v.primary, v.secondary].filter((b) => b?.variant === "primary");
      expect(primaries.length).toBeLessThanOrEqual(1);
      expect(v.text ?? "").not.toContain("—");
    }
  });
});
