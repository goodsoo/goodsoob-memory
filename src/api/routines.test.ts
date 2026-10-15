import { describe, expect, it } from "vitest";
import {
  createRoutine,
  deleteRoutine,
  fileToRoutine,
  InvalidRoutineNameError,
  isActiveOn,
  listRoutines,
  listRoutinesActiveOn,
  parseRoutineLog,
  readRoutine,
  RoutineConflictError,
  RoutineDateRangeError,
  routineToRaw,
  sortRoutines,
  toggleRoutineDay,
  updateRoutine,
  type Routine,
} from "./routines";
import { createMemoryAdapter } from "../lib/vault/adapter";

function makeAdapter() {
  const a = createMemoryAdapter();
  a.setRoot("/vault");
  return a;
}

describe("parseRoutineLog", () => {
  it("done 라인 (- [x] ✅ YYYY-MM-DD) 매칭", () => {
    const log = parseRoutineLog(
      ["- [x] ✅ 2026-05-24", "- [x] ✅ 2026-05-23"].join("\n"),
    );
    expect(log.size).toBe(2);
    expect(log.has("2026-05-24")).toBe(true);
  });

  it("✅ 이모지 없어도 매칭 (옵시디안 외부 편집 호환)", () => {
    const log = parseRoutineLog("- [x] 2026-05-24");
    expect(log.has("2026-05-24")).toBe(true);
  });

  it("형식 안 맞는 라인 무시", () => {
    const log = parseRoutineLog(
      ["- [x] 2026/05/24", "- 그냥 텍스트", "## 헤더"].join("\n"),
    );
    expect(log.size).toBe(0);
  });
});

describe("routineToRaw + fileToRoutine round-trip", () => {
  it("최신 위 + frontmatter (id/time/started/ends) 보존", () => {
    const r: Routine = {
      slug: "운동",
      name: "운동",
      frontmatter: {
        id: "abc-123",
        time: "07:00",
        started: "2026-05-01",
        ends: "2026-07-20",
      },
      log: new Set(["2026-05-23", "2026-05-25", "2026-05-24"]),
      filePath: "routines/운동.md",
      mtime: 0,
    };
    const raw = routineToRaw(r);
    expect(raw).toContain("id: abc-123");
    expect(raw).toContain("time: '07:00'");
    expect(raw).toContain("started: 2026-05-01");
    expect(raw).toContain("ends: 2026-07-20");
    const lines = raw.split("\n").filter((l) => l.startsWith("- ["));
    expect(lines[0]).toContain("2026-05-25");
    expect(lines[1]).toContain("2026-05-24");

    const parsed = fileToRoutine("routines/운동.md", raw, 123);
    expect(parsed?.frontmatter.id).toBe("abc-123");
    expect(parsed?.frontmatter.time).toBe("07:00");
    expect(parsed?.frontmatter.ends).toBe("2026-07-20");
    expect(parsed?.log.size).toBe(3);
  });

  it("started 없으면 null (필수 필드)", () => {
    const raw = "---\nid: x\n---\n\n# foo\n";
    expect(fileToRoutine("routines/foo.md", raw, 0)).toBeNull();
  });
});

describe("isActiveOn", () => {
  const fm = {
    id: "x",
    started: "2026-05-10",
    ends: "2026-05-20",
  };

  it("시작일 미만 = false", () => {
    expect(isActiveOn(fm, "2026-05-09")).toBe(false);
  });
  it("시작일 = true", () => {
    expect(isActiveOn(fm, "2026-05-10")).toBe(true);
  });
  it("기간 안 = true", () => {
    expect(isActiveOn(fm, "2026-05-15")).toBe(true);
  });
  it("종료일 = true (경계 포함)", () => {
    expect(isActiveOn(fm, "2026-05-20")).toBe(true);
  });
  it("종료일 초과 = false", () => {
    expect(isActiveOn(fm, "2026-05-21")).toBe(false);
  });
  it("ends 없으면 미래도 true", () => {
    expect(isActiveOn({ id: "x", started: "2026-05-10" }, "2030-12-31")).toBe(true);
  });
});

describe("sortRoutines", () => {
  it("시간순, 시간 없는 건 뒤로, 같은 시간은 이름순", () => {
    const r = (name: string, time?: string): Routine => ({
      slug: name,
      name,
      frontmatter: { id: name, started: "2026-05-01", time },
      log: new Set(),
      filePath: `routines/${name}.md`,
      mtime: 0,
    });
    const sorted = sortRoutines([r("일기"), r("운동", "07:00"), r("출근", "09:00"), r("스트레칭", "07:00")]);
    expect(sorted.map((x) => x.name)).toEqual(["스트레칭", "운동", "출근", "일기"]);
  });
});

describe("createRoutine", () => {
  it("새 파일 + 필수 필드", async () => {
    const a = makeAdapter();
    const r = await createRoutine(a, {
      name: "운동",
      time: "07:00",
      started: "2026-05-25",
    });
    expect(r.name).toBe("운동");
    expect(r.frontmatter.id).toBeTruthy();
    expect(await a.exists("_routines/운동.md")).toBe(true);
  });

  it("중복 이름 reject", async () => {
    const a = makeAdapter();
    await createRoutine(a, { name: "운동", started: "2026-05-25" });
    await expect(
      createRoutine(a, { name: "운동", started: "2026-05-25" }),
    ).rejects.toThrow(RoutineConflictError);
  });

  it("금지 문자 reject", async () => {
    const a = makeAdapter();
    await expect(
      createRoutine(a, { name: "운/동", started: "2026-05-25" }),
    ).rejects.toThrow(InvalidRoutineNameError);
  });

  it("ends < started reject", async () => {
    const a = makeAdapter();
    await expect(
      createRoutine(a, {
        name: "운동",
        started: "2026-05-25",
        ends: "2026-05-20",
      }),
    ).rejects.toThrow(RoutineDateRangeError);
  });
});

describe("updateRoutine", () => {
  it("필드 부분 patch", async () => {
    const a = makeAdapter();
    await createRoutine(a, {
      name: "운동",
      time: "07:00",
      started: "2026-05-25",
    });
    await updateRoutine(a, "운동", { time: "08:00" });
    const r = await readRoutine(a, "운동");
    expect(r?.frontmatter.time).toBe("08:00");
  });

  it("ends=null 로 제거", async () => {
    const a = makeAdapter();
    await createRoutine(a, {
      name: "PT",
      started: "2026-05-25",
      ends: "2026-07-20",
    });
    await updateRoutine(a, "PT", { ends: null });
    const r = await readRoutine(a, "PT");
    expect(r?.frontmatter.ends).toBeUndefined();
  });

  it("rename 으로 파일명 변경", async () => {
    const a = makeAdapter();
    await createRoutine(a, { name: "조깅", started: "2026-05-25" });
    await updateRoutine(a, "조깅", { rename: "달리기" });
    expect(await a.exists("_routines/조깅.md")).toBe(false);
    expect(await a.exists("_routines/달리기.md")).toBe(true);
  });

  it("rename 충돌 reject", async () => {
    const a = makeAdapter();
    await createRoutine(a, { name: "운동", started: "2026-05-25" });
    await createRoutine(a, { name: "조깅", started: "2026-05-25" });
    await expect(
      updateRoutine(a, "조깅", { rename: "운동" }),
    ).rejects.toThrow(RoutineConflictError);
  });

  it("ends 를 started 이전으로 patch 시 reject", async () => {
    const a = makeAdapter();
    await createRoutine(a, { name: "PT", started: "2026-05-25" });
    await expect(
      updateRoutine(a, "PT", { ends: "2026-05-20" }),
    ).rejects.toThrow(RoutineDateRangeError);
  });

  it("started 를 기존 ends 이후로 patch 시 reject", async () => {
    const a = makeAdapter();
    await createRoutine(a, {
      name: "PT",
      started: "2026-05-25",
      ends: "2026-06-25",
    });
    await expect(
      updateRoutine(a, "PT", { started: "2026-07-01" }),
    ).rejects.toThrow(RoutineDateRangeError);
  });
});

describe("toggleRoutineDay", () => {
  it("done=true → Set 추가", async () => {
    const a = makeAdapter();
    await createRoutine(a, { name: "운동", started: "2026-05-25" });
    await toggleRoutineDay(a, "운동", "2026-05-25", true);
    const r = await readRoutine(a, "운동");
    expect(r?.log.has("2026-05-25")).toBe(true);
  });

  it("done=false → Set 제거", async () => {
    const a = makeAdapter();
    await createRoutine(a, { name: "운동", started: "2026-05-25" });
    await toggleRoutineDay(a, "운동", "2026-05-25", true);
    await toggleRoutineDay(a, "운동", "2026-05-25", false);
    const r = await readRoutine(a, "운동");
    expect(r?.log.has("2026-05-25")).toBe(false);
  });
});

describe("listRoutinesActiveOn", () => {
  it("기간 안 routine 만", async () => {
    const a = makeAdapter();
    await createRoutine(a, {
      name: "PT",
      started: "2026-05-10",
      ends: "2026-05-20",
    });
    await createRoutine(a, {
      name: "운동",
      started: "2026-05-01",
    });
    await createRoutine(a, {
      name: "독서",
      started: "2026-06-01", // 시작 전
    });

    const may15 = await listRoutinesActiveOn(a, "2026-05-15");
    expect(may15.map((r) => r.name).sort()).toEqual(["PT", "운동"]);

    const may25 = await listRoutinesActiveOn(a, "2026-05-25");
    // PT 종료 후, 독서 시작 전 → 운동만
    expect(may25.map((r) => r.name)).toEqual(["운동"]);

    const jun15 = await listRoutinesActiveOn(a, "2026-06-15");
    expect(jun15.map((r) => r.name).sort()).toEqual(["독서", "운동"]);
  });
});

describe("listRoutines + deleteRoutine", () => {
  it("정렬 + 삭제", async () => {
    const a = makeAdapter();
    await createRoutine(a, { name: "운동", time: "07:00", started: "2026-05-25" });
    await createRoutine(a, { name: "출근", time: "09:00", started: "2026-05-25" });
    await createRoutine(a, { name: "일기", started: "2026-05-25" });
    const list = await listRoutines(a);
    expect(list.map((r) => r.name)).toEqual(["운동", "출근", "일기"]);

    await deleteRoutine(a, "운동");
    const after = await listRoutines(a);
    expect(after.map((r) => r.name)).toEqual(["출근", "일기"]);
  });
});
