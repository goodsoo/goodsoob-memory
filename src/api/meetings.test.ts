import { describe, it, expect } from "vitest";
import {
  countMeetingsInFolder,
  createMeeting,
  createMeetingFolder,
  deleteMeetingFolder,
  listMeetingFolders,
  listMeetings,
  moveMeeting,
  moveMeetingFolder,
  renameMeetingFolder,
  updateMeeting,
  getMeeting,
  deleteMeeting,
  undoDeleteMeeting,
  restoreMeeting,
  listDeletedMeetings,
} from "./meetings";
import { createMemoryAdapter } from "../lib/vault/adapter";

describe("createMeetingFolder", () => {
  it("disk 에 mkdir → listMeetingFolders 에 잡힘", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await createMeetingFolder(adapter, "work");
    const folders = await listMeetingFolders(adapter);
    expect(folders).toContain("work");
  });

  it("빈 입력 → throw", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await expect(createMeetingFolder(adapter, "  ")).rejects.toThrow();
  });

  it("중첩 폴더 mkdir (work/2026) → 중간 폴더도 잡힘", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await createMeetingFolder(adapter, "work/2026");
    const folders = await listMeetingFolders(adapter);
    expect(folders.sort()).toEqual(["work", "work/2026"]);
  });

  it("path traversal 차단", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await expect(createMeetingFolder(adapter, "../leak")).rejects.toThrow();
  });
});

describe("createMeeting — folder", () => {
  it("folder 미지정 → inbox (inbox/{slug}.md)", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    const m = await createMeeting(adapter, { title: "회의" });
    expect(m.id).toBe("inbox/회의.md");
  });

  it("folder 지정 → 그 폴더 안에 생성", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    const m = await createMeeting(adapter, { title: "주간", folder: "work" });
    expect(m.id).toBe("work/주간.md");
  });

  it("중첩 폴더 그대로 이어받음", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    const m = await createMeeting(adapter, {
      title: "메모",
      folder: "work/2026",
    });
    expect(m.id).toBe("work/2026/메모.md");
  });

  it("같은 폴더 안 같은 title → -2 suffix (충돌 회피)", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await createMeeting(adapter, { title: "a", folder: "work" });
    const dup = await createMeeting(adapter, { title: "a", folder: "work" });
    expect(dup.id).toBe("work/a-2.md");
  });

  it("folder 는 frontmatter 오염 X (파일 본문에 folder 키 없음)", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    const m = await createMeeting(adapter, { title: "x", folder: "work" });
    const raw = await adapter.read(m.id);
    expect(raw).not.toMatch(/folder:/);
  });
});

describe("countMeetingsInFolder", () => {
  it("폴더 안 + sub-folder 메모 카운트, sidecar 제외", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await createMeeting(adapter, { title: "a" }); // root
    await createMeeting(adapter, { title: "b" }); // root
    // 폴더 안 메모는 move 로 옮김
    const moved = await createMeeting(adapter, { title: "c" });
    await moveMeeting(adapter, moved.id, "work");
    const nested = await createMeeting(adapter, { title: "d" });
    await moveMeeting(adapter, nested.id, "work/2026");

    expect(await countMeetingsInFolder(adapter, "work")).toBe(2);
    expect(await countMeetingsInFolder(adapter, "work/2026")).toBe(1);
    expect(await countMeetingsInFolder(adapter, "personal")).toBe(0);
  });
});

describe("renameMeetingFolder", () => {
  it("root 폴더 이름 변경 — 안 메모도 새 path 로", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    const m = await createMeeting(adapter, { title: "note" });
    await moveMeeting(adapter, m.id, "work");
    const newFull = await renameMeetingFolder(adapter, "work", "프로젝트");
    expect(newFull).toBe("프로젝트");
    const list = await listMeetings(adapter);
    expect(list[0].id).toBe("프로젝트/note.md");
    expect(await adapter.exists("work/note.md")).toBe(false);
  });

  it("sub-folder 이름 변경 — 부모 path 유지", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    const m = await createMeeting(adapter, { title: "x" });
    await moveMeeting(adapter, m.id, "work/2026");
    const newFull = await renameMeetingFolder(adapter, "work/2026", "2027");
    expect(newFull).toBe("work/2027");
    const list = await listMeetings(adapter);
    expect(list[0].id).toBe("work/2027/x.md");
  });

  it("같은 부모 안 다른 폴더와 충돌 → throw", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await createMeetingFolder(adapter, "work");
    await createMeetingFolder(adapter, "personal");
    await expect(
      renameMeetingFolder(adapter, "work", "personal"),
    ).rejects.toThrow();
  });

  it("root 폴더 이름 변경 시도 → throw", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await expect(renameMeetingFolder(adapter, "", "new")).rejects.toThrow();
  });

  it("빈 새 이름 → throw", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await createMeetingFolder(adapter, "work");
    await expect(renameMeetingFolder(adapter, "work", "  ")).rejects.toThrow();
  });

  it("빈 폴더도 이름 변경 가능 (mkdir set 만 있는 케이스)", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await createMeetingFolder(adapter, "old");
    await renameMeetingFolder(adapter, "old", "new");
    const folders = await listMeetingFolders(adapter);
    expect(folders).toContain("new");
    expect(folders).not.toContain("old");
  });
});

describe("moveMeetingFolder", () => {
  it("폴더를 다른 폴더 아래로 — 안 메모·sub-folder 통째 따라옴", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    const m = await createMeeting(adapter, { title: "note" });
    await moveMeeting(adapter, m.id, "work");
    await createMeetingFolder(adapter, "personal");
    const newFull = await moveMeetingFolder(adapter, "work", "personal");
    expect(newFull).toBe("personal/work");
    const list = await listMeetings(adapter);
    expect(list[0].id).toBe("personal/work/note.md");
    expect(await adapter.exists("work/note.md")).toBe(false);
  });

  it("폴더를 root 로 — destParent 빈 문자열", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    const m = await createMeeting(adapter, { title: "x" });
    await moveMeeting(adapter, m.id, "work/2026");
    const newFull = await moveMeetingFolder(adapter, "work/2026", "");
    expect(newFull).toBe("2026");
    const list = await listMeetings(adapter);
    expect(list[0].id).toBe("2026/x.md");
  });

  it("자기 자신 위로 → throw (cycle)", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await createMeetingFolder(adapter, "work");
    await expect(moveMeetingFolder(adapter, "work", "work")).rejects.toThrow();
  });

  it("자손 폴더 안으로 → throw (cycle)", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await createMeetingFolder(adapter, "work/2026");
    await expect(
      moveMeetingFolder(adapter, "work", "work/2026"),
    ).rejects.toThrow();
  });

  it("대상에 동명 폴더 존재 → throw (충돌)", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await createMeetingFolder(adapter, "work");
    await createMeetingFolder(adapter, "personal/work");
    await expect(
      moveMeetingFolder(adapter, "work", "personal"),
    ).rejects.toThrow();
  });

  it("현재 부모로 이동 → no-op (현재 path 반환)", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await createMeetingFolder(adapter, "work/2026");
    const same = await moveMeetingFolder(adapter, "work/2026", "work");
    expect(same).toBe("work/2026");
  });

  it("root 폴더 이동 시도 → throw", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await expect(moveMeetingFolder(adapter, "", "work")).rejects.toThrow();
  });
});

describe("deleteMeetingFolder", () => {
  it("빈 폴더 → disk 에서 사라짐 + trashed 0", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await createMeetingFolder(adapter, "empty");
    const result = await deleteMeetingFolder(adapter, "empty");
    expect(result.trashed).toBe(0);
    const folders = await listMeetingFolders(adapter);
    expect(folders).not.toContain("empty");
  });

  it("메모 있는 폴더 → 메모 휴지통 이동 + 디스크 dir 삭제", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    const m = await createMeeting(adapter, { title: "note" });
    await moveMeeting(adapter, m.id, "work");
    // sanity: 폴더 안에 1개 있음
    expect(await countMeetingsInFolder(adapter, "work")).toBe(1);

    const result = await deleteMeetingFolder(adapter, "work");
    expect(result.trashed).toBe(1);

    // active list 에서 사라짐, 휴지통에 등장
    const active = await listMeetings(adapter);
    expect(active).toHaveLength(0);
    // 폴더도 사라짐
    const folders = await listMeetingFolders(adapter);
    expect(folders).not.toContain("work");
    // .trash 안에 stamped 파일 존재
    const trashFiles = await adapter.list(".trash");
    expect(trashFiles.length).toBeGreaterThanOrEqual(1);
  });

  it("root 폴더 삭제 시도 → throw (방어)", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await expect(deleteMeetingFolder(adapter, "")).rejects.toThrow();
  });

  it("sub-folder 안 메모도 재귀적으로 휴지통 이동", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    const m1 = await createMeeting(adapter, { title: "a" });
    await moveMeeting(adapter, m1.id, "work");
    const m2 = await createMeeting(adapter, { title: "b" });
    await moveMeeting(adapter, m2.id, "work/2026");

    const result = await deleteMeetingFolder(adapter, "work");
    expect(result.trashed).toBe(2);
    const folders = await listMeetingFolders(adapter);
    expect(folders).toEqual([]);
  });
});

describe("frontmatter audio", () => {
  const raw = (fm: string) => `---\nid: u-1\n${fm}---\n본문\n`;

  it("list/full/trash 모두 audio 노출, 저장 시 audio 보존, 없는 파일엔 안 씀", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await adapter.write("inbox/a.md", raw("audio:\n  - rec-1\n  - 2026\n"));
    await adapter.write("inbox/b.md", raw("").replace("u-1", "u-2"));

    const list = await listMeetings(adapter);
    expect(list.find((m) => m.id === "inbox/a.md")?.audio).toEqual(["rec-1", "2026"]);
    expect(list.find((m) => m.id === "inbox/b.md")?.audio).toEqual([]);

    await updateMeeting(adapter, "inbox/a.md", {
      content: "수정",
      tags: ["x"],
      pinned: true,
      date: "2026-01-01",
    });
    await updateMeeting(adapter, "inbox/b.md", { content: "수정", pinned: true });
    const a = await getMeeting(adapter, "inbox/a.md");
    expect(a.audio).toEqual(["rec-1", "2026"]);
    expect(a.content).toContain("수정");
    expect(await adapter.read("inbox/a.md")).toContain("audio:");
    expect(await adapter.read("inbox/b.md")).not.toContain("audio");

    const trashId = await deleteMeeting(adapter, "inbox/a.md");
    const trashed = await listDeletedMeetings(adapter);
    expect(trashed[0].audio).toEqual(["rec-1", "2026"]);
    // 되돌리기 토스트(DS U2): deleteMeeting 이 돌려준 trashId 로 바로 복원된다.
    expect(trashId).toBe(trashed[0].id);
    // 되돌리기는 원래 폴더 자리로(휴지통 복원은 root).
    const restored = await undoDeleteMeeting(adapter, trashId, "inbox/a.md");
    expect(restored.audio).toEqual(["rec-1", "2026"]);
    expect(await adapter.exists("inbox/a.md")).toBe(true);
    expect(await adapter.exists(trashId)).toBe(false);
  });
});

describe("휴지통 복원 — 원래 폴더로 (trashed_from)", () => {
  const raw = (id: string) => `---\nid: ${id}\n---\n본문\n`;

  it("지울 때 원래 경로를 기록하고, 휴지통 복원이 그 폴더로 되돌린다(기록은 지움)", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await adapter.write("work/proj/a.md", raw("u-1"));
    await adapter.write("work/proj/a.transcript.md", "전사\n");
    const trashId = await deleteMeeting(adapter, "work/proj/a.md");
    expect(await adapter.read(trashId)).toContain("trashed_from: work/proj/a.md");

    const restored = await restoreMeeting(adapter, trashId);
    expect(restored.id).toBe("work/proj/a.md");
    expect(await adapter.exists("work/proj/a.transcript.md")).toBe(true);
    expect(await adapter.read("work/proj/a.md")).not.toContain("trashed_from");
  });

  it("원래 자리에 다른 파일이 생겼으면 root 로(충돌 회피)", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await adapter.write("work/a.md", raw("u-1"));
    const trashId = await deleteMeeting(adapter, "work/a.md");
    await adapter.write("work/a.md", raw("u-2"));
    const restored = await restoreMeeting(adapter, trashId);
    expect(restored.id).toBe("a.md");
    expect(await adapter.read("a.md")).not.toContain("trashed_from");
  });

  it("기록 없는 옛 휴지통 항목은 예전처럼 root 로", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    await adapter.write(".trash/2026-01-01T00-00-00-old.md", raw("u-9"));
    const restored = await restoreMeeting(adapter, ".trash/2026-01-01T00-00-00-old.md");
    expect(restored.id).toBe("old.md");
  });

  it("frontmatter 가 손상된 메모는 기록하지 않는다(손상분 보존) → root 복원", async () => {
    const adapter = createMemoryAdapter();
    adapter.setRoot("/vault");
    const broken = "---\nid: [u-1\n---\n본문\n";
    await adapter.write("work/b.md", broken);
    const trashId = await deleteMeeting(adapter, "work/b.md");
    expect(await adapter.read(trashId)).toBe(broken);
  });
});
