/**
 * jobExecutors — jobRunner 단계의 실제 실행기 (ffmpeg · transcribe 스킬 python · claude -p).
 *
 * ⚠️ 테스트에서 import 하지 말 것 — 실제 diarize/whisper/claude 를 돌린다. 테스트는 stub 주입.
 *
 * launchd 최소 PATH 대비: 바이너리는 절대경로 + env PATH 명시. `~` 는 셸 확장이 없으므로
 * os.homedir() 로 직접 푼다. claude 만 nvm 경로라 `bash -lc` (login 셸 → ~/.bash_profile,
 * src/lib/portfolio/claude.ts 와 같은 경로) 로 부르고 프롬프트는 stdin 으로 넘긴다
 * (전사본을 명령줄에 올리지 않음 — ps 노출·ARG_MAX 회피).
 */

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { StepExecutors } from "./jobRunner.ts";

export const JOB_PATH = "/opt/homebrew/bin:/usr/bin:/bin";
const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const BREW_PY = "/opt/homebrew/bin/python3";

export function skillDir(): string {
  return join(homedir(), ".claude/skills/transcribe");
}
function sttPython(): string {
  return join(homedir(), ".cache/stt-venv/bin/python");
}

interface RunOpts {
  timeoutMs: number;
  stdin?: string;
  /** 자식 프로세스 그룹째 kill (bash -lc 아래 claude 까지). */
  group?: boolean;
  label?: string;
}

function run(bin: string, args: string[], o: RunOpts): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env, PATH: JOB_PATH },
      stdio: [o.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
      detached: o.group === true,
    });
    const out: Buffer[] = [];
    let err = "";
    let timedOut = false;
    child.stdout!.on("data", (b: Buffer) => out.push(b));
    child.stderr!.on("data", (b: Buffer) => {
      err += b.toString("utf8");
      if (err.length > 64_000) err = err.slice(-32_000);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (o.group && child.pid) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {
        /* 이미 종료 */
      }
    }, o.timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`${o.label ?? bin} 시간 초과 (${Math.round(o.timeoutMs / 1000)}초)`));
      if (code !== 0) return reject(new Error(`${o.label ?? bin} 종료 코드 ${code}: ${err.trim().slice(-2000)}`));
      resolve(Buffer.concat(out).toString("utf8"));
    });
    if (o.stdin !== undefined) {
      child.stdin!.on("error", () => {});
      child.stdin!.end(o.stdin);
    }
  });
}

const MIN = 60_000;

export function defaultExecutors(): StepExecutors {
  const S = join(skillDir(), "scripts");
  return {
    // aresample async: 아이폰 m4a 는 패킷 타임스탬프에 구멍이 있어(실데이터 < 표시 길이) 그냥 디코딩하면
    // 구멍이 이어붙어 시간이 플레이어보다 앞당겨진다. 무음으로 채워 플레이어 타임라인에 맞춘다.
    // whisper wav(transcribe 스킬 auto_stt.sh)와 같은 옵션이어야 merge 의 화자 매칭이 맞는다.
    async toWav(m4a, wav) {
      await run(FFMPEG, ["-y", "-loglevel", "error", "-i", m4a, "-af", "aresample=async=1:first_pts=0", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], { timeoutMs: 30 * MIN });
    },
    diarize: (wav, speakers) => run(sttPython(), [join(S, "diarize.py"), wav, String(speakers)], { timeoutMs: 4 * 60 * MIN }),
    merge: (trJson, diarTsv, names) => run(sttPython(), [join(S, "merge.py"), trJson, diarTsv, ...names], { timeoutMs: 10 * MIN }),
    normalize: (glossary, file) => run(BREW_PY, [join(S, "normalize.py"), glossary, file, file], { timeoutMs: 10 * MIN }),
    anchor: (trJson, corr) => run(BREW_PY, [join(S, "anchor_offsets.py"), trJson, corr], { timeoutMs: 10 * MIN }),
    // /tmp 에서 실행 → 프로젝트 CLAUDE.md/memory 미로드, --strict-mcp-config → MCP 0개 (claude.ts 와 동일).
    // `claude -p` 는 인자 없이 stdin 을 프롬프트로 읽는다.
    claude: (prompt, timeoutMs) =>
      run("/bin/bash", ["-lc", "cd /tmp && claude -p --strict-mcp-config"], { timeoutMs, stdin: prompt, group: true, label: "claude -p" }),
  };
}
