// V0.7 포트폴리오 탭 — vault 기반 PR 카드 데이터 모델 + 식별자 helpers + scan.
//
// design doc v2.3 (ENG + DESIGN CLEAR):
//   ~/.gstack/projects/goodsoob-work/ham-main-design-20260518-105501.md
//
// Step 1 = schema + interface lock-in. Step 2 = scanPortfolio + watcher 확장.
// Step 4 = sync orchestration (search + enrich, 본인 수정 필드 보존).
// useMeetings 등 기존 vault 패턴과 동형이라 step 6 hook 도 같은 시그니처로 붙음.

import yaml from "js-yaml";

import type { VaultAdapter } from "../lib/vault/adapter";
import { parsePRResponse } from "../lib/clipboardPrompt";
import {
  ghEnrichPR,
  ghSearchMyPRs,
  type GhPRDetail,
  type GhSearchResult,
} from "../lib/portfolio/gh";
import { downloadImageToVault } from "../lib/portfolio/imageDownload";
import { extractPRBodyImages, planImagePaths } from "../lib/portfolio/imageImport";
import { patchFrontmatter, splitFrontmatter } from "../lib/vault/parser";
import { parseStampToMs } from "../lib/vault/scan";

export const PORTFOLIO_DIR = "portfolio";
export const SYNCED_FILE = "portfolio/.synced.md";
export const ATTACHMENTS_DIR = "portfolio/_attachments";

// ─────────────────────────────────────────────────────────────────────────────
// Category model — vault union
//
// 카테고리는 vault 안 모든 portfolio 카드의 frontmatter.category 의 union 으로
// 자연 발생. master list 파일·코드 상수 없음. 어떤 카드가 `category: design` 박으면
// 그 카테고리가 존재하고, 마지막 카드에서 떼면 자동 소멸. typo 후 정정 = 잘못 적은
// 카테고리 자동 사라짐. 색은 모두 단일 회색 chip (categoryLookup.ts).
//
// 빈 default 카테고리는 "other" — 사용자 PR template 의 가이드 enum (CLAUDE.md 의
// ui_ux|backend|infra|fix|other) 과 일치하지만 앱이 강제하지 않음. parsePRResponse
// 가 매칭 실패 시 "other" 반환하는 정도.

export type PortfolioCategory = string;

// vault scan 결과에서 카테고리 union 추출. 빈/누락은 제외, 정렬은 사용 카드 수 desc
// → slug asc tiebreaker. 카드가 0 이면 빈 배열.
export function deriveCategoryUnion(
  works: { frontmatter: { category: string } }[],
): string[] {
  const counts = new Map<string, number>();
  for (const w of works) {
    const slug = w.frontmatter.category;
    if (!slug) continue;
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => {
      if (a[1] !== b[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .map(([slug]) => slug);
}

export type PortfolioState = "merged" | "closed";

export type ScreenshotLabel = "before" | "after" | null;

// ─────────────────────────────────────────────────────────────────────────────
// Frontmatter schema

export interface PortfolioScreenshot {
  // vault root 상대 경로. 예: "portfolio/_attachments/owner-repo-123/before-1.jpg"
  path: string;
  label: ScreenshotLabel;
  caption: string;
}

export interface PortfolioWorkFrontmatter {
  type: "portfolio-work";

  // GitHub 원본 (gh sync 가 read-only 로 채움 — 본인 수정해도 다음 sync 덮어씀)
  // github_pr_id = GitHub 내부 PR ID (영구 불변). owner/repo rename 후에도 같음.
  // sync 가 이 id 로 vault 카드 매칭 → rename 자동 감지.
  // optional — 수동 카드 / pr_number=0 직커밋 카드는 PR 자체가 없어 id 도 없음.
  github_pr_id?: number;
  github_owner: string;
  github_repo: string;
  github_pr_number: number;
  github_pr_url: string;
  github_state: PortfolioState;
  github_merged_at: string; // ISO 8601
  github_title: string;
  github_changed_files: number;
  github_additions: number;
  github_deletions: number;

  // 본인 수정 가능 (sync 가 보존 — 다음 sync 가 덮어쓰지 않음)
  included: boolean; // 평가 자료 포함 여부. 신규 카드 default true.
  category: PortfolioCategory;
  impact_summary: string; // 한 줄 임팩트. ClipPromptButton paste 시 채움. 빈 문자열 OK.
  screenshots: PortfolioScreenshot[];

  synced_at: string; // ISO 8601. 마지막 enrich 시점.
}

export interface PortfolioWork {
  prSlug: string; // 파일 basename (확장자 제외). 예: "owner-repo-123"
  frontmatter: PortfolioWorkFrontmatter;
  description: string; // body 의 "## Description (from GitHub)" 섹션
  notes: string; // body 의 "## Notes" 섹션
  filePath: string; // "portfolio/{pr-slug}.md"
  mtime: number; // optimistic concurrency
}

export interface PortfolioSyncState {
  last_sync: string | null; // ISO 8601. null = 한 번도 sync 안 함.
  last_sync_pr_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Identifier helpers
//
// owner / repo / number 는 모두 immutable → 한 번 정한 prSlug 는 rename 안 함.

export function prSlug(owner: string, repo: string, number: number): string {
  return `${owner}-${repo}-${number}`;
}

// gh search 의 repository.nameWithOwner ("owner/repo") 형태에서 직접.
export function prSlugFromNameWithOwner(
  nameWithOwner: string,
  number: number,
): string {
  const [owner, repo] = nameWithOwner.split("/");
  return prSlug(owner, repo, number);
}

export function portfolioWorkPath(slug: string): string {
  return `${PORTFOLIO_DIR}/${slug}.md`;
}

export function attachmentsDirFor(slug: string): string {
  return `${ATTACHMENTS_DIR}/${slug}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults — sync 가 신규 카드 만들 때 본인 수정 필드 초기값

export type PortfolioUserFields = Pick<
  PortfolioWorkFrontmatter,
  "included" | "category" | "impact_summary" | "screenshots"
>;

export function defaultUserFields(): PortfolioUserFields {
  return {
    included: true,
    category: "other",
    impact_summary: "",
    screenshots: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Body sections (H2) — Description / Notes

export const DESCRIPTION_HEADER = "## Description (from GitHub)";
export const NOTES_HEADER = "## Notes";

// 부분 view — 카드 그리드 / 사이드바 카운트용 (description / notes 본문 제외).
export interface PortfolioWorkMeta {
  prSlug: string;
  frontmatter: PortfolioWorkFrontmatter;
  filePath: string;
  mtime: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontmatter validation

function isPortfolioState(v: unknown): v is PortfolioState {
  return v === "merged" || v === "closed";
}

// 사용자 정의 카테고리 허용 — string non-empty 면 OK. 검증은 빈 값만 default ("other") fallback.
function isCategory(v: unknown): v is PortfolioCategory {
  return typeof v === "string" && v.length > 0;
}

function fmStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return fallback;
}

function fmNum(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function fmBool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

function fmScreenshots(v: unknown): PortfolioScreenshot[] {
  if (!Array.isArray(v)) return [];
  const out: PortfolioScreenshot[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const path = fmStr(obj.path);
    if (!path) continue;
    const label = obj.label === "before" || obj.label === "after"
      ? (obj.label as "before" | "after")
      : null;
    out.push({ path, label, caption: fmStr(obj.caption) });
  }
  return out;
}

// 손상/누락 frontmatter → null. scan 에서는 skip, 외부 에디터 직접 편집 방어.
// pr_number=0 = legacy 카드 (PR 없이 직접 커밋 → 본인 또는 claude 가 수동 작성).
// owner/repo 만 필수, pr_number 는 음수만 reject.
export function parsePortfolioFrontmatter(
  fm: Record<string, unknown>,
): PortfolioWorkFrontmatter | null {
  if (fm.type !== "portfolio-work") return null;
  const github_owner = fmStr(fm.github_owner);
  const github_repo = fmStr(fm.github_repo);
  const github_pr_number = fmNum(fm.github_pr_number);
  if (!github_owner || !github_repo || github_pr_number < 0) return null;

  const idRaw = fmNum(fm.github_pr_id, 0);
  return {
    type: "portfolio-work",
    github_pr_id: idRaw > 0 ? idRaw : undefined,
    github_owner,
    github_repo,
    github_pr_number,
    github_pr_url: fmStr(fm.github_pr_url),
    github_state: isPortfolioState(fm.github_state) ? fm.github_state : "merged",
    github_merged_at: fmStr(fm.github_merged_at),
    github_title: fmStr(fm.github_title),
    github_changed_files: fmNum(fm.github_changed_files),
    github_additions: fmNum(fm.github_additions),
    github_deletions: fmNum(fm.github_deletions),
    included: fmBool(fm.included, true), // 누락 시 default true (v2.2 T4-NEW)
    category: isCategory(fm.category) ? fm.category : "other",
    impact_summary: fmStr(fm.impact_summary),
    screenshots: fmScreenshots(fm.screenshots),
    synced_at: fmStr(fm.synced_at),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Body parsing — frontmatter 분리 후 H2 split (Description / Notes)

// "## Description (from GitHub)" / "## Notes" 사이로 분할. 헤더 외 H2 는 보존 안 함
// (PR 카드 외 H2 는 owner-edit 영역인 Notes 안에 들어가야 함).
export function splitPortfolioBody(
  body: string,
): { description: string; notes: string } {
  const descIdx = body.indexOf(DESCRIPTION_HEADER);
  const notesIdx = body.indexOf(NOTES_HEADER);

  const sliceSection = (startHeader: string, startIdx: number): string => {
    if (startIdx < 0) return "";
    // Header line 끝까지 skip
    const afterHeader = startIdx + startHeader.length;
    const newlineAfter = body.indexOf("\n", afterHeader);
    const contentStart = newlineAfter < 0 ? body.length : newlineAfter + 1;
    // 다음 section 시작 찾기 — header 자체와 다른 시작점 중 contentStart 이후 가장 가까운 것
    const candidates = [
      descIdx === startIdx ? -1 : descIdx,
      notesIdx === startIdx ? -1 : notesIdx,
    ].filter((i) => i >= contentStart);
    const end = candidates.length === 0 ? body.length : Math.min(...candidates);
    return body.slice(contentStart, end).replace(/^\n+/, "").replace(/\n+$/, "");
  };

  return {
    description: sliceSection(DESCRIPTION_HEADER, descIdx),
    notes: sliceSection(NOTES_HEADER, notesIdx),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// File → PortfolioWork

export function fileToPortfolioWork(
  filePath: string,
  raw: string,
  mtime: number,
): PortfolioWork | null {
  const { frontmatter: fm, body } = splitFrontmatter(raw);
  const frontmatter = parsePortfolioFrontmatter(fm);
  if (!frontmatter) return null;

  const { description, notes } = splitPortfolioBody(body);
  const base = filePath.split("/").pop() ?? filePath;
  const slug = base.replace(/\.md$/, "");

  return {
    prSlug: slug,
    frontmatter,
    description,
    notes,
    filePath,
    mtime,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan portfolio dir — vault 디렉토리 트리 재귀. 수동 폴더 (사용자 만든 실제 디렉토리)
// 안 카드 + flat 의 github 카드 모두 한 list 로. _attachments / categories.md /
// .synced.md / .trash/ 는 제외.

// portfolio/categories.md 는 옛 master list 파일 — V0.7.3 부터 사용 안 함. 카드와 type
// 다르므로 fileToPortfolioWork 가 자연 skip. 사용자가 옵시디안에서 직접 삭제 가능.
const PORTFOLIO_SKIP = new Set<string>([
  "portfolio/.synced.md",
]);

export const PORTFOLIO_TRASH_DIR = "portfolio/.trash";

// portfolio/_attachments/... 는 카드가 아니므로 scan 제외. 옛 layout 호환.
function isAttachmentPath(path: string): boolean {
  if (path === `${PORTFOLIO_DIR}/${ATTACHMENTS_DIR.split("/")[1]}`) return true;
  return path.startsWith(`${ATTACHMENTS_DIR}/`);
}

// portfolio/folder/sub/card.md → "folder/sub"
// portfolio/card.md → ""
// portfolio 외 path → ""
export function folderPathOfCard(filePath: string): string {
  if (!filePath.startsWith(`${PORTFOLIO_DIR}/`)) return "";
  const rest = filePath.slice(PORTFOLIO_DIR.length + 1);
  const lastSlash = rest.lastIndexOf("/");
  if (lastSlash < 0) return "";
  return rest.slice(0, lastSlash);
}

// GitHub 출처 카드 판별 — [GitHub] 그룹 vs [내가 만든 폴더] 분류 기준.
//   1) PR 있는 정상 카드: github_pr_number > 0
//   2) legacy 직커밋 카드: pr_number=0 + owner/repo 가 진짜 repo (이름 = claude 가 git log 로 생성).
// 수동 추가 카드만 owner="local" repo="manual" sentinel 박힘 → 그 경우만 false.
export function isGithubCard(fm: PortfolioWorkFrontmatter): boolean {
  if (fm.github_pr_number > 0) return true;
  return !(fm.github_owner === "local" && fm.github_repo === "manual");
}

export async function scanPortfolio(
  adapter: VaultAdapter,
): Promise<PortfolioWorkMeta[]> {
  // scanAll = 서버 batch 1회(HTTP) 또는 로컬 병렬(Tauri/memory).
  // before: listRecursive(1) + read(N) + readMeta(N) = 1 + 2N 왕복.
  // after:  scanAll(1) = 1 왕복.
  const allEntries = await adapter.scanAll(PORTFOLIO_DIR);
  const results: PortfolioWorkMeta[] = [];
  for (const { path, content: raw, meta } of allEntries) {
    if (!path.endsWith(".md")) continue;
    if (PORTFOLIO_SKIP.has(path)) continue;
    if (path.startsWith(`${PORTFOLIO_TRASH_DIR}/`)) continue;
    if (isAttachmentPath(path)) continue;
    try {
      const work = fileToPortfolioWork(path, raw, meta.mtime);
      if (!work) continue; // type 불일치 / 손상 → skip
      results.push({
        prSlug: work.prSlug,
        frontmatter: work.frontmatter,
        filePath: work.filePath,
        mtime: work.mtime,
      });
    } catch {
      // 손상된 파일 skip (vault 패턴)
    }
  }
  // github_merged_at desc, mtime desc 정렬 (평가 자료 = 최근 작업 위)
  results.sort((a, b) => {
    const da = a.frontmatter.github_merged_at;
    const db = b.frontmatter.github_merged_at;
    if (da !== db) return db.localeCompare(da);
    return b.mtime - a.mtime;
  });
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual folders — portfolio/ 아래 실제 디렉토리 트리. .trash, _attachments,
// dot-prefix 모두 제외. nested 폴더 지원 ("회사/2026/Q1" 같은).

export interface PortfolioFolder {
  path: string; // portfolio root 기준 상대 (예: "사내 발표" 또는 "회사/2026")
  parent: string; // 빈 = top level
  name: string; // last segment
}

// 사용자 입력 폴더 이름 → 파일시스템 안전 이름. 한글 OK, 금지 문자만 -.
export function sanitizeFolderName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// 새 폴더 생성. parent 빈 = top level. 충돌 시 throw.
// 옵시디안 폴더 패턴: 빈 폴더 OK (안 카드 0 이어도 사이드바 노출).
export async function createPortfolioFolder(
  adapter: VaultAdapter,
  parent: string,
  name: string,
): Promise<string> {
  const safe = sanitizeFolderName(name);
  if (!safe) throw new Error("폴더 이름이 비어있습니다.");
  const path = parent ? `${parent}/${safe}` : safe;
  const abs = `${PORTFOLIO_DIR}/${path}`;
  if (await adapter.exists(abs)) {
    throw new Error(`같은 이름의 폴더가 이미 있습니다: ${path}`);
  }
  await adapter.mkdir(abs);
  return path;
}

// 폴더 이름 변경 — disk rename. 안 카드 모두 새 path 로. parent 는 그대로.
export async function renamePortfolioFolder(
  adapter: VaultAdapter,
  fromPath: string,
  newName: string,
): Promise<string> {
  const safe = sanitizeFolderName(newName);
  if (!safe) throw new Error("폴더 이름이 비어있습니다.");
  const lastSlash = fromPath.lastIndexOf("/");
  const parent = lastSlash < 0 ? "" : fromPath.slice(0, lastSlash);
  const toPath = parent ? `${parent}/${safe}` : safe;
  if (toPath === fromPath) return fromPath;
  const fromAbs = `${PORTFOLIO_DIR}/${fromPath}`;
  const toAbs = `${PORTFOLIO_DIR}/${toPath}`;
  if (await adapter.exists(toAbs)) {
    throw new Error(`같은 이름의 폴더가 이미 있습니다: ${toPath}`);
  }
  await adapter.rename(fromAbs, toAbs);
  return toPath;
}

// 수동 카드의 폴더 이동 — fromPath 의 파일을 newFolder 안으로 disk rename.
// 메모장 폴더 이동 패턴 동형. github 카드 (sync 관리) 는 root flat 유지 — 이 함수는
// 수동 카드 전용 (호출처에서 isGithubCard 가드).
export async function moveManualCard(
  adapter: VaultAdapter,
  fromPath: string,
  newFolder: string,
): Promise<string> {
  const base = fromPath.split("/").pop() ?? fromPath;
  const cleanFolder = newFolder.trim().replace(/^\/+|\/+$/g, "");
  const newDir = cleanFolder
    ? `${PORTFOLIO_DIR}/${cleanFolder}`
    : PORTFOLIO_DIR;
  const newPath = `${newDir}/${base}`;
  if (newPath === fromPath) return fromPath;
  if (await adapter.exists(newPath)) {
    throw new Error(
      `같은 이름의 카드가 그 폴더에 이미 있습니다. 카드 이름을 바꾸고 다시 시도하세요.`,
    );
  }
  await adapter.mkdir(newDir);
  await adapter.rename(fromPath, newPath);
  return newPath;
}

// 폴더 삭제 — 안 모든 카드 (md) 를 휴지통으로 이동, 빈 폴더는 삭제. 메모장 패턴.
// 폴더 안 sub-folder 도 재귀. _attachments 는 안 옮김 (카드와 함께 휴지통 stamp 디렉토리).
export async function deletePortfolioFolder(
  adapter: VaultAdapter,
  folderPath: string,
): Promise<{ deletedCards: number }> {
  const abs = `${PORTFOLIO_DIR}/${folderPath}`;
  const files = await adapter.listRecursive(abs);
  await adapter.mkdir(PORTFOLIO_TRASH_DIR);
  let deletedCards = 0;
  for (const path of files) {
    if (!path.endsWith(".md")) continue;
    if (isAttachmentPath(path)) continue;
    try {
      const base = path.split("/").pop() ?? path;
      const slug = base.replace(/\.md$/, "");
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      await adapter.rename(path, `${PORTFOLIO_TRASH_DIR}/${stamp}-${slug}.md`);
      deletedCards++;
    } catch {
      // skip 개별 실패
    }
  }
  // 빈 폴더들 정리 — listFoldersRecursive 결과를 깊은 순서로 삭제.
  try {
    const inner = await adapter.listFoldersRecursive(abs);
    const sorted = inner
      .filter((p) => p.startsWith(`${PORTFOLIO_DIR}/`))
      .sort((a, b) => b.split("/").length - a.split("/").length);
    for (const folder of sorted) {
      try {
        await adapter.delete(folder, { recursive: true });
      } catch {
        // 폴더 안에 _attachments 남았을 수 있음
      }
    }
    await adapter.delete(abs, { recursive: true });
  } catch {
    // adapter 가 빈 디렉토리 삭제 실패하는 경우 — vault watcher 가 다음 sync 때 정리 가능
  }
  return { deletedCards };
}

export async function listManualFolders(
  adapter: VaultAdapter,
): Promise<PortfolioFolder[]> {
  const all = await adapter.listFoldersRecursive(PORTFOLIO_DIR);
  const results: PortfolioFolder[] = [];
  for (const rel of all) {
    // rel 은 vault root 기준 (예: "portfolio/사내 발표")
    if (!rel.startsWith(`${PORTFOLIO_DIR}/`)) continue;
    const portfolioRel = rel.slice(PORTFOLIO_DIR.length + 1);
    if (!portfolioRel) continue;
    // _attachments / .trash 제외 (listFoldersRecursive 는 dot-prefix 만 자동 skip)
    const top = portfolioRel.split("/")[0];
    if (top === "_attachments") continue;
    const lastSlash = portfolioRel.lastIndexOf("/");
    const parent = lastSlash < 0 ? "" : portfolioRel.slice(0, lastSlash);
    const name = lastSlash < 0 ? portfolioRel : portfolioRel.slice(lastSlash + 1);
    results.push({ path: portfolioRel, parent, name });
  }
  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trash — portfolio/.trash/ 안 카드 list / 복원 / 영구삭제 / 비우기.
// 파일명 stamp prefix: `YYYY-MM-DDTHH-MM-SS-{slug}.md`.
// attachments 짝: `{stamp}-attachments-{slug}/` (폴더, 안에 이미지).

const TRASH_STAMP_RE =
  /^portfolio\/\.trash\/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-(.+)\.md$/;

export type TrashedPortfolioWork = PortfolioWorkMeta & {
  trashPath: string; // portfolio/.trash/{stamp}-{slug}.md
  deletedAt: number; // stamp 시각 ms
  stamp: string;
  slug: string; // 원본 slug (stamp 제거)
};

export async function listTrashedPortfolioWorks(
  adapter: VaultAdapter,
): Promise<TrashedPortfolioWork[]> {
  const files = await adapter.list(PORTFOLIO_TRASH_DIR);
  const results: TrashedPortfolioWork[] = [];
  for (const path of files) {
    if (!path.endsWith(".md")) continue;
    const m = path.match(TRASH_STAMP_RE);
    if (!m) continue;
    const [, stamp, slug] = m;
    try {
      const raw = await adapter.read(path);
      const meta = await adapter.readMeta(path);
      const work = fileToPortfolioWork(path, raw, meta.mtime);
      if (!work) continue;
      const deletedAt = parseStampToMs(stamp) || meta.mtime;
      results.push({
        prSlug: slug,
        frontmatter: work.frontmatter,
        filePath: work.filePath,
        mtime: deletedAt,
        trashPath: path,
        deletedAt,
        stamp,
        slug,
      });
    } catch {
      // 손상 skip
    }
  }
  // 최근 삭제 위
  results.sort((a, b) => b.deletedAt - a.deletedAt);
  return results;
}

// 복원 — trashCardPath: portfolio/.trash/{stamp}-{slug}.md
// 원래 위치 portfolio/{slug}.md 로 이동 + 같은 stamp 의 attachments 짝 동행.
// 복원된 카드는 항상 `included: false` (미사용) 상태로 — 휴지통 = 임시 자리, 복원 = 미사용으로.
// 충돌 (같은 slug 카드가 다시 sync 된 경우) 시 throw.
export async function restorePortfolioWork(
  adapter: VaultAdapter,
  trashCardPath: string,
): Promise<string> {
  const m = trashCardPath.match(TRASH_STAMP_RE);
  if (!m) throw new Error(`휴지통 경로 형식이 다름: ${trashCardPath}`);
  const [, stamp, slug] = m;
  const target = portfolioWorkPath(slug);
  if (await adapter.exists(target)) {
    throw new Error(
      `같은 이름의 카드가 이미 있어요 (${slug}). 그쪽을 먼저 정리하거나 다른 이름으로 복원해주세요.`,
    );
  }
  await adapter.rename(trashCardPath, target);
  // included: false 로 patch — 휴지통에서 꺼낸 카드는 자동으로 미사용 자리에.
  try {
    const raw = await adapter.read(target);
    const patched = patchFrontmatter(raw, { included: false });
    if (patched !== raw) {
      await adapter.write(target, patched);
    }
  } catch {
    // patch 실패 — 카드 자체는 복원됨, included 는 기존 값 유지 (다음 사용 때 수동 조정 가능)
  }
  // attachments 짝
  const trashAttach = `${PORTFOLIO_TRASH_DIR}/${stamp}-attachments-${slug}`;
  const targetAttach = `${ATTACHMENTS_DIR}/${slug}`;
  try {
    if (
      (await adapter.exists(trashAttach)) &&
      !(await adapter.exists(targetAttach))
    ) {
      await adapter.rename(trashAttach, targetAttach);
    }
  } catch {
    // 디렉토리 rename 실패 — 카드 자체는 복원됨, 첨부는 휴지통에 남음
  }
  return target;
}

// 영구 삭제 — trash 카드 + attachments 폴더 안 파일/폴더 모두.
export async function purgePortfolioWork(
  adapter: VaultAdapter,
  trashCardPath: string,
): Promise<void> {
  await adapter.delete(trashCardPath);
  const m = trashCardPath.match(TRASH_STAMP_RE);
  if (!m) return;
  const [, stamp, slug] = m;
  const trashAttach = `${PORTFOLIO_TRASH_DIR}/${stamp}-attachments-${slug}`;
  if (await adapter.exists(trashAttach)) {
    try {
      const inside = await adapter.list(trashAttach);
      for (const f of inside) {
        try {
          await adapter.delete(f);
        } catch {
          // skip
        }
      }
      try {
        await adapter.delete(trashAttach);
      } catch {
        // 빈 디렉 삭제 실패 — Tauri/OS 의존, 다음 휴지통 비우기 때 재시도
      }
    } catch {
      // list 실패 skip
    }
  }
}

// 휴지통 비우기 — portfolio/.trash 안 모든 카드 + attachments 영구 삭제.
export async function emptyPortfolioTrash(
  adapter: VaultAdapter,
): Promise<void> {
  const files = await adapter.list(PORTFOLIO_TRASH_DIR);
  const cards = files.filter((p) => p.endsWith(".md"));
  for (const p of cards) {
    try {
      await purgePortfolioWork(adapter, p);
    } catch {
      // 한 항목 실패해도 진행
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Single read / serialize

export async function readPortfolioWork(
  adapter: VaultAdapter,
  slug: string,
): Promise<PortfolioWork | null> {
  const path = portfolioWorkPath(slug);
  if (!(await adapter.exists(path))) return null;
  const raw = await adapter.read(path);
  const meta = await adapter.readMeta(path);
  return fileToPortfolioWork(path, raw, meta.mtime);
}

const DESCRIPTION_TRUNCATE_AT = 5000;
const TRUNCATED_MARKER = "\n\n...(truncated)";

function truncateDescription(body: string): string {
  if (body.length <= DESCRIPTION_TRUNCATE_AT) return body;
  return body.slice(0, DESCRIPTION_TRUNCATE_AT) + TRUNCATED_MARKER;
}

export function portfolioWorkToRaw(work: PortfolioWork): string {
  const fm = yaml.dump(work.frontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    schema: yaml.JSON_SCHEMA,
  });
  // body: H2 두 섹션. 빈 섹션이라도 헤더는 보존 (옵시디안에서 카드 형식 인식).
  return (
    `---\n${fm.trimEnd()}\n---\n\n` +
    `${DESCRIPTION_HEADER}\n\n${work.description}\n\n` +
    `${NOTES_HEADER}\n\n${work.notes}\n`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual portfolio cards — PR 무관 카드 (오프라인 업무, 회의 발표, 외부 협업 등).
// 메모장 패턴 동형: vault 의 실제 디렉토리 트리에 md 파일로 존재. sync 가
// github_pr_number === 0 (= 수동) 인 카드는 매칭 X → 자동 보존.

export interface CreateManualPortfolioInput {
  title: string; // github_title 저장 + 파일명 시드.
  date: string; // YYYY-MM-DD. 빈 = 오늘. github_merged_at 저장.
  category: PortfolioCategory;
  impact_summary: string;
  folder: string; // 수동 폴더 vault path (예: "사내 발표" 또는 "회사/2026"). 빈 = root.
}

// 파일시스템 금지 문자 + 공백만 정리. 한글/영문/숫자/하이픈은 그대로.
function slugifyManualTitle(title: string): string {
  return title
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function createManualPortfolioWork(
  adapter: VaultAdapter,
  input: CreateManualPortfolioInput,
): Promise<PortfolioWork> {
  const folder = input.folder.trim().replace(/^\/+|\/+$/g, "");
  const dirRel = folder ? `${PORTFOLIO_DIR}/${folder}` : PORTFOLIO_DIR;
  await adapter.mkdir(dirRel);

  const titlePart = slugifyManualTitle(input.title) || "untitled";
  let slug = titlePart;
  let n = 2;
  while (await adapter.exists(`${dirRel}/${slug}.md`)) {
    slug = `${titlePart}-${n++}`;
  }

  // YYYY-MM-DD → ISO 8601 (UTC midnight). 빈 입력은 오늘.
  const dateStr = input.date || new Date().toISOString().slice(0, 10);
  const mergedAt = `${dateStr}T00:00:00.000Z`;

  const frontmatter: PortfolioWorkFrontmatter = {
    type: "portfolio-work",
    github_owner: "local",
    github_repo: "manual",
    github_pr_number: 0,
    github_pr_url: "",
    github_state: "merged",
    github_merged_at: mergedAt,
    github_title: input.title,
    github_changed_files: 0,
    github_additions: 0,
    github_deletions: 0,
    included: true,
    category: input.category,
    impact_summary: input.impact_summary,
    screenshots: [],
    synced_at: "",
  };

  const filePath = `${dirRel}/${slug}.md`;
  const work: PortfolioWork = {
    prSlug: slug,
    frontmatter,
    description: "",
    notes: "",
    filePath,
    mtime: 0,
  };
  const meta = await adapter.write(filePath, portfolioWorkToRaw(work));
  return { ...work, mtime: meta.mtime };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync state (.synced.md) — last_sync 만 (tombstone 폐기, v2.2 T4-NEW)

export async function readSyncState(
  adapter: VaultAdapter,
): Promise<PortfolioSyncState> {
  if (!(await adapter.exists(SYNCED_FILE))) {
    return { last_sync: null, last_sync_pr_count: 0 };
  }
  const raw = await adapter.read(SYNCED_FILE);
  const { frontmatter: fm } = splitFrontmatter(raw);
  return {
    last_sync: fmStr(fm.last_sync) || null,
    last_sync_pr_count: fmNum(fm.last_sync_pr_count),
  };
}

export async function writeSyncState(
  adapter: VaultAdapter,
  state: PortfolioSyncState,
): Promise<void> {
  await adapter.mkdir(PORTFOLIO_DIR);
  const fm = yaml.dump(state, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    schema: yaml.JSON_SCHEMA,
  });
  const body =
    `---\n${fm.trimEnd()}\n---\n\n# Sync state\n\n` +
    `마지막 성공한 sync 시점. \`since=last_sync\` 가 다음 sync 의 ` +
    `\`merged:>=\` qualifier 로 전달됨.\n`;
  await adapter.write(SYNCED_FILE, body);
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsert — sync 가 신규 카드 만들거나 기존 카드 refresh.
//
// preserveUserFields 가 있으면 본인 수정 필드 (project / included / category /
// impact_summary / screenshots) + notes 본문 보존 → sync 가 덮어쓰지 않음 (v2.2 3A).

export interface UpsertPortfolioWorkInput {
  search: GhSearchResult;
  detail: GhPRDetail;
  // 기존 카드 — 있으면 본인 수정 필드 보존, 없으면 default.
  existing?: PortfolioWork | null;
  // V0.7.x — PR body 이미지에서 자동 추출/다운로드한 스크린샷.
  // existing.screenshots 가 비었을 때만 사용 (본인 dropzone 박은 거 보존).
  importedScreenshots?: PortfolioScreenshot[];
}

export async function upsertPortfolioWork(
  adapter: VaultAdapter,
  input: UpsertPortfolioWorkInput,
): Promise<PortfolioWork> {
  const { search, detail, existing, importedScreenshots } = input;
  const [owner, repo] = search.repository.nameWithOwner.split("/");
  const slug = prSlug(owner, repo, search.number);
  const path = portfolioWorkPath(slug);

  // PR body 이미지 자동 import: existing.screenshots 가 비었을 때만 사용.
  // 본인이 옵시디안에서 박은 거 (length > 0) 는 sync 가 덮어쓰지 않음 (보존).
  const existingScreenshots = existing?.frontmatter.screenshots ?? [];
  const screenshots: PortfolioScreenshot[] =
    existingScreenshots.length > 0
      ? existingScreenshots
      : (importedScreenshots ?? []);

  // body 우선순위: detail.body (gh pr view, 더 fresh) > search.body (gh search prs).
  const rawDescription = detail.body || search.body || "";

  // PR body 의 7섹션 양식에서 한 줄 임팩트 + 카테고리 자동 추출.
  // 신규 카드 + 빈 default 필드 채움. 본인이 한 번이라도 수정한 필드는 보존 (3A).
  const parsed = parsePRResponse(rawDescription);

  // 기존 category 가 유효(순수 슬러그)하면 보존, "other" 이거나 괄호 등 무효 형식이면
  // 재파싱(sanitize 적용)값으로 교체 — 과거 "ui_ux(설명)" 처럼 오염된 카드가 재동기화 때 정제됨.
  const existingCategoryValid =
    existing != null &&
    existing.frontmatter.category !== "other" &&
    !/[()（）]/.test(existing.frontmatter.category);

  const userFields: PortfolioUserFields = existing
    ? {
        included: existing.frontmatter.included,
        category: existingCategoryValid
          ? existing.frontmatter.category
          : (parsed?.category ?? "other"),
        impact_summary:
          existing.frontmatter.impact_summary !== ""
            ? existing.frontmatter.impact_summary
            : (parsed?.impact ?? ""),
        screenshots,
      }
    : {
        ...defaultUserFields(),
        screenshots,
        ...(parsed
          ? { impact_summary: parsed.impact, category: parsed.category }
          : {}),
      };

  const frontmatter: PortfolioWorkFrontmatter = {
    type: "portfolio-work",
    github_pr_id: search.id, // 영구 식별자 — rename 자동 감지에 사용
    github_owner: owner,
    github_repo: repo,
    github_pr_number: search.number,
    github_pr_url: search.url,
    github_state: "merged", // search 단계에서 is:merged filter, post-filter (state === "closed")
    github_merged_at: detail.mergedAt,
    github_title: search.title,
    github_changed_files: detail.changedFiles,
    github_additions: detail.additions,
    github_deletions: detail.deletions,
    ...userFields,
    synced_at: new Date().toISOString(),
  };

  const work: PortfolioWork = {
    prSlug: slug,
    frontmatter,
    description: truncateDescription(rawDescription),
    notes: existing?.notes ?? "",
    filePath: path,
    mtime: 0,
  };

  const meta = await adapter.write(path, portfolioWorkToRaw(work));
  return { ...work, mtime: meta.mtime };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rename helper — github_pr_id 매칭 후 옛 파일/디렉토리 → 새 slug.

async function renamePortfolioCard(
  adapter: VaultAdapter,
  oldSlug: string,
  newSlug: string,
): Promise<void> {
  const oldPath = portfolioWorkPath(oldSlug);
  const newPath = portfolioWorkPath(newSlug);
  // 새 path 에 이미 파일 있으면 (다른 PR 과 slug 충돌 등) 옛 카드를 .trash 로 도피.
  if (await adapter.exists(newPath)) {
    await adapter.mkdir(".trash");
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    await adapter.rename(oldPath, `.trash/${stamp}-rename-conflict-${oldSlug}.md`);
  } else {
    await adapter.rename(oldPath, newPath);
  }
  // _attachments/{oldSlug}/ → _attachments/{newSlug}/ (best effort, 없으면 skip)
  const oldAttach = `${ATTACHMENTS_DIR}/${oldSlug}`;
  const newAttach = `${ATTACHMENTS_DIR}/${newSlug}`;
  try {
    if (await adapter.exists(oldAttach)) {
      await adapter.rename(oldAttach, newAttach);
    }
  } catch {
    // 디렉토리 rename 실패 — Tauri/OS 의존, best effort
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync orchestration (v2.2 — 4A 직렬, 1B atomic per-PR, 3A 보존)

export interface SyncPortfolioResult {
  added: number;
  preserved: number;
  total: number;
}

export interface SyncPortfolioOpts {
  // since 미지정 = 전체 (첫 sync 또는 .synced.md 미존재).
  since?: string;
  // 테스트 / mock 용 injection. default 인자로 hide → call site 변경 0 (v2.2 3A test #8).
  searchFn?: typeof ghSearchMyPRs;
  enrichFn?: typeof ghEnrichPR;
  // PR body 이미지 다운로드 (Tauri shell+curl 위임). 테스트 / mock 용 injection.
  downloadFn?: (relPath: string, url: string) => Promise<void>;
  // 진행률 콜백 (modal). current = 0-indexed, total = 전체 PR 수.
  onProgress?: (current: number, total: number) => void;
  // 사용자 cancel.
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("sync cancelled");
    err.name = "AbortError";
    throw err;
  }
}

// gh pr view / curl 동시 호출 상한. gh CLI 한 호출당 1-2초, curl 다운로드 0.3-2초
// — 5 동시로 wall clock 1/5 단축. 너무 키우면 GitHub rate limit + macOS 의 sh fork
// 부하 (현실적 5 면 안정).
const NETWORK_CONCURRENCY = 5;

// p-limit 류 dep 안 쓰고 fixed-size worker pool 로 처리. abort/error 는 worker
// 안에서 throw → Promise.all 이 즉시 reject (다른 worker 도 다음 i++ 안 집어듦).
async function processWithConcurrency<I, O>(
  items: I[],
  concurrency: number,
  worker: (item: I, index: number) => Promise<O>,
  signal: AbortSignal | undefined,
  onItemDone?: () => void,
): Promise<O[]> {
  const results = new Array<O>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      throwIfAborted(signal);
      results[i] = await worker(items[i], i);
      onItemDone?.();
    }
  }
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, run));
  return results;
}

export async function syncPortfolio(
  adapter: VaultAdapter,
  opts: SyncPortfolioOpts = {},
): Promise<SyncPortfolioResult> {
  const search = opts.searchFn ?? ghSearchMyPRs;
  const enrich = opts.enrichFn ?? ghEnrichPR;
  const download =
    opts.downloadFn ??
    ((relPath: string, url: string) =>
      downloadImageToVault(adapter, relPath, url));

  throwIfAborted(opts.signal);
  await adapter.mkdir(PORTFOLIO_DIR); // 기존 vault (V0.6) 에 portfolio/ 없는 경우 보장
  const results = await search({ since: opts.since, limit: 1000 });
  // gh search prs 의 --json state 는 GraphQL enum 으로 "OPEN"/"CLOSED"/"MERGED"
  // (대문자) 가 일반적. 안전하게 case-insensitive + MERGED 포함.
  const closed = results.filter((pr) => {
    const s = (pr.state || "").toUpperCase();
    return s === "CLOSED" || s === "MERGED";
  });

  // vault scan → github_pr_id + slug 인덱스. rename 자동 감지 + 본인 screenshots 보존에 사용.
  const allWorks = await scanPortfolio(adapter);
  const byId = new Map<number, PortfolioWorkMeta>();
  const bySlug = new Map<string, PortfolioWorkMeta>();
  for (const w of allWorks) {
    const id = w.frontmatter.github_pr_id;
    if (id) byId.set(id, w);
    bySlug.set(w.prSlug, w);
  }

  // Phase A: 각 PR 의 enrich + (필요 시) PR body 이미지 다운로드. 5 concurrency 로
  // wall clock 의 대부분 (gh pr view + curl) 을 N/5 로 압축. progress 콜백은 PR 완료
  // 카운트 기준 (사용자가 체감하는 "GitHub 에서 가져오는" 진행도).
  let progressDone = 0;
  const phaseA = await processWithConcurrency(
    closed,
    NETWORK_CONCURRENCY,
    async (pr) => {
      const detail = await enrich(pr.url);

      // PR body 이미지 자동 import: existing.screenshots 가 비었을 때만.
      // 본인 dropzone 박은 거 (length > 0) 는 보존.
      const [owner, repo] = pr.repository.nameWithOwner.split("/");
      const slug = prSlug(owner, repo, pr.number);
      const existingMeta = byId.get(pr.id) ?? bySlug.get(slug);
      const existingShots = existingMeta?.frontmatter.screenshots ?? [];

      const imported: PortfolioScreenshot[] = [];
      if (existingShots.length === 0) {
        const images = extractPRBodyImages(detail.body);
        if (images.length > 0) {
          const plan = planImagePaths(slug, images);
          for (const { image, relPath } of plan) {
            try {
              const already = await adapter.exists(relPath);
              if (!already) await download(relPath, image.url);
              imported.push({
                path: relPath,
                label: image.label,
                caption: image.caption,
              });
            } catch {
              // best effort — 실패한 이미지는 다음 sync 가 재시도.
            }
          }
        }
      }
      return { detail, imported };
    },
    opts.signal,
    () => {
      progressDone++;
      opts.onProgress?.(progressDone, closed.length);
    },
  );

  // Phase B: vault write 는 직렬 — file rename / write 충돌 / id 매칭 race 회피.
  let added = 0;
  let preserved = 0;
  for (let i = 0; i < closed.length; i++) {
    throwIfAborted(opts.signal);
    const pr = closed[i];
    const [owner, repo] = pr.repository.nameWithOwner.split("/");
    const newSlug = prSlug(owner, repo, pr.number);

    // 1) id 매칭 — owner/repo rename 감지. slug 다르면 옛 파일을 새 slug 로 이동.
    const idMatch = byId.get(pr.id);
    if (idMatch && idMatch.prSlug !== newSlug) {
      await renamePortfolioCard(adapter, idMatch.prSlug, newSlug);
    }

    // 2) existing fetch (rename 후 새 slug 또는 같은 slug)
    const existing = await readPortfolioWork(adapter, newSlug);
    await upsertPortfolioWork(adapter, {
      search: pr,
      detail: phaseA[i].detail,
      existing,
      importedScreenshots: phaseA[i].imported,
    });
    if (existing) preserved++;
    else added++;
  }
  opts.onProgress?.(closed.length, closed.length);

  await writeSyncState(adapter, {
    last_sync: new Date().toISOString(),
    last_sync_pr_count: closed.length,
  });

  return { added, preserved, total: closed.length };
}
