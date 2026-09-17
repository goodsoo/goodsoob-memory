/**
 * serverShell (T3) — 서버 측 CLI 실행 (gh/claude/curl/zip/open).
 *
 * 폰·브라우저는 CLI 를 못 돌린다 → 이 mac 서버가 대신 실행하고 결과를 HTTP 로
 * 돌려준다. client 의 src/lib/runtime.ts 가 여기로 라우팅한다.
 *
 * ⚠️ release PATH footgun 보존 (CLAUDE.md / gh.ts 헤더):
 *   gh(~/.local/bin)·claude(nvm)·brew 는 launchd 최소 PATH 밖. login 셸(bash -lc)이라야
 *   ~/.bash_profile 이 로딩되며 PATH 에 들어온다. client 가 program="bash",
 *   args=["-lc", cmdStr] (loginShellArgs 결과) 를 그대로 넘기므로 여기선 재래핑 없이
 *   Bun.spawn 으로 실행만 한다 — single source 는 여전히 client 의 loginShellArgs.
 *
 * 보안: loopback only 바인딩(index.ts) + 허용 program allowlist(bash/sh)로 최소화.
 *   임의 program 실행은 거부(폰이 접근하는 표면 최소화). 인자는 client 가 이미
 *   shellSingleQuote 로 escape 한 cmdStr 안에 있음 — 서버는 program·args 구조만 검증.
 */

// ── Bun ambient (@types/bun 미설치 — 우리가 쓰는 표면만) ─────────────────────
declare const Bun: {
  spawn(
    cmd: string[],
    opts?: {
      stdout?: "pipe";
      stderr?: "pipe";
      stdin?: "ignore";
    },
  ): {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
    kill(signal?: number): void;
  };
};

// 허용 program — 폰이 임의 바이너리를 못 돌리게 최소화. client 가 쓰는 것만.
const ALLOWED_PROGRAMS = new Set(["bash", "sh"]);

export interface ShellResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export class ShellRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShellRejectedError";
  }
}

function validate(program: string, args: string[]): void {
  if (!ALLOWED_PROGRAMS.has(program)) {
    throw new ShellRejectedError(
      `허용되지 않은 program: ${program} (bash/sh 만 가능)`,
    );
  }
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
    throw new ShellRejectedError("args 는 string[] 여야 합니다.");
  }
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

/** 단발 실행 — gh/curl/zip/open/claude -p. stdout/stderr 전량 수집 후 반환. */
export async function runShell(
  program: string,
  args: string[],
): Promise<ShellResult> {
  validate(program, args);
  const proc = Bun.spawn([program, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, code] = await Promise.all([
    drain(proc.stdout),
    drain(proc.stderr),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

export interface StreamHandlers {
  onChunk: (stream: "stdout" | "stderr", data: string) => void;
  onDone: (code: number | null) => void;
}

export interface StreamHandle {
  cancel: () => void;
}

/**
 * 스트리밍 실행 — claude 자동 요약(stream-json NDJSON). stdout/stderr 를 chunk 단위로
 * 흘리고 종료 시 code. cancel() 로 프로세스 kill.
 */
export function runShellStream(
  program: string,
  args: string[],
  handlers: StreamHandlers,
): StreamHandle {
  validate(program, args);
  const proc = Bun.spawn([program, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const decoder = new TextDecoder();
  const pump = async (
    stream: ReadableStream<Uint8Array>,
    which: "stdout" | "stderr",
  ): Promise<void> => {
    const reader = stream.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) handlers.onChunk(which, text);
    }
  };

  void (async () => {
    await Promise.all([pump(proc.stdout, "stdout"), pump(proc.stderr, "stderr")]);
    const code = await proc.exited;
    handlers.onDone(code);
  })();

  return {
    cancel: () => {
      try {
        proc.kill();
      } catch {
        /* 이미 종료 */
      }
    },
  };
}
