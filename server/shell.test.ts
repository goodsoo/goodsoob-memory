/**
 * /api/shell/* 핸들러 — hermetic 단위 테스트 (T3)
 *
 * ── 구조적 제약 ──
 *
 * shell.ts 는 `declare const Bun` ambient 선언으로 Bun 런타임 globals 에 의존한다.
 * Vitest 는 Node.js 런타임이므로 Bun 이 실제로 없다. 따라서:
 *
 *  A) validate() — Bun.spawn 이전에 ShellRejectedError 를 throw 하는 순수 로직.
 *     실제 모듈을 import 해 직접 테스트 가능. Bun 의존 없음.
 *
 *  B) runShell / runShellStream — Bun.spawn 호출 이후 로직.
 *     vi.mock 으로 globalThis.Bun 을 stub 해서 Node.js 환경에서 테스트한다.
 *     stub 이 실제 Bun.spawn 동작을 흉내 내므로 stdout/stderr/code 계약 검증 가능.
 *
 * ── 커버 ──
 *  1. allowlist 검증 — 거부해야 할 program 들이 ShellRejectedError 를 던지는지
 *  2. runShell stdout/stderr/code 계약 (Bun.spawn stub)
 *  3. runShell 비정상 exit code 전달
 *  4. runShellStream onChunk / onDone 콜백 계약 (Bun.spawn stub)
 *  5. runShellStream cancel() 인터페이스
 *  6. handleShellExec 응답 구조 계약 (JSON 형태: stdout/stderr/code)
 *
 * ⚠️ ~/brain 경로 절대 사용 금지. 외부 네트워크 없음. 실제 gh/claude 실행 X.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runShell,
  runShellStream,
  ShellRejectedError,
} from "./shell.ts";

// ── Bun.spawn stub 헬퍼 ────────────────────────────────────────────────────
// Node.js 환경에서 Bun global 을 흉내 냄.
// ReadableStream(WHATWG) 을 돌려주는 minimal stub.

function makeReadableStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else {
        controller.close();
      }
    },
  });
}

interface SpawnStubOpts {
  stdoutChunks?: string[];
  stderrChunks?: string[];
  exitCode?: number;
  /** exited promise 를 즉시 resolve 하지 않고 cancel() 테스트용으로 지연 */
  delayExitMs?: number;
  killFn?: () => void;
}

function installBunStub(opts: SpawnStubOpts = {}): void {
  const enc = new TextEncoder();
  const {
    stdoutChunks = [],
    stderrChunks = [],
    exitCode = 0,
    delayExitMs = 0,
    killFn,
  } = opts;

  const spawnMock = vi.fn(() => ({
    stdout: makeReadableStream(stdoutChunks.map((s) => enc.encode(s))),
    stderr: makeReadableStream(stderrChunks.map((s) => enc.encode(s))),
    exited:
      delayExitMs > 0
        ? new Promise<number>((resolve) =>
            setTimeout(() => resolve(exitCode), delayExitMs),
          )
        : Promise.resolve(exitCode),
    kill: killFn ?? vi.fn(),
  }));

  // globalThis.Bun — shell.ts 가 `declare const Bun` 으로 global 에서 읽음
  (globalThis as unknown as Record<string, unknown>).Bun = { spawn: spawnMock };
}

beforeEach(() => {
  // 각 테스트 전 clean state — Bun stub 초기화
  delete (globalThis as unknown as Record<string, unknown>).Bun;
});

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).Bun;
  vi.restoreAllMocks();
});

// ── 1. allowlist 검증 (Bun.spawn 이전 — Bun 없이도 테스트 가능) ──────────────

describe("shell allowlist — 허용되지 않은 program 거부 (Bun 없이도 동작)", () => {
  it("임의 바이너리(gh)는 ShellRejectedError 를 throw 한다", async () => {
    await expect(runShell("gh", ["auth", "status"])).rejects.toThrow(
      ShellRejectedError,
    );
  });

  it("임의 바이너리(curl)는 ShellRejectedError 를 throw 한다", async () => {
    await expect(runShell("curl", ["https://example.com"])).rejects.toThrow(
      ShellRejectedError,
    );
  });

  it("임의 바이너리(python3)는 ShellRejectedError 를 throw 한다", async () => {
    await expect(runShell("python3", ["-c", "print('x')"])).rejects.toThrow(
      ShellRejectedError,
    );
  });

  it("빈 문자열 program 은 ShellRejectedError 를 throw 한다", async () => {
    await expect(runShell("", [])).rejects.toThrow(ShellRejectedError);
  });

  it("ShellRejectedError 메시지에 program 이름이 포함된다", async () => {
    try {
      await runShell("notallowed", []);
      expect.fail("throw 해야 했음");
    } catch (e) {
      expect(e).toBeInstanceOf(ShellRejectedError);
      expect((e as ShellRejectedError).message).toContain("notallowed");
    }
  });

  it("runShellStream 도 동일하게 ShellRejectedError 를 throw 한다 (Bun 없이)", () => {
    expect(() =>
      runShellStream("gh", ["pr", "list"], {
        onChunk: () => {},
        onDone: () => {},
      }),
    ).toThrow(ShellRejectedError);
  });

  it("node 도 허용 X → ShellRejectedError", () => {
    expect(() =>
      runShellStream("node", ["-e", "console.log('x')"], {
        onChunk: () => {},
        onDone: () => {},
      }),
    ).toThrow(ShellRejectedError);
  });
});

// ── 2. runShell stdout/stderr/code 계약 (Bun.spawn stub) ─────────────────

describe("runShell — bash/sh 단발 실행 계약 (Bun.spawn stub)", () => {
  it("stdout 이 ShellResult.stdout 에 들어온다", async () => {
    installBunStub({ stdoutChunks: ["hello\n"], exitCode: 0 });
    const result = await runShell("bash", ["-c", "echo hello"]);
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  });

  it("code=0 반환", async () => {
    installBunStub({ exitCode: 0 });
    const result = await runShell("bash", ["-c", "exit 0"]);
    expect(result.code).toBe(0);
  });

  it("비정상 exit code=1 이 code 필드에 전달된다", async () => {
    installBunStub({ exitCode: 1 });
    const result = await runShell("bash", ["-c", "exit 1"]);
    expect(result.code).toBe(1);
    expect(typeof result.code).toBe("number");
  });

  it("임의 exit code=42 전달", async () => {
    installBunStub({ exitCode: 42 });
    const result = await runShell("bash", ["-c", "exit 42"]);
    expect(result.code).toBe(42);
  });

  it("stderr 내용이 stderr 필드에 들어온다", async () => {
    installBunStub({ stderrChunks: ["errout\n"], exitCode: 0 });
    const result = await runShell("bash", ["-c", "echo errout >&2"]);
    expect(result.stderr).toBe("errout\n");
    expect(result.stdout).toBe("");
  });

  it("stdout 과 stderr 를 동시에 반환한다", async () => {
    installBunStub({
      stdoutChunks: ["outval\n"],
      stderrChunks: ["errval\n"],
      exitCode: 0,
    });
    const result = await runShell("bash", [
      "-c",
      "echo outval; echo errval >&2",
    ]);
    expect(result.stdout).toBe("outval\n");
    expect(result.stderr).toBe("errval\n");
  });

  it("sh 도 허용 program 이다", async () => {
    installBunStub({ stdoutChunks: ["sh_ok\n"], exitCode: 0 });
    const result = await runShell("sh", ["-c", "echo sh_ok"]);
    expect(result.stdout).toBe("sh_ok\n");
    expect(result.code).toBe(0);
  });

  it("ShellResult 는 stdout/stderr/code 세 필드를 모두 가진다", async () => {
    installBunStub({ exitCode: 0 });
    const result = await runShell("bash", ["-c", "true"]);
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("stderr");
    expect(result).toHaveProperty("code");
  });

  it("비정상 exit code 도 throw 하지 않고 ShellResult 로 반환된다", async () => {
    // handleShellExec 는 code 필드로 비정상 종료를 전달 — throw X
    installBunStub({
      stderrChunks: ["command not found\n"],
      exitCode: 127,
    });
    const result = await runShell("bash", ["-c", "__unlikely_cmd__"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("여러 청크가 합산되어 반환된다", async () => {
    installBunStub({
      stdoutChunks: ["chunk1\n", "chunk2\n"],
      exitCode: 0,
    });
    const result = await runShell("bash", [
      "-c",
      "printf chunk1; printf chunk2",
    ]);
    expect(result.stdout).toBe("chunk1\nchunk2\n");
  });
});

// ── 3. runShellStream — onChunk / onDone 콜백 계약 ────────────────────────

describe("runShellStream — 스트리밍 콜백 계약 (Bun.spawn stub)", () => {
  it("stdout 청크가 onChunk('stdout', ...) 로 도착하고 onDone(0) 로 끝난다", async () => {
    installBunStub({ stdoutChunks: ["streaming_out\n"], exitCode: 0 });

    const chunks: Array<{ stream: string; data: string }> = [];
    let doneCode: number | null = -999;

    await new Promise<void>((resolve) => {
      runShellStream("bash", ["-c", "echo streaming_out"], {
        onChunk: (stream, data) => chunks.push({ stream, data }),
        onDone: (code) => {
          doneCode = code;
          resolve();
        },
      });
    });

    const stdoutChunks = chunks.filter((c) => c.stream === "stdout");
    expect(stdoutChunks.length).toBeGreaterThan(0);
    const combined = stdoutChunks.map((c) => c.data).join("");
    expect(combined).toBe("streaming_out\n");
    expect(doneCode).toBe(0);
  });

  it("stderr 청크가 onChunk('stderr', ...) 로 도착한다", async () => {
    installBunStub({ stderrChunks: ["errstream\n"], exitCode: 0 });

    const chunks: Array<{ stream: string; data: string }> = [];

    await new Promise<void>((resolve) => {
      runShellStream("bash", ["-c", "echo errstream >&2"], {
        onChunk: (stream, data) => chunks.push({ stream, data }),
        onDone: () => resolve(),
      });
    });

    const stderrChunks = chunks.filter((c) => c.stream === "stderr");
    const combined = stderrChunks.map((c) => c.data).join("");
    expect(combined).toBe("errstream\n");
  });

  it("비정상 exit code 가 onDone 에 전달된다", async () => {
    installBunStub({ exitCode: 7 });
    let doneCode: number | null = -999;

    await new Promise<void>((resolve) => {
      runShellStream("bash", ["-c", "exit 7"], {
        onChunk: () => {},
        onDone: (code) => {
          doneCode = code;
          resolve();
        },
      });
    });

    expect(doneCode).toBe(7);
  });

  it("cancel() 이 정의되어 있고 kill 을 호출한다", () => {
    const killed = vi.fn();
    installBunStub({ delayExitMs: 5000, killFn: killed });

    const handle = runShellStream("bash", ["-c", "sleep 10"], {
      onChunk: () => {},
      onDone: () => {},
    });
    expect(typeof handle.cancel).toBe("function");
    expect(() => handle.cancel()).not.toThrow();
    expect(killed).toHaveBeenCalled();
  });

  it("stdout/stderr 동시 스트리밍 — 각각 올바른 stream 라벨로 도착", async () => {
    installBunStub({
      stdoutChunks: ["out_data\n"],
      stderrChunks: ["err_data\n"],
      exitCode: 0,
    });

    const chunks: Array<{ stream: string; data: string }> = [];

    await new Promise<void>((resolve) => {
      runShellStream("bash", ["-c", "echo out_data; echo err_data >&2"], {
        onChunk: (stream, data) => chunks.push({ stream, data }),
        onDone: () => resolve(),
      });
    });

    const out = chunks
      .filter((c) => c.stream === "stdout")
      .map((c) => c.data)
      .join("");
    const err = chunks
      .filter((c) => c.stream === "stderr")
      .map((c) => c.data)
      .join("");
    expect(out).toBe("out_data\n");
    expect(err).toBe("err_data\n");
  });
});

// ── 4. handleShellExec 응답 계약 ──────────────────────────────────────────
//
// server/index.ts 의 handleShellExec:
//   const result = await runShell(program, args);
//   return json(result);  // → { stdout, stderr, code }
//
// runShell 의 ShellResult 구조 검증 = 라우터 응답 계약 검증.

describe("handleShellExec 응답 계약 (runShell 위임, 구조 검증)", () => {
  it("성공 시 { stdout: string, stderr: string, code: number } 반환", async () => {
    installBunStub({ stdoutChunks: ["api_ok\n"], exitCode: 0 });
    const result = await runShell("bash", ["-c", "echo api_ok"]);
    expect(typeof result.stdout).toBe("string");
    expect(typeof result.stderr).toBe("string");
    expect(typeof result.code).toBe("number");
    expect(result.stdout).toBe("api_ok\n");
    expect(result.code).toBe(0);
  });

  it("비정상 exit 도 ShellResult 로 반환 (throw 아님) — 클라이언트가 code 로 판단", async () => {
    installBunStub({ exitCode: 2 });
    const result = await runShell("bash", ["-c", "exit 2"]);
    expect(result.code).toBe(2);
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("stderr");
  });

  it("ShellRejectedError → 라우터가 400 을 반환해야 함 (에러 타입 확인)", async () => {
    // handleShellExec 는 `if (e instanceof ShellRejectedError) return err(e.message, 400)`
    // 여기선 ShellRejectedError 가 올바른 타입인지만 검증
    try {
      await runShell("disallowed_program", []);
      expect.fail("throw 해야 했음");
    } catch (e) {
      expect(e).toBeInstanceOf(ShellRejectedError);
      // 라우터가 이 타입을 400 으로 처리
    }
  });
});
