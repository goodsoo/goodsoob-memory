// V0.7.x — PR body 이미지 다운로드. 브라우저 fetch 는 CORS 막혀서 user-attachments
// URL 같은 외부 이미지 직접 fetch 못 함. 로컬 서버 curl 위임으로 우회.
//
// curl 은 macOS 기본 + linux/win 표준 — 추가 dep 0. fail fast: --max-time 30,
// --fail (HTTP 4xx/5xx exit nonzero). 실패해도 sync 전체는 안 죽음 (best effort).
//
// 저장 위치는 vault root 의 상대 path. vault adapter 의 mkdir 로 디렉토리 보장한 후
// curl 이 vault abs path 에 직접 write. tmp .part 거치지 않음 — 1인 사용 도구 단순성 우선,
// partial 파일은 다음 sync 가 다시 시도.

import { runShellCommand } from "../runtime";
import type { VaultAdapter } from "../vault/adapter";
import { shellSingleQuote } from "./gh";

export class ImageDownloadError extends Error {
  url: string;
  stderr: string;
  code: number | null;
  constructor(url: string, stderr: string, code: number | null) {
    super(`이미지 다운로드 실패 (${url}): ${stderr || `code ${code}`}`);
    this.name = "ImageDownloadError";
    this.url = url;
    this.stderr = stderr;
    this.code = code;
  }
}

const CURL_MAX_TIME_SEC = 30;
const CURL_MAX_BYTES = 20 * 1024 * 1024; // 20MB 상한 — gif/스크린샷은 안전.

// vault root 의 abs path 가 필요. adapter.getRoot() 가 setRoot 안 한 경우 null.
function vaultAbsPath(adapter: VaultAdapter, relPath: string): string {
  const root = adapter.getRoot();
  if (!root) throw new Error("vault root not set");
  if (relPath.startsWith("/")) throw new Error("expected relative path");
  // 세그먼트 단위 traversal 차단 — substring `..` 는 정상 파일명(`a..b`) 을 오탐.
  if (relPath.split("/").some((seg) => seg === "..")) {
    throw new Error("path traversal blocked");
  }
  const r = root.endsWith("/") ? root.slice(0, -1) : root;
  return `${r}/${relPath}`;
}

function dirOf(relPath: string): string {
  const i = relPath.lastIndexOf("/");
  return i < 0 ? "" : relPath.slice(0, i);
}

export async function downloadImageToVault(
  adapter: VaultAdapter,
  relPath: string,
  url: string,
): Promise<void> {
  // 부모 dir 보장 (adapter 가 vault root 기준 mkdir).
  const dir = dirOf(relPath);
  if (dir) await adapter.mkdir(dir);

  const dest = vaultAbsPath(adapter, relPath);
  // curl 인자: -L (follow redirect, user-attachments 가 CDN 으로 302),
  //  -sS (progress 끄고 error 만 stderr), --fail (HTTP error 시 exit nonzero),
  //  --max-time / --max-filesize 안전망.
  const curlCmd =
    `curl -L -sS --fail --max-time ${CURL_MAX_TIME_SEC} ` +
    `--max-filesize ${CURL_MAX_BYTES} ` +
    `-o ${shellSingleQuote(dest)} ${shellSingleQuote(url)}`;
  const result = await runShellCommand("sh", ["-lc", curlCmd]);
  if (result.code !== 0) {
    throw new ImageDownloadError(url, result.stderr, result.code);
  }
}
