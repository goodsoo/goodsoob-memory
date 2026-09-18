// V0.7 — gh CLI 위임 (bash -lc 래핑).
//
// design v2.3, TODO-1 + release PATH fix: Tauri macOS PATH 문제.
// Finder 로 실행한 release .app 은 launchd 최소 PATH(/usr/bin:/bin:/usr/sbin:/sbin)
// 로 시작 → gh(~/.local/bin), claude(nvm), brew(/opt/homebrew·/usr/local) 가
// PATH 에 없음. `bash -lc` 가 login 셸로 ~/.bash_profile(+nvm, .local/bin) 을 로딩 →
// 사용자 터미널과 동일 PATH 확보.
//   - 옛 `sh -lc` 는 /etc/profile + ~/.profile 만 읽어 .local/bin·nvm 누락.
//   - dev 가 됐던 건 -l 이 아니라 부모 터미널 PATH 상속 덕분이었고, release 는
//     상속이 없어 gh: command not found / code 127 로 깨졌다.

import { runShellCommand } from "../runtime";

export class GhError extends Error {
  stderr: string;
  code: number | null;
  constructor(message: string, opts: { stderr?: string; code?: number | null } = {}) {
    super(message);
    this.name = "GhError";
    this.stderr = opts.stderr ?? "";
    this.code = opts.code ?? null;
  }
}

export class GhSyncError extends GhError {
  constructor(stderr: string, code: number | null) {
    super(`gh sync 실패: ${stderr || "code " + code}`, { stderr, code });
    this.name = "GhSyncError";
  }
}

export class GhAuthError extends GhError {
  host: string;
  constructor(host: string, stderr = "") {
    super(`gh 인증 안 됨 (${host}). 터미널에서 \`gh auth login\` 실행 필요.`, {
      stderr,
    });
    this.name = "GhAuthError";
    this.host = host;
  }
}

export class GhNotInstalledError extends GhError {
  constructor(stderr = "") {
    super("gh CLI 가 설치되지 않았습니다. macOS: `brew install gh`, Windows: `winget install GitHub.cli`", {
      stderr,
    });
    this.name = "GhNotInstalledError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Low-level shell wrapper

// single-quote 안에 들어갈 값을 안전하게 escape.
// shell escape rule: ' → '\'' (close, escaped quote, reopen).
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// 모든 portfolio 셸 위임(gh/claude)의 단일 진입점 = release PATH fix 의 single source.
// 위 헤더 주석 참조 — bash login 셸이라야 ~/.local/bin·nvm 이 PATH 에 들어온다.
// (curl/zip/open 등 /usr/bin 시스템 binary 는 최소 PATH 로도 잡혀 sh -lc 유지 가능.)
export const LOGIN_SHELL_PROGRAM = "bash";
export function loginShellArgs(cmdStr: string): string[] {
  return ["-lc", cmdStr];
}

// gh 명령어를 sh -lc 안에서 실행. 인자는 각각 single-quoted.
export interface ShCommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

// stderr 패턴으로 에러 분류 — 사용자 모달 분기용. 미설치는 sh 의 "command not found"
// (code 127), 미로그인은 gh CLI 의 인증 안내 문구. 그 외 fallback = GhSyncError.
export function classifyGhError(
  stderr: string,
  code: number | null,
  host: string = "github.com",
): GhError {
  const s = stderr.toLowerCase();
  if (
    s.includes("gh: command not found") ||
    s.includes("gh: not found") ||
    code === 127
  ) {
    return new GhNotInstalledError(stderr);
  }
  if (
    s.includes("not authenticated") ||
    s.includes("gh auth login") ||
    s.includes("authentication required") ||
    s.includes("requires authentication") ||
    s.includes("you are not logged")
  ) {
    return new GhAuthError(host, stderr);
  }
  return new GhSyncError(stderr, code);
}

export async function runGh(args: string[]): Promise<ShCommandResult> {
  const cmdStr = `gh ${args.map(shellSingleQuote).join(" ")}`;
  // 서버가 대신 실행 (runtime.ts). loginShellArgs(bash -lc) 로 PATH fix single
  // source 유지.
  const output = await runShellCommand(
    LOGIN_SHELL_PROGRAM,
    loginShellArgs(cmdStr),
  );
  if (output.code !== 0) {
    throw classifyGhError(output.stderr, output.code);
  }
  return {
    stdout: output.stdout,
    stderr: output.stderr,
    code: output.code,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// gh search / pr view — design v2.3 Step 1 / Step 2

export interface GhSearchResult {
  id: number; // GitHub 내부 PR ID (rename / 이전 모두 불변, 영구 식별자)
  number: number;
  title: string;
  body: string;
  url: string;
  state: string; // "open" | "closed" (search 는 merged 별도 노출 안 함, post-filter)
  closedAt: string;
  repository: { nameWithOwner: string }; // "owner/repo"
}

export interface GhPRDetail {
  mergedAt: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  body: string;
}

// gh search prs --author @me --merged [--merged-at >=since].
// limit default 1000 (gh 자동 페이지네이션 X — V0.7.x 에서 페이지 처리 추가).
//
// V0.7.x bug fix: 옛 코드는 positional `'is:merged merged:>=DATE'` 로 두 qualifier 를
// 한 arg 에 넣었는데 gh search prs 가 빈 배열을 반환 (positional 안 `>=` 연산자
// 미지원 추정). `--merged --merged-at '>=DATE'` flag 형으로 변경 — 같은 의미,
// 정상 동작. since 없는 full sync 는 `--merged` 만으로 충분.
export async function ghSearchMyPRs(
  opts: { since?: string; limit?: number } = {},
): Promise<GhSearchResult[]> {
  const args = [
    "search",
    "prs",
    "--author",
    "@me",
    "--merged",
    "--limit",
    String(opts.limit ?? 1000),
    "--json",
    "id,number,title,body,url,state,closedAt,repository",
  ];
  if (opts.since) {
    args.push("--merged-at", `>=${opts.since}`);
  }
  const result = await runGh(args);
  try {
    return JSON.parse(result.stdout) as GhSearchResult[];
  } catch (err) {
    throw new GhSyncError(
      `gh search 출력 파싱 실패: ${err instanceof Error ? err.message : String(err)}`,
      result.code,
    );
  }
}

// gh pr view <url> --json mergedAt,changedFiles,additions,deletions,body
export async function ghEnrichPR(url: string): Promise<GhPRDetail> {
  const args = [
    "pr",
    "view",
    url,
    "--json",
    "mergedAt,changedFiles,additions,deletions,body",
  ];
  const result = await runGh(args);
  try {
    return JSON.parse(result.stdout) as GhPRDetail;
  } catch (err) {
    throw new GhSyncError(
      `gh pr view 출력 파싱 실패: ${err instanceof Error ? err.message : String(err)}`,
      result.code,
    );
  }
}
