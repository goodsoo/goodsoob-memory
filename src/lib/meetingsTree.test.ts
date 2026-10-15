import { describe, it, expect } from "vitest";
import {
  buildMeetingsTree,
  canDropFolder,
  flattenFolderPaths,
  folderParent,
} from "./meetingsTree";
import type { Meeting } from "../api/meetings";

function fakeMeeting(id: string, title: string, mtime = 1000): Meeting {
  return {
    id,
    uid: `uid-${title}`,
    title,
    date: null,
    time: null,
    attendees: [],
    tags: [],
    pinned: false,
    mtime,
    created_at: "",
    updated_at: "",
    deleted_at: null,
    content: "",
    transcript: "",
    summary: "",
  };
}

describe("buildMeetingsTree", () => {
  it("root 메모는 rootMeetings 로, 폴더 안 메모는 트리로", () => {
    const tree = buildMeetingsTree([
      fakeMeeting("inbox.md", "inbox"),
      fakeMeeting("work/q1.md", "q1"),
      fakeMeeting("work/q2.md", "q2"),
      fakeMeeting("personal/run.md", "run"),
    ]);
    expect(tree.rootMeetings.map((m) => m.title)).toEqual(["inbox"]);
    expect(tree.folders.map((f) => f.path)).toEqual(["personal", "work"]); // alphabetic
    const work = tree.folders.find((f) => f.path === "work")!;
    expect(work.meetings.map((m) => m.title).sort()).toEqual(["q1", "q2"]);
  });

  it("중첩 폴더 (`work/2026`) 도 트리로", () => {
    const tree = buildMeetingsTree([
      fakeMeeting("work/2026/jan.md", "jan"),
      fakeMeeting("work/2026/feb.md", "feb"),
      fakeMeeting("work/strategy.md", "strategy"),
    ]);
    const work = tree.folders[0];
    expect(work.path).toBe("work");
    expect(work.meetings.map((m) => m.title)).toEqual(["strategy"]);
    expect(work.children[0].path).toBe("work/2026");
    expect(
      work.children[0].meetings.map((m) => m.title).sort(),
    ).toEqual(["feb", "jan"]);
  });

  it("sortMeetings comparator 적용 — 같은 폴더 안에서만", () => {
    const tree = buildMeetingsTree(
      [
        fakeMeeting("work/b.md", "b", 1000),
        fakeMeeting("work/a.md", "a", 2000), // 더 최신
      ],
      (a, b) => b.mtime - a.mtime, // mtime desc
    );
    expect(tree.folders[0].meetings.map((m) => m.title)).toEqual(["a", "b"]);
  });

  it("폴더 0개 — rootMeetings 만", () => {
    const tree = buildMeetingsTree([
      fakeMeeting("x.md", "x"),
      fakeMeeting("y.md", "y"),
    ]);
    expect(tree.folders).toEqual([]);
    expect(tree.rootMeetings).toHaveLength(2);
  });
});

describe("buildMeetingsTree — extraFolders (빈 폴더 시각화)", () => {
  it("메모 0개 폴더도 트리에 포함", () => {
    const tree = buildMeetingsTree([], undefined, ["empty"]);
    expect(tree.folders.map((f) => f.path)).toEqual(["empty"]);
    expect(tree.folders[0].meetings).toEqual([]);
  });

  it("notes/ prefix 없는 path 도 허용 (relative)", () => {
    const tree = buildMeetingsTree([], undefined, ["work", "work/2026"]);
    expect(tree.folders[0].path).toBe("work");
    expect(tree.folders[0].children[0].path).toBe("work/2026");
  });

  it("메모 있는 폴더 + 빈 폴더 mix", () => {
    const tree = buildMeetingsTree(
      [fakeMeeting("work/q1.md", "q1")],
      undefined,
      ["work", "personal"],
    );
    const work = tree.folders.find((f) => f.path === "work")!;
    const personal = tree.folders.find((f) => f.path === "personal")!;
    expect(work.meetings).toHaveLength(1);
    expect(personal.meetings).toHaveLength(0);
  });

  it("dot-prefix path 는 빈 폴더로도 안 들어옴", () => {
    const tree = buildMeetingsTree([], undefined, [".trash", "notes/.icloud"]);
    expect(tree.folders).toEqual([]);
  });
});

describe("flattenFolderPaths", () => {
  it("root + 깊이 우선 폴더 path 평면화", () => {
    const tree = buildMeetingsTree([
      fakeMeeting("work/2026/jan.md", "jan"),
      fakeMeeting("personal/run.md", "run"),
    ]);
    expect(flattenFolderPaths(tree)).toEqual([
      "",
      "personal",
      "work",
      "work/2026",
    ]);
  });

  it("폴더 0개 → root 만", () => {
    const tree = buildMeetingsTree([fakeMeeting("x.md", "x")]);
    expect(flattenFolderPaths(tree)).toEqual([""]);
  });
});

describe("folderParent", () => {
  it("중첩 → 부모 path", () => {
    expect(folderParent("work/2026")).toBe("work");
  });
  it("최상위 → root('')", () => {
    expect(folderParent("work")).toBe("");
  });
});

describe("canDropFolder", () => {
  it("다른 폴더 아래로 → 가능", () => {
    expect(canDropFolder("work", "personal")).toBe(true);
  });
  it("root 로 (현재 sub) → 가능", () => {
    expect(canDropFolder("work/2026", "")).toBe(true);
  });
  it("root 폴더 자체는 끌 수 없음", () => {
    expect(canDropFolder("", "work")).toBe(false);
  });
  it("자기 자신 위로 → 불가", () => {
    expect(canDropFolder("work", "work")).toBe(false);
  });
  it("자손 폴더 안으로 → 불가 (cycle)", () => {
    expect(canDropFolder("work", "work/2026")).toBe(false);
  });
  it("현재 부모로 (이미 그 안) → 불가 (no-op)", () => {
    expect(canDropFolder("work/2026", "work")).toBe(false);
  });
  it("최상위 폴더를 root 로 (이미 root) → 불가 (no-op)", () => {
    expect(canDropFolder("work", "")).toBe(false);
  });
  it("이름 prefix 만 겹치는 형제는 자손 아님 → 가능", () => {
    // "work" 의 자손은 "work/..." 만. "workshop" 은 별개 폴더.
    expect(canDropFolder("work", "workshop")).toBe(true);
  });
});
