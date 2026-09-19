import type { VaultAdapter } from "./adapter";
import {
  parseVaultFile,
  serializeVaultFile,
  patchFrontmatter,
  patchBody,
} from "./parser";
import { extractTasks, type TaskItem } from "./tasks";
import { buildEventLine, SCHEDULE_PATH } from "./schedule";

// ─────────────────────────────────────────────────────────────────────────────
// Types — UI/hooks 가 다루는 형태

export interface MeetingMeta {
  id: string; // 메인 파일 path (e.g. "notes/2026-05-16-팀-주간회의.md")
  uid: string; // frontmatter 의 영구 id (uuid). path 변해도 그대로. cache key 의 진실.
  title: string;
  date: string | null;
  time: string | null;
  attendees: string[];
  tags: string[];
  // 즐겨찾기 — frontmatter `pinned: true`. 옵시디안 community 표준 (bookmarks /
  // pin-it-to-the-top 등) 과 호환. 사이드바 상단에 별도 그룹으로 고정.
  pinned: boolean;
  mtime: number;
  // V0.5.3 호환 필드 (UI 가 의존). vault 에선 파일 mtime 사용.
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Meeting extends MeetingMeta {
  content: string;
  transcript: string;
  // 요약 sidecar (`.summary.md`) 의 raw 마크다운 본문. 외부 Claude 응답이 그대로 들어옴.
  // UI 에서 본문과 동일한 SourceBodyEditor 로 편집. 빈 string 면 sidecar 파일 없음.
  summary: string;
}

export interface JournalMeta {
  id: string; // file path
  uid: string; // frontmatter `id` 영구 식별자 (uuid). 메모와 동일 모델.
  date: string;
  mtime: number;
}

export interface Journal extends JournalMeta {
  content: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidecar path helpers — 메인 파일과 같은 폴더에 `.transcript.md` / `.summary.md`.
// 한 회의 = 3 파일. sidecar 는 frontmatter 없는 raw markdown.
// 본문 안에 사용자가 `# 본문` 같은 H1 적어도 충돌 0 (in-band sentinel X).

export function transcriptPath(mainPath: string): string {
  return mainPath.replace(/\.md$/, ".transcript.md");
}

export function summaryPath(mainPath: string): string {
  return mainPath.replace(/\.md$/, ".summary.md");
}

const SIDECAR_RE = /\.(transcript|summary)\.md$/;

export function isMeetingSidecar(path: string): boolean {
  return SIDECAR_RE.test(path);
}

export function meetingMainPath(path: string): string {
  return path.replace(SIDECAR_RE, ".md");
}

// iCloud / Dropbox / OneDrive 등 sync 도구가 동기화 중 생성하는 부산물 파일.
// scan 대상에서 제외 — 사이드바에 노이즈로 뜨거나 read 가 실패해 메모 행세하지
// 않도록.
//   - "(conflicted copy ...)" / "(Mac's conflicted copy ...)" — iCloud/Dropbox
//   - ".foo.md.icloud" — iCloud evicted placeholder (dot prefix)
//   - dot prefix 일반 — OS 메타 파일 (.DS_Store 등)
const SYNC_NOISE_RE = /\(conflicted copy|\(conflict[^/]*\d{4}-\d{2}-\d{2}/i;
export function isSyncNoiseFile(path: string): boolean {
  // 파일명만 검사 — 폴더 경로에 dot 있어도 상관 X.
  const name = path.split("/").pop() ?? path;
  if (name.startsWith(".")) return true;
  if (name.endsWith(".icloud")) return true;
  return SYNC_NOISE_RE.test(name);
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontmatter helpers

function fmString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function fmStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string" && value.trim() !== "") {
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function fmBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "yes" || v === "1";
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// File → Meeting/Journal

// 메인 파일 + 두 sidecar raw 받아서 합쳐서 Meeting 객체. sidecar 가 없으면 빈 string.
export function fileToMeeting(
  filePath: string,
  mainRaw: string,
  transcriptRaw: string,
  summaryRaw: string,
  mtime: number,
): Meeting {
  const main = parseVaultFile(mainRaw);
  const fm = main.frontmatter;
  const isoMtime = new Date(mtime || Date.now()).toISOString();
  const isInTrash = filePath.startsWith(".trash/");

  const uid = fmString(fm.id);
  if (!uid) throw new Error(`missing frontmatter id: ${filePath}`);

  return {
    id: filePath,
    uid,
    title: filePathToTitle(filePath),
    date: fmString(fm.date),
    time: fmString(fm.time),
    attendees: fmStringArray(fm.attendees),
    tags: fmStringArray(fm.tags),
    pinned: fmBoolean(fm.pinned),
    mtime,
    created_at: isoMtime,
    updated_at: isoMtime,
    deleted_at: isInTrash ? isoMtime : null,
    content: main.body,
    transcript: transcriptOrSummaryBody(transcriptRaw),
    summary: transcriptOrSummaryBody(summaryRaw),
  };
}

// sidecar 파일은 일반적으로 frontmatter 없는 raw markdown. 다만 외부 에디터가 frontmatter 끼워넣어도
// 본문만 회수.
function transcriptOrSummaryBody(raw: string): string {
  if (!raw) return "";
  return parseVaultFile(raw).body;
}

export function fileToJournal(
  filePath: string,
  raw: string,
  mtime: number,
): Journal {
  const file = parseVaultFile(raw);
  const fm = file.frontmatter;
  const uid = fmString(fm.id);
  if (!uid) throw new Error(`missing frontmatter id: ${filePath}`);
  return {
    id: filePath,
    uid,
    date: fmString(fm.date) ?? filePathToDate(filePath),
    mtime,
    content: file.body,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Build Meeting → 3 raw files

export function meetingToMainRaw(meeting: Meeting): string {
  // title 은 파일명이 곧 title — frontmatter 안 박음. title 변경 = pure disk rename →
  // inode 유지 (옵시디안 모델 정확 일치). frontmatter patch write 안 발사.
  const frontmatter: Record<string, unknown> = {
    id: meeting.uid, // 옵시디안 community 표준 (obsidian-unique-identifiers 등) — frontmatter `id` 가 영구 식별자.
  };
  if (meeting.date) frontmatter.date = meeting.date;
  if (meeting.time) frontmatter.time = meeting.time;
  if (meeting.attendees.length > 0) frontmatter.attendees = meeting.attendees;
  if (meeting.tags.length > 0) frontmatter.tags = meeting.tags;
  // pinned 는 true 일 때만 박음 — false 면 frontmatter 자체에서 제거 (옵시디안 다른
  // pin 플러그인들과 mutual: 우리 앱이 false 박아두면 사용자가 옵시디안에서 pin 해도
  // 다음 write 때 사라짐). default = absent 가 곧 false.
  if (meeting.pinned) frontmatter.pinned = true;

  return serializeVaultFile({
    raw: "",
    frontmatter,
    body: meeting.content,
  });
}

export function meetingToTranscriptRaw(meeting: Meeting): string {
  return meeting.transcript.length > 0 ? `${meeting.transcript}\n` : "";
}

export function meetingToSummaryRaw(meeting: Meeting): string {
  // summary 가 비어있으면 sidecar 파일 자체를 안 만듦.
  if (meeting.summary.length === 0) return "";
  // trailing newline 1개 보장 (POSIX style + 옵시디안 자동 추가 호환).
  return meeting.summary.endsWith("\n") ? meeting.summary : `${meeting.summary}\n`;
}

export function journalToRaw(journal: Journal): string {
  const frontmatter: Record<string, unknown> = {
    id: journal.uid, // 메모와 동일 — 영구 식별자.
    date: journal.date,
  };
  return serializeVaultFile({
    raw: "",
    frontmatter,
    body: journal.content,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch helpers — 부분 patch. meetings.ts api 가 사용.

export function patchMeetingMainBody(raw: string, newContent: string): string {
  return patchBody(raw, newContent);
}

export function patchMeetingFrontmatter(
  raw: string,
  updates: Record<string, unknown>,
): string {
  return patchFrontmatter(raw, updates);
}

// ─────────────────────────────────────────────────────────────────────────────
// Filename helpers

// 파일시스템 금지 문자 (`/ \ : * ? " < > |`) + 옵시디안 link syntax 와 충돌하는
// 문자 (`# ^ [ ] |`) 는 `-` 로 치환. NUL/제어문자 (\x00-\x1f) 도 제거.
// 빈 결과 → "untitled" fallback. 100자 cap.
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_RE = /[\x00-\x1f/\\:*?"<>|#^[\]]/g;

export function slugify(title: string): string {
  let s = title.replace(UNSAFE_FILENAME_RE, "-");
  // 앞뒤 dot/공백 제거 — Windows trim + macOS dotfile 회피
  s = s.replace(/^[.\s]+|[.\s]+$/g, "");
  if (s.length > 200) s = s.slice(0, 200).replace(/[.\s]+$/, "");
  return s || "untitled";
}

function filePathToTitle(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  return base.replace(/\.md$/, "");
}

function filePathToDate(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  const m = base.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

// 메모 경로에서 폴더 부분 추출. `notes/foo.md` → `""`, `notes/work/foo.md`
// → `"work"`, `notes/work/2026/foo.md` → `"work/2026"`. id 가 `notes/` 로
// 시작 안 하면 빈 문자열 (방어).
export function meetingFolder(meetingPath: string): string {
  if (!meetingPath.startsWith("notes/")) return "";
  const rest = meetingPath.slice("notes/".length);
  const lastSlash = rest.lastIndexOf("/");
  if (lastSlash === -1) return "";
  return rest.slice(0, lastSlash);
}

// `notes/{folder?}/{slug}.md` 빌더. folder 가 빈 문자열이면 root.
function buildMeetingPath(folder: string, slug: string): string {
  const f = folder.replace(/^\/+|\/+$/g, "");
  return f === "" ? `notes/${slug}.md` : `notes/${f}/${slug}.md`;
}

// 폴더 path 정규화 + 검증. 외부 슬래시 trim, `..` 차단, segment 별 slugify 적용
// (UNSAFE_FILENAME_RE 동일 규칙). 빈 segment 는 squash.
// 빈 문자열 입력 → 빈 문자열 출력 (root).
export function normalizeFolderPath(folder: string): string {
  const trimmed = folder.replace(/^\/+|\/+$/g, "").trim();
  if (trimmed === "") return "";
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.some((p) => p === "..")) {
    throw new Error(`folder path traversal blocked: ${folder}`);
  }
  return parts.map((p) => slugify(p)).join("/");
}

// notes/{folder?}/{slug}.md — date 없음. date 는 순수 frontmatter optional.
// 새 메모 default ("untitled") 충돌 시만 -2 suffix. 사용자 명시 title 의 충돌은
// computeRenamedMeetingPath 가 throw 로 처리 (자동 -2 안 함).
export async function generateMeetingPath(
  adapter: VaultAdapter,
  title: string,
  folder = "",
): Promise<string> {
  const slug = slugify(title);
  const f = normalizeFolderPath(folder);
  let candidate = buildMeetingPath(f, slug);
  let n = 2;
  while (await adapter.exists(candidate)) {
    candidate = buildMeetingPath(f, `${slug}-${n}`);
    n++;
  }
  return candidate;
}

// title 변경 전용 충돌 에러. 사용자가 toast 보고 다른 title 로 재시도.
export class TitleConflictError extends Error {
  slug: string;
  path: string;
  constructor(slug: string, path: string) {
    super(`title already in use: ${slug}`);
    this.name = "TitleConflictError";
    this.slug = slug;
    this.path = path;
  }
}

// title 변경 시 새 path 계산. 같으면 currentId 반환 (no-op).
// 다른 메모와 충돌 시 throw — 사용자가 다른 title 로 재시도해야 함.
// 자동 -2 suffix 안 함 (의도된 title 과 다른 파일명을 silently 만들지 않기 위해).
// 폴더는 currentId 에서 유지 — title rename 으로 폴더가 바뀌진 않음 (별도 move API).
export async function computeRenamedMeetingPath(
  adapter: VaultAdapter,
  currentId: string,
  newTitle: string,
): Promise<string> {
  const slug = slugify(newTitle);
  const folder = meetingFolder(currentId);
  const target = buildMeetingPath(folder, slug);
  if (target === currentId) return currentId;
  if (await adapter.exists(target)) {
    throw new TitleConflictError(slug, target);
  }
  return target;
}

// 같은 title 그대로 둔 채 폴더만 이동. newFolder 가 currentId 와 같은 폴더면 no-op.
// 충돌 시 throw (같은 folder 안에 같은 title 메모 존재).
export async function computeMovedMeetingPath(
  adapter: VaultAdapter,
  currentId: string,
  newFolder: string,
): Promise<string> {
  if (!currentId.startsWith("notes/")) {
    throw new Error(`not a meeting path: ${currentId}`);
  }
  const base = currentId.split("/").pop() ?? "";
  const slug = base.replace(/\.md$/, "");
  const target = buildMeetingPath(normalizeFolderPath(newFolder), slug);
  if (target === currentId) return currentId;
  if (await adapter.exists(target)) {
    throw new TitleConflictError(slug, target);
  }
  return target;
}

// 폴더 이동 — 메인 + sidecar 한 묶음 rename. 새 폴더가 디스크에 없으면 mkdir 선행.
// computeMovedMeetingPath 가 throw 안 한 케이스 (충돌 X) 만 호출.
export async function moveMeetingToFolder(
  adapter: VaultAdapter,
  oldPath: string,
  newPath: string,
): Promise<void> {
  if (oldPath === newPath) return;
  // newPath 의 부모 폴더 (`notes/{folder}` 또는 `notes`) mkdir 보장.
  // Tauri rename 은 부모가 없으면 실패.
  const parentSlash = newPath.lastIndexOf("/");
  if (parentSlash > 0) {
    const parent = newPath.slice(0, parentSlash);
    await adapter.mkdir(parent);
  }
  await renameMeetingFiles(adapter, oldPath, newPath);
}

// 폴더 자체의 마지막 segment 이름만 바꿈. 부모 path 유지 — 위계 이동 X.
// "work" → "프로젝트" (root 폴더 rename), "work/2026" → "work/2027" (sub-folder rename).
// 안에 있는 메모는 디스크 rename 으로 자동 따라옴 (POSIX mv). 충돌 시 throw.
// oldFolder 는 notes-relative ("work" 또는 "work/2026"), newName 은 새 마지막 segment.
// 반환: 새 vault-relative path ("notes/프로젝트").
export async function renameMeetingFolder(
  adapter: VaultAdapter,
  oldFolder: string,
  newName: string,
): Promise<string> {
  const normalized = normalizeFolderPath(oldFolder);
  if (normalized === "") {
    throw new Error("root 폴더는 이름을 바꿀 수 없습니다");
  }
  const newSeg = slugify(newName);
  if (newSeg === "" || newSeg === "untitled") {
    throw new Error("폴더 이름이 비어있습니다");
  }
  const lastSlash = normalized.lastIndexOf("/");
  const parent = lastSlash === -1 ? "" : normalized.slice(0, lastSlash);
  const newRel = parent === "" ? newSeg : `${parent}/${newSeg}`;
  if (newRel === normalized) return `notes/${normalized}`;
  const oldFull = `notes/${normalized}`;
  const newFull = `notes/${newRel}`;
  if (await adapter.exists(newFull)) {
    throw new TitleConflictError(newSeg, newFull);
  }
  // 부모 폴더가 사라진 경우 (외부 삭제 등) 만 mkdir. parent === "" 이면 notes/ 가 부모.
  await adapter.mkdir(parent === "" ? "notes" : `notes/${parent}`);
  await adapter.rename(oldFull, newFull);
  return newFull;
}

// 폴더 자체를 다른 폴더 아래로 이동 — 위계 이동. rename(마지막 segment 만 바꿈)과
// 달리 부모 path 가 바뀐다. 안 메모·sub-folder 는 disk rename (POSIX mv) 으로 통째
// 따라옴 (adapter.rename 의 디렉토리 케이스). 이름은 유지.
// srcFolder: 옮길 폴더 (notes-relative, "work" 또는 "work/2026").
// destParent: 새 부모 폴더 (notes-relative, "" = root).
// 반환: 새 vault-relative path ("notes/personal/work").
// 가드: root 이동 X / 자기 자신·자손으로 이동 X (cycle) / 대상에 동명 폴더 있으면 throw.
export async function moveFolder(
  adapter: VaultAdapter,
  srcFolder: string,
  destParent: string,
): Promise<string> {
  const src = normalizeFolderPath(srcFolder);
  if (src === "") {
    throw new Error("root 폴더는 이동할 수 없습니다");
  }
  const dest = normalizeFolderPath(destParent);
  // cycle 가드 — 자기 자신 또는 자기 자손 폴더 안으로는 못 옮긴다 (mv 가 부모를
  // 자식 밑으로 넣는 순환). dest === src 또는 dest 가 src 의 자손.
  if (dest === src || dest.startsWith(src + "/")) {
    throw new Error("폴더를 자기 자신이나 하위 폴더로 옮길 수 없습니다");
  }
  const name = src.split("/").pop() ?? src;
  const newRel = dest === "" ? name : `${dest}/${name}`;
  const oldFull = `notes/${src}`;
  // 이미 그 부모 안에 있으면 no-op (현재 부모 위로 drop).
  if (newRel === src) return oldFull;
  if (!(await adapter.exists(oldFull))) {
    throw new Error(`folder not found: ${oldFull}`);
  }
  const newFull = `notes/${newRel}`;
  if (await adapter.exists(newFull)) {
    throw new TitleConflictError(name, newFull);
  }
  // 대상 부모 폴더 보장 (Tauri rename 은 부모가 없으면 실패).
  await adapter.mkdir(dest === "" ? "notes" : `notes/${dest}`);
  await adapter.rename(oldFull, newFull);
  return newFull;
}

// 메인 + 두 sidecar 한 묶음 rename. sidecar 가 없으면 skip.
export async function renameMeetingFiles(
  adapter: VaultAdapter,
  oldPath: string,
  newPath: string,
): Promise<void> {
  if (oldPath === newPath) return;
  await adapter.rename(oldPath, newPath);
  const oldT = transcriptPath(oldPath);
  const newT = transcriptPath(newPath);
  if (await adapter.exists(oldT)) {
    await adapter.rename(oldT, newT);
  }
  const oldS = summaryPath(oldPath);
  const newS = summaryPath(newPath);
  if (await adapter.exists(oldS)) {
    await adapter.rename(oldS, newS);
  }
}

export function journalPath(date: string): string {
  return `journals/${date}.md`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan operations

// 메모 도메인 안 시스템 폴더 — 사이드바 트리/메모 scan 양쪽에서 제외. underscore prefix
// 는 옵시디안 convention 으로 메모와 구분되는 "자산/시스템" 표시 (`_attachments` 등).
// dotfile 처럼 listRecursive 단에서 막진 않음 — 사용자 mkdir 한 일반 메모 폴더가
// underscore 로 시작할 수 있어 (rare 지만), domain-specific 한 곳에서만 차단.
function isMeetingSystemSegment(seg: string): boolean {
  return seg === "_attachments";
}

function isInMeetingSystemFolder(relPath: string): boolean {
  // relPath = "notes/_attachments/..." 같은 형식. "notes/" 떼고 첫 segment 검사.
  if (!relPath.startsWith("notes/")) return false;
  const rest = relPath.slice("notes/".length);
  const firstSeg = rest.split("/")[0];
  return isMeetingSystemSegment(firstSeg);
}

// notes/ 안 모든 폴더 path 반환 (빈 폴더 포함, vault root 기준).
// `["notes/work", "notes/work/2026", "notes/personal"]` 처럼.
// 메모 0개라도 옵시디안에서 mkdir 한 폴더는 보여야 — 사이드바 트리가 buildMeetingsTree
// 에 이 list 를 extra 로 전달. `_attachments` 는 메모가 아니라 자산 폴더라 제외.
export async function scanMeetingFolders(
  adapter: VaultAdapter,
): Promise<string[]> {
  const all = await adapter.listFoldersRecursive("notes");
  return all.filter((p) => !isInMeetingSystemFolder(p));
}

export async function scanMeetings(adapter: VaultAdapter): Promise<MeetingMeta[]> {
  // scanAll = 서버 batch 1회(HTTP). before: listRecursive(1) + read(N) + readMeta(N)
  // = 1 + 2N 왕복 (notes/ 400개면 ~800 왕복 + iCloud 파일 지연이 겹쳐 사이드바가
  // 수십 초 비어 보였음 — portfolio 는 scanAll 로 고쳤는데 여기만 남아있었다).
  // after: scanAll(1) = 1 왕복. nav-restructure 의 `notes/{folder}/...` 중첩 폴더도
  // 서버 recursive scan 으로 그대로 잡힘.
  const entries = await adapter.scanAll("notes");
  const results: MeetingMeta[] = [];
  for (const { path, content, meta } of entries) {
    if (!path.endsWith(".md")) continue;
    if (isInMeetingSystemFolder(path)) continue; // _attachments 등 자산 폴더 제외
    if (isMeetingSidecar(path)) continue; // sidecar 는 scan 대상 X
    if (isSyncNoiseFile(path)) continue; // iCloud/Dropbox 충돌·placeholder skip
    try {
      const m = fileToMeeting(path, content, "", "", meta.mtime);
      results.push({
        id: m.id,
        uid: m.uid,
        title: m.title,
        date: m.date,
        time: m.time,
        attendees: m.attendees,
        tags: m.tags,
        pinned: m.pinned,
        mtime: m.mtime,
        created_at: m.created_at,
        updated_at: m.updated_at,
        deleted_at: m.deleted_at,
      });
    } catch (err) {
      // fileToMeeting throw (frontmatter id 누락 등 — 앱이 안 만든 옛 노트).
      // parseVaultFile 은 graceful 이라 frontmatter 손상만으론 안 떨어짐. 디버깅용
      // path 로깅 — 사용자가 특정 노트가 사이드바에서 빠진 이유 추적 가능.
      console.warn(`[scanMeetings] skip ${path}:`, err);
    }
  }
  await dedupeUids(adapter, results);
  results.sort((a, b) => {
    const da = a.date ?? "";
    const db = b.date ?? "";
    if (da !== db) return db.localeCompare(da);
    return b.mtime - a.mtime;
  });
  return results;
}

// 같은 uid 두 entry 가 vault 에 존재하면 (외부 복사 / 옵시디안 모바일 merge /
// 백업 복원) React key 충돌 + 같은 uid hash 라우팅 시 어느 파일 잡힐지 race.
// 후순위 (mtime 작은, 동률이면 path 알파벳 큰) entries 의 uid 를 새 uuid 로
// 재발급 + frontmatter rewrite. rewrite 가 watcher 다시 trigger 하지만 dedup
// 은 idempotent (다음 scan 에 이미 unique → no-op) 이라 무한 루프 X.
// in-place 로 results 의 uid 필드 갱신 — 같은 turn UI 가 새 uid 로 routing 가능.
// export — 테스트에서 직접 호출.
export async function dedupeUids(
  adapter: VaultAdapter,
  results: MeetingMeta[],
): Promise<void> {
  const groups = new Map<string, MeetingMeta[]>();
  for (const m of results) {
    const existing = groups.get(m.uid);
    if (existing) existing.push(m);
    else groups.set(m.uid, [m]);
  }

  for (const [uid, entries] of groups) {
    if (entries.length < 2) continue;
    // 우선순위: mtime 큰 → 같으면 path 알파벳 작은. entries[0] 이 keeper.
    entries.sort((a, b) => {
      if (a.mtime !== b.mtime) return b.mtime - a.mtime;
      return a.id.localeCompare(b.id);
    });
    for (let i = 1; i < entries.length; i++) {
      const entry = entries[i];
      const newUid = crypto.randomUUID();
      try {
        const raw = await adapter.read(entry.id);
        const newRaw = patchFrontmatter(raw, { id: newUid });
        const newMeta = await adapter.write(entry.id, newRaw, entry.mtime);
        entry.uid = newUid;
        entry.mtime = newMeta.mtime;
        console.warn(
          `[scanMeetings] dedupe uid: ${entry.id} (was ${uid}, now ${newUid})`,
        );
      } catch (err) {
        // read-only vault / sync conflict / 권한 — 메모리 uid 만 분리해서
        // React key 충돌 0. 다음 scan 또는 사용자 edit 시 다시 시도.
        entry.uid = newUid;
        console.warn(
          `[scanMeetings] dedupe rewrite 실패 ${entry.id}: 메모리 uid 만 분리`,
          err,
        );
      }
    }
  }
}

export async function scanJournals(adapter: VaultAdapter): Promise<JournalMeta[]> {
  const files = await adapter.list("journals");
  const results: JournalMeta[] = [];
  for (const path of files) {
    if (!path.endsWith(".md")) continue;
    if (isSyncNoiseFile(path)) continue;
    try {
      const raw = await adapter.read(path);
      const meta = await adapter.readMeta(path);
      const j = fileToJournal(path, raw, meta.mtime);
      results.push({ id: j.id, uid: j.uid, date: j.date, mtime: j.mtime });
    } catch (err) {
      console.warn(`[scanJournals] skip ${path}:`, err);
    }
  }
  results.sort((a, b) => b.date.localeCompare(a.date));
  return results;
}

// 할 일 = `tasks/` 폴더의 프로젝트별 md 파일들. `tasks/inbox.md` = 미분류.
// 폴더 전체를 가로질러 스캔 — 각 TaskItem 의 source.file 이 프로젝트(파일)를 가리킴.
// (옛 모델: 루트 inbox.md 단일 파일. lazy migration 으로 tasks/ 로 이관됨.)
export const TASKS_DIR = "tasks";

export async function scanAllTasks(adapter: VaultAdapter): Promise<TaskItem[]> {
  let files: string[];
  try {
    files = await adapter.list(TASKS_DIR);
  } catch {
    return [];
  }
  const items: TaskItem[] = [];
  for (const path of files) {
    if (!path.endsWith(".md")) continue;
    if (isSyncNoiseFile(path)) continue;
    try {
      const raw = await adapter.read(path);
      items.push(...extractTasks(path, raw));
    } catch (err) {
      console.warn(`[scanAllTasks] skip ${path}:`, err);
    }
  }
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trash (soft delete: .trash/ 폴더로 이동, 옵시디안 호환)

export async function trashFile(
  adapter: VaultAdapter,
  filePath: string,
): Promise<string> {
  return trashFileWithStamp(adapter, filePath, freshStamp());
}

// stamp 를 외부에서 주입 가능 — 메인 + sidecar 를 같은 stamp 로 묶기 위해 사용.
export async function trashFileWithStamp(
  adapter: VaultAdapter,
  filePath: string,
  stamp: string,
): Promise<string> {
  await adapter.mkdir(".trash");
  const base = filePath.replace(/^.*\//, "");
  const trashPath = `.trash/${stamp}-${base}`;
  await adapter.rename(filePath, trashPath);
  return trashPath;
}

export function freshStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

// trash 파일명 prefix stamp(`YYYY-MM-DDTHH-MM-SS`) → epoch ms. 깨진 stamp 는 0
// (호출자가 mtime 으로 fallback). routines/.trash, portfolio/.trash 공용.
export function parseStampToMs(stamp: string): number {
  const iso = stamp.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/,
    "$1T$2:$3:$4",
  );
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export async function restoreFromTrash(
  adapter: VaultAdapter,
  trashPath: string,
): Promise<string> {
  // ".trash/2026-05-17T14-09-18-{원본base}" → 원본 base 추출
  const base = trashPath.replace(/^\.trash\//, "").replace(
    /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/,
    "",
  );
  // 원본 폴더 구조 추정: 순수 YYYY-MM-DD.md 는 일기, 그 외는 메모.
  let target: string;
  if (base.match(/^\d{4}-\d{2}-\d{2}\.md$/)) {
    target = `journals/${base}`;
  } else {
    target = `notes/${base}`;
  }
  // 충돌 회피
  let n = 2;
  let candidate = target;
  while (await adapter.exists(candidate)) {
    const dot = target.lastIndexOf(".");
    candidate = `${target.slice(0, dot)}-${n}${target.slice(dot)}`;
    n++;
  }
  await adapter.rename(trashPath, candidate);
  return candidate;
}

export async function scanTrash(
  adapter: VaultAdapter,
): Promise<{ id: string; deletedAt: number }[]> {
  const files = await adapter.list(".trash");
  return files
    .filter((p) => p.endsWith(".md") && !isSyncNoiseFile(p))
    .map((p) => {
      const base = p.replace(/^\.trash\//, "");
      const stampMatch = base.match(
        /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-/,
      );
      const deletedAt = stampMatch
        ? new Date(
            `${stampMatch[1]}T${stampMatch[2]}:${stampMatch[3]}:${stampMatch[4]}`,
          ).getTime()
        : 0;
      return { id: p, deletedAt };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Vault 초기화 (첫 실행 시)

export async function ensureVaultStructure(
  adapter: VaultAdapter,
): Promise<void> {
  await adapter.mkdir("notes");
  await adapter.mkdir("journals");
  await adapter.mkdir("portfolio"); // V0.7
  await adapter.mkdir(TASKS_DIR); // V0.8 — 할 일 프로젝트 파일들의 집
  // V0.8 lazy migration — 옛 루트 inbox.md 를 tasks/ + schedule.md 로 가른다.
  // (idempotent: 루트 inbox.md 가 없으면 즉시 반환.)
  await migrateRootInbox(adapter);
  if (!(await adapter.exists(`${TASKS_DIR}/inbox.md`))) {
    await adapter.write(`${TASKS_DIR}/inbox.md`, "# 미분류\n");
  }
}

// V0.8 모델 분리 마이그레이션 — 첫 read 시 1회. 옛 루트 `inbox.md` 한 파일에
// 섞여 있던 할 일 + 일정을 가른다 (V0.7.1 date-prefix→uid 같은 lazy 패턴):
//   - `#schedule` + 날짜 라인 → `schedule.md` 로 이동 (체크박스 제거, 날짜-우선
//     이벤트 포맷으로 재직렬화).
//   - 그 외 모든 라인 → `tasks/inbox.md` 로 이동 (할 일 라인은 카테고리 태그
//     `#work`/`#schedule`/`#other` 만 제거, 체크박스·텍스트·날짜·기타 태그 보존.
//     헤더·빈 메모 등 비-태스크 라인은 그대로 보존 — 데이터 손실 방지).
// 끝에 루트 inbox.md 삭제 = 마이그레이션 완료 표식 (재실행 시 early-return).
//
// 동시성 가드: React StrictMode 는 dev 에서 init effect 를 이중 마운트해
// ensureVaultStructure → migrateRootInbox 를 동시 2회 호출한다. 락이 없으면 두 run 이
// 같은 루트 inbox.md 를 읽고 둘 다 tasks/inbox.md 에 써(두 번째가 append) 내용이
// 중복된다. root 경로별 in-flight promise 로 동시 호출이 단일 실행을 공유하게 한다.
const migrateInFlight = new Map<string, Promise<void>>();

export function migrateRootInbox(adapter: VaultAdapter): Promise<void> {
  const root = adapter.getRoot() ?? "";
  let p = migrateInFlight.get(root);
  if (!p) {
    p = doMigrateRootInbox(adapter).finally(() => migrateInFlight.delete(root));
    migrateInFlight.set(root, p);
  }
  return p;
}

async function doMigrateRootInbox(adapter: VaultAdapter): Promise<void> {
  const ROOT = "inbox.md";
  if (!(await adapter.exists(ROOT))) return;
  const raw = await adapter.read(ROOT);
  const lines = raw.split("\n");

  // 라인별 파싱 결과 — task 라인의 line→TaskItem 매핑.
  const items = extractTasks(ROOT, raw);
  const byLine = new Map(items.map((it) => [it.source.line, it]));

  const eventLines: string[] = [];
  const keptLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const item = byLine.get(i);
    if (item && item.tags.includes("schedule") && item.due) {
      // 일정 → schedule.md 이벤트 (체크박스 없음, 날짜-우선).
      eventLines.push(
        buildEventLine({
          start: item.due,
          end: item.end ?? null,
          time: item.time ?? null,
          text: item.text,
        }),
      );
      continue;
    }
    // 그 외 — 카테고리 태그만 제거하고 라인 보존 (task 든 비-task 든).
    keptLines.push(lines[i].replace(/\s#(?:work|schedule|other)\b/g, ""));
  }

  // schedule.md 에 추출 이벤트 append (기존 내용 보존).
  if (eventLines.length) {
    const existing = (await adapter.exists(SCHEDULE_PATH))
      ? await adapter.read(SCHEDULE_PATH)
      : "# 일정\n";
    await adapter.write(
      SCHEDULE_PATH,
      `${existing.replace(/\n+$/, "")}\n${eventLines.join("\n")}\n`,
    );
  }

  // tasks/inbox.md 작성 (이미 있으면 append — 부분 실패 재실행 안전).
  const target = `${TASKS_DIR}/inbox.md`;
  const keptContent = keptLines.join("\n").replace(/\n+$/, "") + "\n";
  if (await adapter.exists(target)) {
    const existing = await adapter.read(target);
    await adapter.write(target, `${existing.replace(/\n+$/, "")}\n${keptContent}`);
  } else {
    await adapter.write(target, keptContent);
  }

  // 루트 inbox.md 제거 — 마이그레이션 완료.
  await adapter.delete(ROOT);
}
