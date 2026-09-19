// V0.7 step 9 — 스크린샷 저장 (binary write via VaultAdapter).
//
// vault root 기준 `portfolio/_attachments/{slug}/{label}-{n}.jpg`.
// design v2.3: PNG → 1600px JPEG (canvas 다운스케일) + adapter.writeBinary
// (Tauri fs 직접 write → 서버 위임으로 전환, atomic tmp→rename + per-path lock 공유).

import { attachmentsDirFor, type ScreenshotLabel } from "../../api/portfolio";
import type { VaultAdapter } from "../vault/adapter";
import { downscaleToJpeg } from "./image";

export interface SaveScreenshotInput {
  adapter: VaultAdapter;
  prSlug: string;
  file: File | Blob;
  label: ScreenshotLabel;
}

export interface SaveScreenshotResult {
  path: string; // vault root 상대 경로 — frontmatter screenshots[].path 에 저장
  width: number;
  height: number;
  bytes: number;
}

// 다음 사용 가능한 파일명 찾기. {label}-1.jpg, {label}-2.jpg, ...
async function nextAvailableName(
  adapter: VaultAdapter,
  relDir: string,
  prefix: string,
): Promise<string> {
  let n = 1;
  try {
    const paths = await adapter.list(relDir);
    const used = new Set(paths.map((p) => p.split("/").pop() ?? ""));
    while (used.has(`${prefix}-${n}.jpg`)) n++;
  } catch {
    // dir 없으면 1 부터.
  }
  return `${prefix}-${n}.jpg`;
}

export async function saveScreenshot(
  input: SaveScreenshotInput,
): Promise<SaveScreenshotResult> {
  const relDir = attachmentsDirFor(input.prSlug);

  // 디렉토리 보장 (adapter 가 vault root 기준 recursive mkdir).
  await input.adapter.mkdir(relDir);

  const { bytes, width, height } = await downscaleToJpeg(input.file);

  const prefix = input.label ?? "screenshot";
  const filename = await nextAvailableName(input.adapter, relDir, prefix);
  const relPath = `${relDir}/${filename}`;
  await input.adapter.writeBinary(relPath, bytes);

  return {
    path: relPath,
    width,
    height,
    bytes: bytes.length,
  };
}
