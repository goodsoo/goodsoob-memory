// 메모 본문 (편집 모드 textarea) 안 이미지 paste / drag&drop 저장 helpers.
//
// 저장 경로: `{baseDir}/_attachments/{slug}/{N}.{ext}`. 메모는 baseDir=""
// (= brain root 의 `_attachments/`, brain 기존 컨벤션과 일치), slug = 메모 title
// kebab-case (fallback uid). portfolio 카드의
// `_portfolio/_attachments/{slug}/before-N.{ext}` 와 같은 패턴 — 자산 위치 일관.
//
// 본문에는 vault root 기준 상대 path 로 `![](_attachments/{slug}/{N}.{ext})`
// 박힘. MarkdownView 의 `resolveImageSrc` → `vaultAssetSrc` 가 그대로 처리.

import type { VaultAdapter } from "./vault/adapter";

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export function mimeToExt(mime: string): string | null {
  return MIME_EXT[mime.toLowerCase()] ?? null;
}

// title 같은 사용자 입력을 파일명 안전한 kebab-case 로. Unicode letter/digit (한글 포함)
// 은 유지, 그 외 문자는 hyphen 또는 제거. 빈 입력은 빈 문자열.
export function kebabCase(s: string): string {
  // NFKD/NFKC 같은 정규화 X — 한글이 자모로 분해되어 결과가 깨짐. 시스템 (macOS HFS+
  // NFD 등) 이 파일명 normalize 알아서 처리.
  return s
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

// `_attachments/{slug}/` 안 `{n}.{ext}` 패턴 파일들 보고 다음 N 반환. 빈/없음 → 1.
export async function nextAttachmentIndex(
  adapter: VaultAdapter,
  dir: string,
): Promise<number> {
  let entries: string[];
  try {
    entries = await adapter.list(dir);
  } catch {
    return 1;
  }
  let max = 0;
  for (const entry of entries) {
    const base = entry.split("/").pop() ?? "";
    const m = base.match(/^(\d+)\./);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export interface SaveAttachmentOpts {
  baseDir: string; // "" = vault root. 예: 메모는 "", 포트폴리오는 "_portfolio"
  slug: string; // 메모 단위 폴더명 — title kebab-case 또는 uid fallback
  file: File | Blob;
  // file.type 이 비어있을 때 (일부 clipboard 경로) override. 없으면 file.type 사용.
  mime?: string;
}

// 이미지를 vault 에 저장하고 vault root 기준 상대 path 반환. 호출자는 `![](path)` 형태로
// 본문 caret 위치에 insert. 미지원 MIME 이면 throw — 호출자가 catch 해서 무시 또는 toast.
export async function saveAttachment(
  adapter: VaultAdapter,
  opts: SaveAttachmentOpts,
): Promise<string> {
  const mime = opts.mime || opts.file.type;
  const ext = mimeToExt(mime);
  if (!ext) throw new Error(`unsupported image mime: ${mime || "(empty)"}`);
  if (!opts.slug) throw new Error("slug required");
  const dir = opts.baseDir
    ? `${opts.baseDir}/_attachments/${opts.slug}`
    : `_attachments/${opts.slug}`;
  await adapter.mkdir(dir);
  const n = await nextAttachmentIndex(adapter, dir);
  const relPath = `${dir}/${n}.${ext}`;
  const bytes = new Uint8Array(await opts.file.arrayBuffer());
  await adapter.writeBinary(relPath, bytes);
  return relPath;
}

// 본문에서 vault 안 첨부 path 추출. `![](path)` markdown 형식만. http(s)/data/asset 등
// 외부 URL 은 제외 — vault 안 파일만 cleanup 대상.
export function extractAttachmentRefs(body: string): string[] {
  const out: string[] = [];
  const re = /!\[[^\]]*\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    // markdown title `![](path "title")` 형식 처리 — 첫 공백 전까지가 path.
    const path = raw.split(/\s+/)[0];
    if (/^(https?:|data:|asset:|blob:|file:)/i.test(path)) continue;
    if (path.startsWith("#")) continue;
    out.push(path);
  }
  return out;
}

// orphan = `{baseDir}/_attachments/*/*` 안 첨부 파일 중 활성 + 휴지통 메모 어디서도
// 참조 안 하는 것. 휴지통도 검사 — 복원 시 깨짐 방지. 호출자가 결과 받아 size 합산이나
// 삭제 결정.
export async function findOrphanAttachments(
  adapter: VaultAdapter,
  baseDir: string,
): Promise<string[]> {
  const attachmentsRoot = baseDir ? `${baseDir}/_attachments` : `_attachments`;
  let files: string[];
  try {
    files = await adapter.listRecursive(attachmentsRoot);
  } catch {
    return [];
  }
  if (files.length === 0) return [];

  // 검사 대상 .md 파일 — 활성 baseDir 안 + vault root 의 .trash/ 안.
  // listRecursive 가 dotfile skip 이라 .trash 는 list 로 직접 (메모 본체는 dotfile 아님).
  const mdPaths: string[] = [];
  try {
    const active = await adapter.listRecursive(baseDir);
    for (const p of active) {
      if (p.endsWith(".md")) mdPaths.push(p);
    }
  } catch {
    // baseDir 자체 없음 — orphan 후보가 모두 orphan
  }
  try {
    const trashEntries = await adapter.list(".trash");
    for (const p of trashEntries) {
      if (p.endsWith(".md")) mdPaths.push(p);
    }
  } catch {
    // .trash 없음 — skip
  }

  const referenced = new Set<string>();
  for (const mdPath of mdPaths) {
    let content: string;
    try {
      content = await adapter.read(mdPath);
    } catch {
      continue;
    }
    for (const ref of extractAttachmentRefs(content)) {
      referenced.add(ref);
    }
  }

  return files.filter((f) => !referenced.has(f));
}

// orphan 파일들 vault 에서 삭제. 실패한 path 는 errors 로 반환 — 호출자가 일부 성공 +
// 일부 실패도 사용자에게 보여줄 수 있게.
export async function deleteAttachments(
  adapter: VaultAdapter,
  paths: string[],
): Promise<{ deleted: string[]; errors: Array<{ path: string; error: unknown }> }> {
  const deleted: string[] = [];
  const errors: Array<{ path: string; error: unknown }> = [];
  for (const p of paths) {
    try {
      await adapter.delete(p);
      deleted.push(p);
    } catch (error) {
      errors.push({ path: p, error });
    }
  }
  return { deleted, errors };
}
