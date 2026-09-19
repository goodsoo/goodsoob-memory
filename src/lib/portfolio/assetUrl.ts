// V0.7 step 9 — vault root 상대경로 (예: "portfolio/_attachments/owner-repo-42/before-1.jpg")
// → 서버 /api/attachment?path=<relPath>.
//
// 내부는 runtime.ts 의 attachmentUrl() 에 위임.

import { attachmentUrl } from "../runtime";

export function vaultAssetSrc(
  vaultRoot: string | null,
  relPath: string,
): string {
  // 이미 절대 URL / 데이터 URL 이면 그대로 (기존 동작 보존).
  if (/^(https?:|data:|blob:|asset:)/i.test(relPath)) return relPath;
  return attachmentUrl(vaultRoot, relPath);
}
