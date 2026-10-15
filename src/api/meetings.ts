import type { VaultAdapter } from "../lib/vault/adapter";
import {
  computeMovedMeetingPath,
  computeRenamedMeetingPath,
  fileToMeeting,
  freshStamp,
  generateMeetingPath,
  isMeetingSidecar,
  meetingFolder,
  meetingMainPath,
  meetingToMainRaw,
  meetingToSummaryRaw,
  meetingToTranscriptRaw,
  moveFolder as _moveFolder,
  moveMeetingToFolder,
  normalizeFolderPath,
  patchMeetingFrontmatter,
  patchMeetingMainBody,
  renameMeetingFiles,
  renameMeetingFolder as _renameMeetingFolder,
  restoreFromTrash,
  scanMeetingFolders,
  scanMeetings,
  scanTrash,
  summaryPath,
  transcriptPath,
  trashFileWithStamp,
  type Meeting,
  type MeetingMeta,
} from "../lib/vault/scan";

export type { Meeting, MeetingMeta };

// V0.5.3 호환 입력 타입 (Insert/Update 형태)
export interface MeetingInsert {
  title?: string | null;
  date?: string | null;
  time?: string | null;
  attendees?: string[] | string | null;
  content?: string | null;
  transcript?: string | null;
  // 마크다운 텍스트 통째. 빈 string / null 이면 sidecar 삭제. V0.7.3 부터 array 3개 → 단일 string.
  summary?: string | null;
  tags?: string[] | null;
  pinned?: boolean | null;
}

export type MeetingUpdate = MeetingInsert;

// createMeeting 전용 입력 — frontmatter/content(MeetingInsert) + 생성 폴더.
// folder 는 update 와 무관 (폴더 이동은 moveMeeting). 빈 문자열/미지정 = root.
export type MeetingCreateInput = MeetingInsert & { folder?: string | null };

function normalizeAttendees(v: MeetingInsert["attendees"]): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function buildMeeting(input: MeetingInsert, id: string, uid: string): Meeting {
  const now = new Date().toISOString();
  return {
    id,
    uid,
    title: input.title ?? "",
    date: input.date ?? null,
    time: input.time ?? null,
    attendees: normalizeAttendees(input.attendees),
    tags: input.tags ?? [],
    pinned: input.pinned ?? false,
    mtime: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    content: input.content ?? "",
    transcript: input.transcript ?? "",
    summary: input.summary ?? "",
  };
}

// 한 회의 sidecar 까지 read 해서 합쳐 반환. sidecar 없으면 그 필드는 빈 값.
//
// iCloud sync footgun: `adapter.exists` 가 false 라도 throw 하지 null 반환 X.
// 이유: iCloud 가 파일을 잠시 evict / 새 버전 download 중이면 exists 가 일시
// false 가 됨. null 반환 시 useQuery detail cache 에 박혀 영구 stuck (list 가
// 다시 refetch 되어도 detail 은 자동 재시도 trigger 없음). throw 하면 React
// Query 가 retry (1·2·4초 backoff) → sync 끝나면 자동 복구. 실제 삭제된 메모는
// retry 3번 다 실패 후 error UI 의 재시도 버튼으로 사용자가 처리.
async function readFullMeeting(
  adapter: VaultAdapter,
  id: string,
): Promise<Meeting> {
  if (!(await adapter.exists(id))) {
    throw new Error(`meeting file unavailable: ${id}`);
  }
  const mainRaw = await adapter.read(id);
  const meta = await adapter.readMeta(id);
  const tPath = transcriptPath(id);
  const sPath = summaryPath(id);
  const transcriptRaw = (await adapter.exists(tPath))
    ? await adapter.read(tPath)
    : "";
  const summaryRaw = (await adapter.exists(sPath))
    ? await adapter.read(sPath)
    : "";
  return fileToMeeting(id, mainRaw, transcriptRaw, summaryRaw, meta.mtime);
}

export async function listMeetings(adapter: VaultAdapter): Promise<Meeting[]> {
  const metas = await scanMeetings(adapter);
  // V0.5.3 호환: Meeting 전체 객체 (본문 포함). 다만 본문은 lazy 가 더 효율적.
  // 일단 meta 만 반환하고 본문은 빈 string. UI 가 useMeeting(id) 로 본문 fetch.
  return metas.map((m): Meeting => ({
    ...m,
    content: "",
    transcript: "",
    summary: "",
  }));
}

export async function listDeletedMeetings(
  adapter: VaultAdapter,
): Promise<Meeting[]> {
  const trashed = await scanTrash(adapter);
  // 메모 메인 파일만 (sidecar 는 메인과 같은 stamp 로 함께 trash 되어 있지만 보여줄 필요 X)
  const meetings: Meeting[] = [];
  for (const { id, deletedAt } of trashed) {
    if (isMeetingSidecar(id)) continue; // sidecar 는 별도로 보여주지 않음
    const base = id.replace(/^\.trash\//, "").replace(
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/,
      "",
    );
    // 순수 YYYY-MM-DD.md 는 일기 → skip, 그 외는 메모.
    if (base.match(/^\d{4}-\d{2}-\d{2}\.md$/)) {
      continue;
    }
    try {
      const raw = await adapter.read(id);
      const meta = await adapter.readMeta(id);
      // trash 안 sidecar 도 같은 stamp 로 같이 들어있을 거라 함께 read 시도
      const tInTrash = id.replace(/\.md$/, ".transcript.md");
      const sInTrash = id.replace(/\.md$/, ".summary.md");
      const transcriptRaw = (await adapter.exists(tInTrash))
        ? await adapter.read(tInTrash)
        : "";
      const summaryRaw = (await adapter.exists(sInTrash))
        ? await adapter.read(sInTrash)
        : "";
      const m = fileToMeeting(id, raw, transcriptRaw, summaryRaw, meta.mtime);
      meetings.push({ ...m, mtime: deletedAt || meta.mtime });
    } catch {
      // skip
    }
  }
  meetings.sort((a, b) => b.mtime - a.mtime);
  return meetings;
}

export async function getMeeting(
  adapter: VaultAdapter,
  id: string,
): Promise<Meeting> {
  return readFullMeeting(adapter, id);
}

export async function createMeeting(
  adapter: VaultAdapter,
  input: MeetingCreateInput,
): Promise<Meeting> {
  const title = input.title ?? "";
  // folder 지정 시 그 폴더 안에 생성 (현재 선택된 메모 폴더 이어받기).
  // 미지정 = `inbox/` (brain 의 미분류 캡처 폴더) — 새 노트가 brain root 에
  // 흩뿌려지지 않도록.
  const folder = input.folder && input.folder.trim() !== "" ? input.folder : "inbox";
  const path = await generateMeetingPath(adapter, title, folder);
  const uid = crypto.randomUUID();
  const meeting = buildMeeting({ ...input, title }, path, uid);

  const mainRaw = meetingToMainRaw(meeting);
  const mainMeta = await adapter.write(path, mainRaw);

  // sidecar 는 내용 있을 때만 생성 (빈 파일 회피)
  const tRaw = meetingToTranscriptRaw(meeting);
  if (tRaw.length > 0) {
    await adapter.write(transcriptPath(path), tRaw);
  }
  const sRaw = meetingToSummaryRaw(meeting);
  if (sRaw.length > 0) {
    await adapter.write(summaryPath(path), sRaw);
  }

  return { ...meeting, mtime: mainMeta.mtime };
}

export async function updateMeeting(
  adapter: VaultAdapter,
  id: string,
  patch: MeetingUpdate,
): Promise<Meeting> {
  if (!(await adapter.exists(id))) {
    throw new Error(`meeting not found: ${id}`);
  }

  // Title 변경 시 파일명 rename (메인 + sidecar 묶음). title 만 frontmatter 에 안 들어가고
  // 파일명이 곧 title — rename only → inode 유지 (옵시디안 모델 동일).
  // rename 후 currentId 가 새 path — 이후 모든 patch 는 currentId 기준.
  let currentId = id;
  if (patch.title !== undefined) {
    const nextTitle = patch.title ?? "";
    const newPath = await computeRenamedMeetingPath(adapter, id, nextTitle);
    if (newPath !== id) {
      await renameMeetingFiles(adapter, id, newPath);
      currentId = newPath;
    }
  }

  // 메인 파일 — frontmatter / content. title 은 frontmatter 에 안 박힘.
  const fmPatch: Record<string, unknown> = {};
  if (patch.date !== undefined) fmPatch.date = patch.date;
  if (patch.time !== undefined) fmPatch.time = patch.time;
  if (patch.attendees !== undefined) {
    fmPatch.attendees = normalizeAttendees(patch.attendees);
  }
  if (patch.tags !== undefined) fmPatch.tags = patch.tags;
  // pinned 가 false 면 frontmatter 키 자체 제거 (옵시디안 호환). patchFrontmatter 가
  // undefined 값은 키 삭제로 처리.
  if (patch.pinned !== undefined) fmPatch.pinned = patch.pinned ? true : undefined;

  const touchesMain =
    Object.keys(fmPatch).length > 0 || patch.content !== undefined;

  if (touchesMain) {
    let raw = await adapter.read(currentId);
    const mainMeta = await adapter.readMeta(currentId);
    if (Object.keys(fmPatch).length > 0) {
      raw = patchMeetingFrontmatter(raw, fmPatch);
    }
    if (patch.content !== undefined) {
      raw = patchMeetingMainBody(raw, patch.content ?? "");
    }
    await adapter.write(currentId, raw, mainMeta.mtime);
  }

  // Transcript sidecar
  if (patch.transcript !== undefined) {
    const tPath = transcriptPath(currentId);
    const next = patch.transcript ?? "";
    if (next.length === 0) {
      if (await adapter.exists(tPath)) {
        await adapter.delete(tPath);
      }
    } else {
      const exists = await adapter.exists(tPath);
      const prevMtime = exists ? (await adapter.readMeta(tPath)).mtime : undefined;
      await adapter.write(tPath, `${next}\n`, prevMtime);
    }
  }

  // Summary sidecar — 마크다운 텍스트 통째.
  if (patch.summary !== undefined) {
    const sPath = summaryPath(currentId);
    const next = (patch.summary ?? "").trim();
    if (next.length === 0) {
      if (await adapter.exists(sPath)) {
        await adapter.delete(sPath);
      }
    } else {
      const exists = await adapter.exists(sPath);
      const prevMtime = exists ? (await adapter.readMeta(sPath)).mtime : undefined;
      const body = next.endsWith("\n") ? next : `${next}\n`;
      await adapter.write(sPath, body, prevMtime);
    }
  }

  return readFullMeeting(adapter, currentId);
}

// Soft delete: 메인 + sidecar 다 같은 stamp 로 .trash/ 이동
export async function deleteMeeting(
  adapter: VaultAdapter,
  id: string,
): Promise<void> {
  const stamp = freshStamp();
  await trashFileWithStamp(adapter, id, stamp);
  const tPath = transcriptPath(id);
  if (await adapter.exists(tPath)) {
    await trashFileWithStamp(adapter, tPath, stamp);
  }
  const sPath = summaryPath(id);
  if (await adapter.exists(sPath)) {
    await trashFileWithStamp(adapter, sPath, stamp);
  }
}

export async function restoreMeeting(
  adapter: VaultAdapter,
  trashId: string,
): Promise<Meeting> {
  // 메인 파일 복원
  const restoredPath = await restoreFromTrash(adapter, trashId);
  // 같은 stamp 의 sidecar 도 복원 시도
  const stampMatch = trashId.match(
    /^\.trash\/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-(.+)\.md$/,
  );
  if (stampMatch) {
    const [, stamp, base] = stampMatch;
    for (const suffix of ["transcript", "summary"]) {
      const sidecarTrash = `.trash/${stamp}-${base}.${suffix}.md`;
      if (await adapter.exists(sidecarTrash)) {
        await restoreFromTrash(adapter, sidecarTrash);
      }
    }
  }
  return readFullMeeting(adapter, restoredPath);
}

// 영구 삭제 (휴지통에서만) — 메인 + 같은 stamp sidecar 도 함께 삭제
export async function purgeMeeting(
  adapter: VaultAdapter,
  trashId: string,
): Promise<void> {
  await adapter.delete(trashId);
  const stampMatch = trashId.match(
    /^\.trash\/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-(.+)\.md$/,
  );
  if (stampMatch) {
    const [, stamp, base] = stampMatch;
    for (const suffix of ["transcript", "summary"]) {
      const sidecarTrash = `.trash/${stamp}-${base}.${suffix}.md`;
      if (await adapter.exists(sidecarTrash)) {
        await adapter.delete(sidecarTrash);
      }
    }
  }
}

// 휴지통 비우기 — .trash/ 의 메인 메모 + sidecar 모두 영구 삭제.
// sidecar 가 메인보다 먼저 삭제돼도 purgeMeeting 의 exists 검사가 흡수.
export async function emptyTrash(adapter: VaultAdapter): Promise<void> {
  const files = await adapter.list(".trash");
  const mainFiles = files.filter(
    (p) => p.endsWith(".md") && !isMeetingSidecar(p),
  );
  for (const main of mainFiles) {
    try {
      await purgeMeeting(adapter, main);
    } catch {
      // 한 파일 실패해도 나머지 진행 — UI 가 다시 list 받아 잔여 표시
    }
  }
  // sidecar 만 단독으로 남아있는 경우 (이상 케이스) 청소
  const remaining = await adapter.list(".trash");
  for (const p of remaining) {
    if (p.endsWith(".md")) {
      try {
        await adapter.delete(p);
      } catch {
        // skip
      }
    }
  }
}

// 폴더 이동 — title 유지, 폴더만 swap. newFolder "" 은 root (notes/{title}.md).
// 같은 폴더 (no-op) 이면 read-only 로 현재 상태 반환. 충돌 시 TitleConflictError throw —
// UI 가 toast 띄움 (rename 충돌과 동일 패턴).
export async function moveMeeting(
  adapter: VaultAdapter,
  id: string,
  newFolder: string,
): Promise<Meeting> {
  if (!(await adapter.exists(id))) {
    throw new Error(`meeting not found: ${id}`);
  }
  const newPath = await computeMovedMeetingPath(adapter, id, newFolder);
  if (newPath !== id) {
    await moveMeetingToFolder(adapter, id, newPath);
  }
  return readFullMeeting(adapter, newPath);
}

// 빈 폴더 list — 사이드바 트리가 메모 없는 폴더도 보여주도록.
// vault root 기준 path (e.g. "notes/work", "notes/work/2026") 반환.
export async function listMeetingFolders(
  adapter: VaultAdapter,
): Promise<string[]> {
  return scanMeetingFolders(adapter);
}

// 폴더 안 메모 개수 (sub-folder 포함). UI 의 confirm 다이얼로그에 "메모 N개" 표시.
export async function countMeetingsInFolder(
  adapter: VaultAdapter,
  folderPath: string,
): Promise<number> {
  const normalized = normalizeFolderPath(folderPath);
  if (normalized === "") return 0;
  const full = normalized;
  const files = await adapter.listRecursive(full);
  return files.filter(
    (p) => p.endsWith(".md") && !isMeetingSidecar(p),
  ).length;
}

// 폴더 삭제 — 안 메모 (sub-folder 포함 재귀) 를 휴지통으로 soft delete + 빈 디렉토리
// 자체는 disk 에서 recursive remove. 메모는 .trash/ 에 같은 stamp 묶음으로 가있어
// 휴지통 modal 에서 복원 가능 (단, 폴더 구조는 복원 시 root 로 — V0.7.1 trash
// 모델: 파일명만 보존). 빈 폴더면 즉시 disk 삭제만.
export async function deleteMeetingFolder(
  adapter: VaultAdapter,
  folderPath: string,
): Promise<{ trashed: number }> {
  const normalized = normalizeFolderPath(folderPath);
  if (normalized === "") {
    throw new Error("root 폴더는 삭제할 수 없습니다");
  }
  const full = normalized;
  if (!(await adapter.exists(full))) {
    return { trashed: 0 };
  }
  const inside = await adapter.listRecursive(full);
  const mains = inside.filter(
    (p) => p.endsWith(".md") && !isMeetingSidecar(p),
  );
  for (const m of mains) {
    try {
      await deleteMeeting(adapter, m);
    } catch (err) {
      // 한 메모 실패해도 나머지 진행 — 사용자가 정리 후 다시 시도 가능.
      console.warn(`[deleteMeetingFolder] skip ${m}:`, err);
    }
  }
  // 안에 남아있는 잡파일 (sidecar 잔존, sync 부산물 등) + 빈 폴더 자체 정리.
  try {
    await adapter.delete(full, { recursive: true });
  } catch (err) {
    console.warn(`[deleteMeetingFolder] rmdir 실패 ${full}:`, err);
  }
  return { trashed: mains.length };
}

// 사용자가 명시적으로 만든 폴더 — disk 에 mkdir. 즉시 사이드바에 보임.
// 충돌 시 (이미 있는 폴더) 조용히 통과 (mkdir 자체가 idempotent).
// 빈 segment / path traversal 은 normalizeFolderPath 가 차단.
export async function createMeetingFolder(
  adapter: VaultAdapter,
  folderPath: string,
): Promise<string> {
  const normalized = normalizeFolderPath(folderPath);
  if (normalized === "") {
    throw new Error("폴더 이름이 비어있습니다");
  }
  const full = normalized;
  await adapter.mkdir(full);
  return full;
}

// 폴더 이름 변경 — 부모 path 유지, 마지막 segment 만 바꿈. 안 메모는 디스크
// rename 으로 자동 따라옴. 충돌 시 TitleConflictError throw.
export async function renameMeetingFolder(
  adapter: VaultAdapter,
  oldFolder: string,
  newName: string,
): Promise<string> {
  return _renameMeetingFolder(adapter, oldFolder, newName);
}

// 폴더를 다른 폴더 아래로 이동 (위계 이동). 안 메모·sub-folder 통째 따라옴.
// destParent "" = root. 충돌 시 TitleConflictError, cycle 시 일반 Error throw.
export async function moveMeetingFolder(
  adapter: VaultAdapter,
  srcFolder: string,
  destParent: string,
): Promise<string> {
  return _moveFolder(adapter, srcFolder, destParent);
}

// re-export — watcher / 외부 호환 + sidebar 트리 빌더
export { meetingMainPath, isMeetingSidecar, meetingFolder };
