// 런타임 seam: 탈출구(gh/claude/curl/zip/asset)를 로컬 서버로 위임한다.
//
// 브라우저·PWA 는 CLI(gh/claude/curl/zip)를 직접 못 돌린다 → 서버(server/index.ts,
// mac 위에서 구동)가 대신 실행하고 결과를 HTTP 로 돌려준다. 각 탈출구 모듈
// (gh.ts/claude.ts/imageDownload.ts/backup.ts/assetUrl.ts)은 여기를 거친다.
//
// degraded 표시: 서버가 안 뜨거나(offline/서버 다운) 실패하면 ShellUnavailableError 를
// 던진다 — 호출부가 이미 error 문자열을 UI 에 노출(silent fail 금지, design "폰에선
// degraded 표시").

// ── 공통 결과 타입 ───────────────────────────────────────────────────────────
export interface ShellResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface StreamChunk {
  stream: "stdout" | "stderr";
  data: string;
}

export interface ShellStreamController {
  done: Promise<ShellResult>;
  cancel: () => Promise<void>;
}

// 서버 미도달(offline/서버 다운) — 폰 degraded 신호. 호출부가 이 이름/메시지를
// 그대로 UI 에 노출한다.
export class ShellUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShellUnavailableError";
  }
}

// ── 서버 base URL — httpAdapter 와 동일 규칙(같은 origin 상대경로). ──────────────
const SERVER_BASE = "";

// ─────────────────────────────────────────────────────────────────────────────
// runShellCommand — 단발 실행(gh/curl/zip/claude -p 비스트리밍).
//
// program = "bash" | "sh". args = 이미 조립된 셸 인자(loginShellArgs 결과 등).
// 서버:  POST /api/shell/exec { program, args }.
// ─────────────────────────────────────────────────────────────────────────────
export async function runShellCommand(
  program: string,
  args: string[],
): Promise<ShellResult> {
  // 브라우저 경로 — mac 서버가 CLI 를 대신 실행.
  let res: Response;
  try {
    res = await fetch(`${SERVER_BASE}/api/shell/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ program, args }),
    });
  } catch (e) {
    throw new ShellUnavailableError(
      `서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 다시 시도하세요. (${(e as Error).message})`,
    );
  }
  if (!res.ok) {
    const msg = await safeErr(res);
    throw new ShellUnavailableError(
      `서버 명령 실행에 실패했습니다. 서버 상태를 확인하고 다시 시도하세요. (${msg})`,
    );
  }
  return (await res.json()) as ShellResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// runShellStream — 스트리밍 실행(claude 자동 요약의 stream-json).
//
// 서버:  POST /api/shell/stream (SSE) — event: chunk / event: done.
//
// onChunk 로 stdout/stderr 라인이 도착한다(개행 재부착은 호출부 책임 — 기존 claude.ts
// 동작 보존). cancel 은 SSE abort → 서버가 프로세스 kill.
// ─────────────────────────────────────────────────────────────────────────────
export function runShellStream(
  program: string,
  args: string[],
  onChunk: (chunk: StreamChunk) => void,
): ShellStreamController {
  return serverShellStream(program, args, onChunk);
}

function serverShellStream(
  program: string,
  args: string[],
  onChunk: (chunk: StreamChunk) => void,
): ShellStreamController {
  const controller = new AbortController();
  let stderrBuf = "";

  const done = (async (): Promise<ShellResult> => {
    let res: Response;
    try {
      res = await fetch(`${SERVER_BASE}/api/shell/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ program, args }),
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        return { stdout: "", stderr: stderrBuf.trim(), code: null };
      }
      throw new ShellUnavailableError(
        `서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 다시 시도하세요. (${(e as Error).message})`,
      );
    }
    if (!res.ok || !res.body) {
      const msg = await safeErr(res);
      throw new ShellUnavailableError(
        `서버 명령 실행에 실패했습니다. 서버 상태를 확인하고 다시 시도하세요. (${msg})`,
      );
    }

    // SSE 파싱 — event: chunk {stream,data} / event: done {code}.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let code: number | null = null;
    try {
      for (;;) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const evt = parseSseEvent(raw);
          if (!evt) continue;
          if (evt.event === "chunk") {
            try {
              const c = JSON.parse(evt.data) as StreamChunk;
              if (c.stream === "stderr") stderrBuf += c.data + "\n";
              onChunk(c);
            } catch {
              /* malformed */
            }
          } else if (evt.event === "done") {
            try {
              code = (JSON.parse(evt.data) as { code: number | null }).code;
            } catch {
              /* keep null */
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        return { stdout: "", stderr: stderrBuf.trim(), code: null };
      }
      throw new ShellUnavailableError(
        `서버 스트림이 끊겼습니다. 연결을 확인하고 다시 시도하세요. (${(e as Error).message})`,
      );
    }
    return { stdout: "", stderr: stderrBuf.trim(), code };
  })();

  return {
    done,
    cancel: async () => {
      controller.abort();
    },
  };
}

function parseSseEvent(raw: string): { event: string; data: string } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

// ─────────────────────────────────────────────────────────────────────────────
// attachmentUrl — vault 안 파일(portfolio 스크린샷/임베드 이미지)의 <img src>.
//
// 서버:  /api/attachment?path=<relPath> (서버가 VAULT_DIR 밑 파일을 서빙, traversal 가드).
//
// 입력은 vaultRoot(절대) + relPath(vault 상대). 서버는 rel 만 필요.
// vaultRoot 가 null 이면 relPath 그대로(테스트/미설정).
// ─────────────────────────────────────────────────────────────────────────────
export function attachmentUrl(
  _vaultRoot: string | null,
  relPath: string,
): string {
  // 서버 attachment 엔드포인트. relPath 만 필요(서버가 VAULT_DIR 붙임).
  if (relPath.startsWith("/") || /^(https?:|data:|blob:)/i.test(relPath)) {
    // 이미 절대 URL/데이터 URL 이면 그대로.
    return relPath;
  }
  return `${SERVER_BASE}/api/attachment?path=${encodeURIComponent(relPath)}`;
}

async function safeErr(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    return j.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
