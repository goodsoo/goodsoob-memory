// V0.7 step 9 — vault root 상대경로 (예: "portfolio/_attachments/owner-repo-42/before-1.jpg")
// → Tauri: asset:// URL / 브라우저: /api/attachment?path=<relPath>.
//
// 내부는 runtime.ts 의 attachmentUrl() 에 위임 — isTauri 분기를 한 곳에서만 관리.
// convertFileSrc 를 직접 import 하지 않으므로 브라우저(서버) 모드에서 TypeError 없음.

import { attachmentUrl } from "../runtime";

export function vaultAssetSrc(
  vaultRoot: string | null,
  relPath: string,
): string {
  // 이미 절대 URL / 데이터 URL 이면 그대로 (기존 동작 보존).
  if (/^(https?:|data:|blob:|asset:)/i.test(relPath)) return relPath;
  return attachmentUrl(vaultRoot, relPath);
}
