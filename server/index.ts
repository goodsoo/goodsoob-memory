/**
 * goodsoob-memory 로컬 서버 (T2) — Bun 런타임
 *
 * 정본 vault(VAULT_DIR, git repo)를 소유하는 단일 writer. 폰·air·Pro 모두
 * 브라우저로 이 서버에 접속한다. tower·growth 와 동일 골격(로컬 서버 + launchd 상주).
 *
 * 책임:
 *  1. Vite 빌드(dist/) 정적 서빙 + hash 라우팅이라 SPA fallback = 그냥 index.html.
 *  2. /api/vault/* — VaultAdapter 전 메서드 백엔드 (read/write/list/delete/rename/
 *     exists/mkdir/readMeta).
 *  3. /api/vault/watch — SSE (fs 변경 → VaultWatchEvent). 재연결 친화.
 *  4. git 안전망 — 매 write 를 debounce squash 로 커밋 (매 write 커밋 X). 복구 API.
 *
 * ⚠️ 안전 (T0 미완):
 *  - VAULT_DIR 은 필수 env, ~/brain 으로 resolve 되는 default 없음.
 *  - 바인딩 = 127.0.0.1 loopback only (절대 0.0.0.0 아님). tailscale 노출은 T4b 에서
 *    tailscale serve 가 loopback 앞에 붙이는 방식(서버 자체는 loopback 만 연다).
 *  - ~/brain 라이브 구동은 T0(.git iCloud 밖 분리·gc·데몬 조율) 완료 후로 유보.
 *
 * 실행: VAULT_DIR=/path/to/vault bun run server/index.ts
 */

import { watch as fsWatch } from "node:fs";
import { join, extname } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { VaultCore, type FileMeta } from "./vaultCore.ts";
import {
  runShell,
  runShellStream,
  ShellRejectedError,
  type ShellResult,
} from "./shell.ts";

// ── Bun 런타임 ambient (⚠️ @types/bun 미설치 — 우리가 쓰는 표면만 최소 선언) ──
declare const Bun: {
  serve(opts: {
    port: number;
    hostname: string;
    fetch: (req: Request) => Response | Promise<Response>;
  }): { port: number; hostname: string; stop(): void };
  env: Record<string, string | undefined>;
};

const PORT = 7080; // 고정 (conductor 가 launchd plist 를 이 값으로 템플릿)
const HOST = "127.0.0.1"; // loopback only — 절대 0.0.0.0 아님

// ── VAULT_DIR (필수, ~/brain default 없음) ───────────────────────────────────
const VAULT_DIR = Bun.env.VAULT_DIR;
if (!VAULT_DIR) {
  console.error(
    "[server] VAULT_DIR 환경변수가 필요합니다. ~/brain 은 기본값이 아닙니다(T0 미완).\n" +
      "  예: VAULT_DIR=/path/to/vault bun run server/index.ts",
  );
  process.exit(1);
}

// 앱 전용 subtree 로 커밋 범위 한정(옵션). 비우면 vault 전체.
const VAULT_SUBTREE = Bun.env.VAULT_SUBTREE ?? "";
const DIST_DIR = Bun.env.DIST_DIR ?? join(process.cwd(), "dist");

const vault = new VaultCore({
  root: VAULT_DIR,
  subtree: VAULT_SUBTREE,
  git: Bun.env.VAULT_GIT !== "0",
  debounceMs: Number(Bun.env.VAULT_COMMIT_DEBOUNCE_MS) || 3000,
});
vault.ensureGit();

// ── SSE watch 브로드캐스트 ───────────────────────────────────────────────────
type WatchEvent =
  | { type: "created"; path: string }
  | { type: "modified"; path: string }
  | { type: "deleted"; path: string }
  | { type: "renamed"; from: string; to: string };

const sseClients = new Set<(ev: WatchEvent) => void>();

function broadcast(ev: WatchEvent): void {
  for (const send of sseClients) {
    try {
      send(ev);
    } catch {
      /* 개별 클라이언트 오류 무시 — 끊긴 스트림은 cancel 에서 정리 */
    }
  }
}

// fs.watch 로 vault 변경 감지 → VaultWatchEvent 로 정규화.
// rename 이벤트는 notify 처럼 from/to 를 못 주므로 존재 여부로 created/deleted 판정.
if (existsSync(VAULT_DIR)) {
  try {
    fsWatch(VAULT_DIR, { recursive: true }, (event, filename) => {
      if (!filename) return;
      const rel = filename.toString();
      const segs = rel.split("/");
      // dot-prefix 세그먼트가 어디든 끼면 무시 — `.git/**` 내부 churn(커밋마다 폭주),
      // `.trash/`, `.icloud` placeholder 등. atomic write tmp 도 제외.
      if (segs.some((s) => s.startsWith("."))) return;
      if (rel.endsWith(".tmp")) return;
      const abs = join(VAULT_DIR, rel);
      if (event === "rename") {
        // fs.watch 의 "rename" = 생성 또는 삭제. 존재 여부로 구분.
        broadcast(
          existsSync(abs)
            ? { type: "created", path: rel }
            : { type: "deleted", path: rel },
        );
      } else {
        broadcast({ type: "modified", path: rel });
      }
    });
  } catch (e) {
    console.warn("[server] fs.watch 실패(무시):", (e as Error).message);
  }
}

// ── HTTP 헬퍼 ────────────────────────────────────────────────────────────────
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function err(message: string, status = 500): Response {
  return json({ error: message }, status);
}

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

async function serveStatic(pathname: string): Promise<Response | null> {
  // 정적 파일만 — traversal 은 정규화된 경로가 DIST_DIR 밖이면 거부.
  const clean = pathname.replace(/\/+/g, "/");
  if (clean.includes("..")) return null;
  const filePath = join(DIST_DIR, clean);
  if (!filePath.startsWith(DIST_DIR)) return null;
  if (!existsSync(filePath)) return null;
  try {
    const body = await readFile(filePath);
    const mime = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    return new Response(new Uint8Array(body), {
      headers: { "content-type": mime },
    });
  } catch {
    return null;
  }
}

async function serveIndexHtml(): Promise<Response> {
  const indexPath = join(DIST_DIR, "index.html");
  if (!existsSync(indexPath)) {
    return new Response(
      "dist/index.html 이 없습니다. `bun run build` 후 서버를 실행하세요.",
      { status: 404 },
    );
  }
  const html = await readFile(indexPath, "utf8");
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// ── 라우팅 ───────────────────────────────────────────────────────────────────
async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;

  // ── /api/vault/* ──────────────────────────────────────────────────────────
  if (pathname.startsWith("/api/vault/")) {
    try {
      return await handleVaultApi(req, url, pathname);
    } catch (e) {
      const msg = (e as Error).message || String(e);
      if (/path traversal|expected relative/.test(msg)) return err(msg, 400);
      if (/ENOENT|no such file/i.test(msg)) return err(msg, 404);
      return err(msg, 500);
    }
  }

  // ── /api/shell/* (T3 — CLI 탈출구: gh/claude/curl/zip/open) ─────────────────
  if (pathname === "/api/shell/exec" && req.method === "POST") {
    return handleShellExec(req);
  }
  if (pathname === "/api/shell/stream" && req.method === "POST") {
    return handleShellStream(req);
  }

  // ── /api/attachment (T3 — asset:// 대체: vault 안 이미지 서빙) ──────────────
  if (pathname === "/api/attachment" && req.method === "GET") {
    return handleAttachment(url);
  }

  // ── 정적 서빙 + SPA fallback ────────────────────────────────────────────────
  // hash 라우팅(#today, #meeting-{uid})이라 fragment 는 서버에 안 온다.
  // 규칙: dist/ 밑(root 든 하위 든)에 실제 파일이 있으면 그걸 서빙(manifest.json·
  // sw.js·icons·favicon — T4 가 추가), 없으면 SPA shell(index.html).
  if (req.method === "GET") {
    if (pathname === "/" || pathname === "/index.html") return serveIndexHtml();
    const asset = await serveStatic(pathname);
    if (asset) return asset;
    return serveIndexHtml(); // 실제 파일 없음 → SPA shell
  }
  return err("Not Found", 404);
}

async function handleVaultApi(
  req: Request,
  url: URL,
  pathname: string,
): Promise<Response> {
  const p = url.searchParams;

  // GET /api/vault/init — 웹앱 모드 자동 연결: 서버가 소유한 VAULT_DIR 반환
  if (pathname === "/api/vault/init" && req.method === "GET") {
    return json({ vaultPath: VAULT_DIR });
  }

  // GET /api/vault/watch — SSE
  if (pathname === "/api/vault/watch" && req.method === "GET") {
    return watchSse();
  }

  // GET /api/vault/read?path=
  if (pathname === "/api/vault/read" && req.method === "GET") {
    const rel = requireParam(p, "path");
    const content = await vault.read(rel);
    return json({ content });
  }

  // GET /api/vault/exists?path=
  if (pathname === "/api/vault/exists" && req.method === "GET") {
    const rel = requireParam(p, "path");
    return json({ exists: await vault.exists(rel) });
  }

  // GET /api/vault/meta?path=
  if (pathname === "/api/vault/meta" && req.method === "GET") {
    const rel = requireParam(p, "path");
    const meta: FileMeta = await vault.readMeta(rel);
    return json(meta);
  }

  // GET /api/vault/list?subdir=&mode=flat|recursive|folders
  if (pathname === "/api/vault/list" && req.method === "GET") {
    const subdir = p.get("subdir") ?? "";
    const mode = p.get("mode") ?? "flat";
    let paths: string[];
    if (mode === "recursive") paths = vault.listRecursive(subdir);
    else if (mode === "folders") paths = vault.listFoldersRecursive(subdir);
    else paths = vault.list(subdir);
    return json({ paths });
  }

  // GET /api/vault/scanAll?dir=
  if (pathname === "/api/vault/scanAll" && req.method === "GET") {
    const dir = p.get("dir") ?? "";
    const entries = await vault.scanAll(dir);
    return json({ entries });
  }

  // GET /api/vault/history?path=
  if (pathname === "/api/vault/history" && req.method === "GET") {
    const rel = requireParam(p, "path");
    return json({ history: vault.history(rel) });
  }

  // GET /api/vault/version?path=&ref=
  if (pathname === "/api/vault/version" && req.method === "GET") {
    const rel = requireParam(p, "path");
    const ref = requireParam(p, "ref");
    const content = vault.version(rel, ref);
    if (content === null) return err("version not found", 404);
    return json({ content });
  }

  // POST /api/vault/write  { path, content }
  if (pathname === "/api/vault/write" && req.method === "POST") {
    const body = (await req.json()) as { path?: string; content?: string };
    if (typeof body.path !== "string" || typeof body.content !== "string")
      return err("path·content 필수", 400);
    // expectedMtime 은 무시(no-op) — lossless append-only, ConflictError 없음.
    const meta = await vault.write(body.path, body.content);
    return json(meta);
  }

  // POST /api/vault/writeBinary?path=  (raw body = bytes)
  if (pathname === "/api/vault/writeBinary" && req.method === "POST") {
    const rel = requireParam(p, "path");
    const buf = new Uint8Array(await req.arrayBuffer());
    const meta = await vault.writeBinary(rel, buf);
    return json(meta);
  }

  // POST /api/vault/delete  { path, recursive? }
  if (pathname === "/api/vault/delete" && req.method === "POST") {
    const body = (await req.json()) as { path?: string; recursive?: boolean };
    if (typeof body.path !== "string") return err("path 필수", 400);
    await vault.delete(body.path, body.recursive === true);
    return json({ ok: true });
  }

  // POST /api/vault/rename  { from, to }
  if (pathname === "/api/vault/rename" && req.method === "POST") {
    const body = (await req.json()) as { from?: string; to?: string };
    if (typeof body.from !== "string" || typeof body.to !== "string")
      return err("from·to 필수", 400);
    await vault.rename(body.from, body.to);
    return json({ ok: true });
  }

  // POST /api/vault/mkdir  { path }
  if (pathname === "/api/vault/mkdir" && req.method === "POST") {
    const body = (await req.json()) as { path?: string };
    if (typeof body.path !== "string") return err("path 필수", 400);
    await vault.mkdir(body.path);
    return json({ ok: true });
  }

  return err("Not Found", 404);
}

function requireParam(p: URLSearchParams, name: string): string {
  const v = p.get(name);
  if (v === null) throw new Error(`missing param: ${name}`);
  return v;
}

// ── /api/shell/* — CLI 탈출구 (gh/claude/curl/zip/open) ──────────────────────
// client(runtime.ts)가 { program: "bash"|"sh", args: [...] } 를 보냄. args 는
// 이미 loginShellArgs(bash -lc)/shellSingleQuote 로 조립됨 — 서버는 spawn 만.
async function handleShellExec(req: Request): Promise<Response> {
  let body: { program?: unknown; args?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err("잘못된 요청 본문(JSON 파싱 실패)", 400);
  }
  if (typeof body.program !== "string" || !Array.isArray(body.args)) {
    return err("program(string)·args(string[]) 필수", 400);
  }
  try {
    const result: ShellResult = await runShell(
      body.program,
      body.args as string[],
    );
    return json(result);
  } catch (e) {
    if (e instanceof ShellRejectedError) return err(e.message, 400);
    return err(`shell 실행 실패: ${(e as Error).message}`, 500);
  }
}

// SSE 스트리밍 — claude 자동 요약(stream-json). event: chunk {stream,data} /
// event: done {code}. 클라이언트 abort(연결 끊김) → 프로세스 kill.
function handleShellStream(req: Request): Response {
  const encoder = new TextEncoder();
  let handle: { cancel: () => void } | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      let body: { program?: unknown; args?: unknown };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ error: "JSON 파싱 실패" })}\n\n`,
          ),
        );
        controller.close();
        return;
      }
      if (typeof body.program !== "string" || !Array.isArray(body.args)) {
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ error: "program·args 필수" })}\n\n`,
          ),
        );
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      let closed = false;
      try {
        handle = runShellStream(body.program, body.args as string[], {
          onChunk: (streamName, data) => {
            if (closed) return;
            try {
              controller.enqueue(
                encoder.encode(
                  `event: chunk\ndata: ${JSON.stringify({ stream: streamName, data })}\n\n`,
                ),
              );
            } catch {
              closed = true;
            }
          },
          onDone: (code) => {
            if (closed) return;
            closed = true;
            try {
              controller.enqueue(
                encoder.encode(
                  `event: done\ndata: ${JSON.stringify({ code })}\n\n`,
                ),
              );
              controller.close();
            } catch {
              /* 이미 닫힘 */
            }
          },
        });
      } catch (e) {
        const msg =
          e instanceof ShellRejectedError
            ? e.message
            : `shell 실행 실패: ${(e as Error).message}`;
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`,
          ),
        );
        controller.close();
      }
    },
    cancel() {
      handle?.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

// ── /api/attachment?path= — asset:// 대체. VAULT_DIR 밑 파일을 서빙. ──────────
// vaultCore 의 traversal 가드(joinVaultAbs)를 readBinary 가 경유하므로 재사용.
async function handleAttachment(url: URL): Promise<Response> {
  const rel = url.searchParams.get("path");
  if (!rel) return err("path 필수", 400);
  try {
    const buf = await vault.readBinary(rel);
    const mime =
      MIME[extname(rel).toLowerCase()] ?? "application/octet-stream";
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": mime,
        // vault 안 이미지는 사적 — 캐시는 브라우저 세션 내로만.
        "cache-control": "private, max-age=60",
      },
    });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    if (/path traversal|expected relative/.test(msg)) return err(msg, 400);
    if (/ENOENT|no such file/i.test(msg)) return err("파일 없음", 404);
    return err(msg, 500);
  }
}

// ── SSE ──────────────────────────────────────────────────────────────────────
function watchSse(): Response {
  const encoder = new TextEncoder();
  let send: (ev: WatchEvent) => void = () => {};
  const stream = new ReadableStream({
    start(controller) {
      // 재연결 친화: retry 힌트 + 초기 ready 이벤트.
      controller.enqueue(encoder.encode("retry: 3000\n"));
      controller.enqueue(
        encoder.encode(`event: ready\ndata: {"ok":true}\n\n`),
      );
      send = (ev: WatchEvent) => {
        controller.enqueue(
          encoder.encode(`event: change\ndata: ${JSON.stringify(ev)}\n\n`),
        );
      };
      sseClients.add(send);
      // keepalive comment (Bun idleTimeout 방지 — 8초마다, idleTimeout=255 이내).
      const ka = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(ka);
        }
      }, 8000);
      (controller as unknown as { _ka?: ReturnType<typeof setInterval> })._ka =
        ka;
    },
    cancel() {
      sseClients.delete(send);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

// ── 종료 시 커밋 flush (안전망 유실 방지) ─────────────────────────────────────
async function shutdown(): Promise<void> {
  try {
    await vault.flushCommit();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

// Bun 기본 idleTimeout=10s 는 SSE·대량 스캔 요청(포트폴리오 492 파일 순차 read)을
// 끊어 ERR_INCOMPLETE_CHUNKED_ENCODING 을 유발한다. 최대값(uint8=255)으로 설정.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const server = Bun.serve({ port: PORT, hostname: HOST, fetch: handle, idleTimeout: 255 } as any);
console.log(
  `[server] goodsoob-memory listening on http://${server.hostname}:${server.port}` +
    ` — VAULT_DIR=${VAULT_DIR}`,
);
