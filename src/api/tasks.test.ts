import { describe, expect, it } from "vitest";
import {
  buildTodoLine,
  createTodo,
  listTodos,
  makeTodoId,
  updateTask,
} from "./tasks";
import { extractTasks } from "../lib/vault/tasks";
import { createMemoryAdapter } from "../lib/vault/adapter";

const INBOX = "tasks/inbox.md";

function makeAdapter() {
  const a = createMemoryAdapter();
  a.setRoot("/vault");
  return a;
}

describe("buildTodoLine — 단일 날짜만 (다일은 일정 전용)", () => {
  it("due_date 는 단일 날짜로 직렬화 (범위 토큰 없음)", () => {
    const line = buildTodoLine({ title: "보고서", due_date: "2026-06-10" });
    expect(line).toContain("--- 2026-06-10");
    expect(line).not.toContain("..");
  });

  it("카테고리 태그를 박지 않는다 (모델 분리)", () => {
    const line = buildTodoLine({ title: "x", due_date: "2026-06-10" });
    expect(line).not.toContain("#work");
    expect(line).not.toContain("#schedule");
    expect(line).not.toContain("#other");
  });

  it("라인 → extractTasks 라운드트립으로 텍스트·날짜 보존", () => {
    const line = buildTodoLine({ title: "보고서", due_date: "2026-06-10" });
    const items = extractTasks(INBOX, `${line}\n`);
    expect(items[0].text).toBe("보고서");
    expect(items[0].due).toBe("2026-06-10");
  });
});

describe("[REGRESSION] updateTask round-trip — 옛 gcal 앵커 태그 보존", () => {
  it("옛 카테고리 태그(#work/#schedule/#other)는 update 시 제거된다", async () => {
    const a = makeAdapter();
    await a.write(INBOX, "# 미분류\n- [ ] 발표 --- 2026-05-22 #schedule #gcal-keepme\n");
    const id = makeTodoId(INBOX, 1);
    const after = await updateTask(a, id, { title: "발표2" });
    expect(after.title).toBe("발표2");
    const raw = await a.read(INBOX);
    expect(raw).not.toContain("#schedule");
    // gcal 기능 제거 후에도 옛 #gcal- 앵커는 extra_tag 로 보존 (로컬 데이터 무손실).
    expect(raw).toContain("#gcal-keepme");
  });
});

describe("createTodo", () => {
  it("기본은 tasks/inbox.md 에 추가", async () => {
    const a = makeAdapter();
    const task = await createTodo(a, { title: "미분류 할 일" });
    expect(task._source.file).toBe(INBOX);
    const raw = await a.read(INBOX);
    expect(raw).toContain("미분류 할 일");
  });

  it("target_file 을 주면 그 프로젝트 파일에 추가", async () => {
    const a = makeAdapter();
    const task = await createTodo(a, {
      title: "프로젝트 할 일",
      target_file: "tasks/프로젝트A.md",
    });
    expect(task._source.file).toBe("tasks/프로젝트A.md");
    const raw = await a.read("tasks/프로젝트A.md");
    expect(raw).toContain("프로젝트 할 일");
  });
});

describe("listTodos — tasks/ 폴더 전체 스캔", () => {
  it("여러 프로젝트 파일을 가로질러 수집 + source.file 이 프로젝트를 가리킴", async () => {
    const a = makeAdapter();
    await a.write("tasks/inbox.md", "# 미분류\n- [ ] A\n");
    await a.write("tasks/프로젝트X.md", "# 프로젝트X\n- [ ] B\n");
    const tasks = await listTodos(a);
    const a1 = tasks.find((t) => t.title === "A");
    const b1 = tasks.find((t) => t.title === "B");
    expect(a1!._source.file).toBe("tasks/inbox.md");
    expect(b1!._source.file).toBe("tasks/프로젝트X.md");
  });
});
