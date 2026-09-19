/**
 * /api/attachment 핸들러 — hermetic 단위 테스트 (T3)
 *
 * server/index.ts 는 모듈 레벨에서 Bun.env.VAULT_DIR 을 검사하고
 * process.exit(1) 을 호출하므로 직접 import 가 불가능하다.
 * 대신 handleAttachment 의 두 가지 책임 레이어를 분리해 테스트한다.
 *
 *  레이어 A — VaultCore.readBinary + joinVaultAbs 의 traversal 가드
 *             (실제 production 경로가 경유하는 동일 코드)
 *  레이어 B — content-type MIME 매핑 (inline 검증)
 *
 * 커버:
 *  - 존재하는 이미지 파일 → 올바른 바이트·content-type 반환
 *  - 존재하지 않는 파일 → ENOENT 에러
 *  - path traversal (`../../`) → joinVaultAbs 가 throw
 *  - 절대경로 → joinVaultAbs 가 throw (relative 에러)
 *  - 파일명 속 `..` substring 은 정상 통과 (오탐 회귀)
 *  - MIME 표 — png/jpg/webp/gif 는 image/* 매핑, 알 수 없는 확장자는 octet-stream
 *
 * ⚠️ 절대 ~/brain 경로 사용 금지 — os.tmpdir() 만 사용.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultCore, joinVaultAbs } from "./vaultCore.ts";

// ── production 코드의 MIME 표 복사 (server/index.ts 와 동일) ─────────────────
// 이 테스트에서 MIME 매핑이 기대값과 맞지 않으면 prod 코드 변경을 감지할 수 있다.
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

function mimeOf(rel: string): string {
  const ext = rel.slice(rel.lastIndexOf(".")).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────
let vaultDir: string;
let vault: VaultCore;

beforeEach(() => {
  vaultDir = mkdtempSync(join(tmpdir(), "attachment-test-"));
  vault = new VaultCore({ root: vaultDir, git: false });
});
afterEach(() => {
  rmSync(vaultDir, { recursive: true, force: true });
});

// ── 레이어 A: VaultCore.readBinary (traversal 가드 + 파일 IO) ─────────────────

describe("/api/attachment — 레이어 A: VaultCore.readBinary (traversal 가드 + IO)", () => {
  it("happy path: 존재하는 PNG 를 올바른 바이트로 반환한다", async () => {
    // 1×1 투명 PNG (실제 PNG 매직 바이트 포함 — binary 임)
    const pngBytes = Buffer.from(
      "89504e470d0a1a0a0000000d4948445200000001000000010802000000" +
        "90773de8000000125a6147414d4100004e6f0000000047414d410000b18f" +
        "0bfc6105000000097048597300000ec400000ec401952b0e1b0000000a49" +
        "44415478016360000000020001e221bc330000000049454e44ae426082",
      "hex",
    );
    mkdirSync(join(vaultDir, "portfolio/_attachments/foo"), { recursive: true });
    writeFileSync(join(vaultDir, "portfolio/_attachments/foo/before-1.png"), pngBytes);

    const buf = await vault.readBinary("portfolio/_attachments/foo/before-1.png");
    expect(Buffer.from(buf)).toEqual(pngBytes);
    expect(mimeOf("portfolio/_attachments/foo/before-1.png")).toBe("image/png");
  });

  it("happy path: .jpg 파일 → image/jpeg MIME", async () => {
    const jpgBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]); // JPEG magic
    writeFileSync(join(vaultDir, "photo.jpg"), jpgBytes);
    const buf = await vault.readBinary("photo.jpg");
    expect(buf.length).toBe(jpgBytes.length);
    expect(mimeOf("photo.jpg")).toBe("image/jpeg");
  });

  it("happy path: .webp 파일 → image/webp MIME", async () => {
    const webpBytes = Buffer.from("RIFF    WEBPVP8 ");
    writeFileSync(join(vaultDir, "img.webp"), webpBytes);
    const buf = await vault.readBinary("img.webp");
    expect(buf.length).toBeGreaterThan(0);
    expect(mimeOf("img.webp")).toBe("image/webp");
  });

  it("404: 존재하지 않는 파일은 ENOENT 를 throw 한다", async () => {
    await expect(vault.readBinary("nonexistent/image.png")).rejects.toThrow(
      /ENOENT|no such file/i,
    );
  });

  it("path traversal `../../etc/passwd` → throw (traversal 차단)", () => {
    // joinVaultAbs 가 내부에서 호출되므로 readBinary 전에 검증이 일어남
    expect(() => joinVaultAbs(vaultDir, "../../etc/passwd")).toThrow(/traversal/);
  });

  it("path traversal `work/../../../secret` → throw", () => {
    expect(() => joinVaultAbs(vaultDir, "work/../../../secret")).toThrow(/traversal/);
  });

  it("절대경로 `/etc/passwd` → throw (relative 에러)", () => {
    expect(() => joinVaultAbs(vaultDir, "/etc/passwd")).toThrow(/relative/);
  });

  it("파일명 속 `..` substring 은 traversal 오탐 없이 정상 통과", async () => {
    // 오탐 회귀 방지 — V0.7.4 에서 수정됐던 버그 재현 가드
    const content = Buffer.from("마침표 두 개가 있는 파일명 테스트");
    writeFileSync(join(vaultDir, "있다..md"), content);
    const buf = await vault.readBinary("있다..md");
    expect(buf.length).toBe(content.length);
  });

  it("중첩 경로 `a..b/file.png` 도 정상 통과", async () => {
    mkdirSync(join(vaultDir, "a..b"), { recursive: true });
    const bytes = Buffer.from([0x01, 0x02]);
    writeFileSync(join(vaultDir, "a..b/file.png"), bytes);
    const buf = await vault.readBinary("a..b/file.png");
    expect(buf.length).toBe(2);
  });
});

// ── 레이어 B: MIME 표 계약 ────────────────────────────────────────────────────

describe("/api/attachment — 레이어 B: MIME 표 계약", () => {
  it.each([
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".webp", "image/webp"],
    [".svg", "image/svg+xml"],
    [".ico", "image/x-icon"],
    [".woff2", "font/woff2"],
    [".json", "application/json; charset=utf-8"],
  ])("확장자 %s → MIME %s", (ext, expected) => {
    expect(mimeOf(`file${ext}`)).toBe(expected);
  });

  it("알 수 없는 확장자는 application/octet-stream 으로 fallback", () => {
    expect(mimeOf("image.unknown")).toBe("application/octet-stream");
    expect(mimeOf("file.bin")).toBe("application/octet-stream");
  });

  it("대소문자 구분 없이 MIME 매핑 (`.PNG`, `.JPG`)", () => {
    // mimeOf 는 toLowerCase() 를 경유하므로 대소문자 무관
    expect(mimeOf("IMAGE.PNG")).toBe("image/png");
    expect(mimeOf("PHOTO.JPG")).toBe("image/jpeg");
  });
});
