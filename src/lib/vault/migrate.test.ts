import { describe, it, expect } from "vitest";
import { createMemoryAdapter } from "./adapter";
import { migrateRootInbox, scanAllTasks } from "./scan";
import { extractEvents, SCHEDULE_PATH } from "./schedule";

function makeAdapter() {
  const a = createMemoryAdapter();
  a.setRoot("/vault");
  return a;
}

const SAMPLE = `# Inbox

## 할 일
- [ ] 보고서 작성 --- 2026-06-20 #work
- [x] 완료된 일 #other

## 일정
- [ ] 팀 회의 --- 2026-06-15 14:30 #schedule
- [ ] 출장 --- 2026-06-15..2026-06-17 #schedule

## 빠른 메모
대충 적은 메모
`;

describe("migrateRootInbox — V0.8 모델 분리 lazy migration", () => {
  it("#schedule + 날짜 라인 → schedule.md 로 이동 (체크박스 제거, 이벤트 포맷)", async () => {
    const a = makeAdapter();
    await a.write("inbox.md", SAMPLE);
    await migrateRootInbox(a);

    const sched = await a.read(SCHEDULE_PATH);
    expect(sched).not.toContain("[ ]"); // 체크박스 제거
    expect(sched).not.toContain("#schedule");
    const events = extractEvents(SCHEDULE_PATH, sched);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ start: "2026-06-15", time: "14:30", text: "팀 회의" }),
        expect.objectContaining({ start: "2026-06-15", end: "2026-06-17", text: "출장" }),
      ]),
    );
  });

  it("그 외 할 일 → tasks/inbox.md (카테고리 태그 제거, 체크박스·날짜·완료 보존)", async () => {
    const a = makeAdapter();
    await a.write("inbox.md", SAMPLE);
    await migrateRootInbox(a);

    const inbox = await a.read("_tasks/inbox.md");
    expect(inbox).not.toContain("#work");
    expect(inbox).not.toContain("#other");
    expect(inbox).toContain("- [ ] 보고서 작성 --- 2026-06-20");
    expect(inbox).toContain("- [x] 완료된 일");
    // 비-태스크 라인(헤더·빠른 메모) 보존 — 데이터 손실 없음.
    expect(inbox).toContain("## 빠른 메모");
    expect(inbox).toContain("대충 적은 메모");

    // scanAllTasks 가 tasks/ 폴더에서 두 할 일을 읽고, 일정은 안 섞임.
    const tasks = await scanAllTasks(a);
    const titles = tasks.map((t) => t.text);
    expect(titles).toContain("보고서 작성");
    expect(titles).toContain("완료된 일");
    expect(titles).not.toContain("팀 회의");
  });

  it("마이그레이션 후 루트 inbox.md 삭제", async () => {
    const a = makeAdapter();
    await a.write("inbox.md", SAMPLE);
    await migrateRootInbox(a);
    expect(await a.exists("inbox.md")).toBe(false);
  });

  it("idempotent — 루트 inbox.md 없으면 noop", async () => {
    const a = makeAdapter();
    await a.write("_tasks/inbox.md", "# 미분류\n- [ ] 기존 할 일\n");
    await migrateRootInbox(a); // 루트 inbox 없음 → early return
    const inbox = await a.read("_tasks/inbox.md");
    expect(inbox).toBe("# 미분류\n- [ ] 기존 할 일\n");
  });

  // [REGRESSION] StrictMode 이중 실행 — 동시 2회 호출이 내용을 중복시키면 안 됨.
  it("동시 2회 호출해도 중복 없이 1회만 마이그레이션", async () => {
    const a = makeAdapter();
    await a.write("inbox.md", SAMPLE);
    await Promise.all([migrateRootInbox(a), migrateRootInbox(a)]);

    const inbox = await a.read("_tasks/inbox.md");
    // 할 일 라인은 정확히 1번만.
    const reportCount = inbox.split("보고서 작성").length - 1;
    expect(reportCount).toBe(1);
    // 일정 이벤트도 1번만.
    const sched = await a.read(SCHEDULE_PATH);
    expect(sched.split("팀 회의").length - 1).toBe(1);
  });
});
