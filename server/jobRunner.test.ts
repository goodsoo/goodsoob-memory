// @vitest-environment node
/**
 * server/jobRunner.ts — 오케스트레이션(stub executor) + 청크·병합 순수 함수.
 *
 * ⚠️ 실제 ffmpeg/diarize/whisper/claude 는 절대 실행하지 않는다 (jobExecutors.ts import 금지).
 * ⚠️ vault 는 os.tmpdir() 밑 임시 폴더 — ~/brain 사용 금지.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runJob,
  chunkTranscript,
  chunkToTranscript,
  splitTurns,
  mergeCorrections,
  parseCorrections,
  countAnchorMisses,
  fillPrompt,
  glossaryHints,
  parseCliArgs,
  waitForClaim,
  OVERLAP_HEADER,
  type StepExecutors,
  type JobFile,
  type RunJobOptions,
} from "./jobRunner.ts";

const BASE = "20261028-1300";
let root: string;
let tmpWav: string;
let promptPath: string;
let calls: string[];

const stt = (f = "") => join(root, "_audio/.stt", BASE, f);
const job = (): JobFile => JSON.parse(readFileSync(stt("job.json"), "utf8"));
function w(abs: string, content = "") {
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

const TR_JSON = JSON.stringify({
  transcription: [
    { offsets: { from: 0, to: 4000 }, text: " 안녕하세요 지부레인 회의 시작합니다" },
    { offsets: { from: 5000, to: 9000 }, text: " 인플 채널을 정리하겠습니다" },
    { offsets: { from: 10000, to: 14000 }, text: " 다음은 색인 문제입니다" },
  ],
});

function stubExec(over: Partial<StepExecutors> = {}): StepExecutors {
  return {
    async toWav(m4a, wav) {
      calls.push(`wav:${m4a.endsWith(`_audio/${BASE}.m4a`)}`);
      writeFileSync(wav, "RIFF");
    },
    async diarize(wav, n) {
      calls.push(`diarize:${existsSync(wav)}:${n}`);
      return "0.0\t4.0\t0\n5.0\t9.0\t1\n";
    },
    async merge(trJson, diarTsv, names) {
      calls.push(`merge:${existsSync(trJson)}:${existsSync(diarTsv)}:${names.join(",")}`);
      return "[00:00] 함창수: 안녕하세요\n\n[00:05] 정진용: 인플 채널";
    },
    async normalize(glossary, file) {
      calls.push(`normalize:${existsSync(glossary)}:${file.endsWith("화자분리.txt")}`);
      return "[단어장 자동정규화] 0건 치환 (0종)\n";
    },
    async claude() {
      calls.push("claude");
      return "[]";
    },
    async anchor(_tr, corr) {
      calls.push("anchor");
      const items = JSON.parse(readFileSync(corr, "utf8")) as unknown[];
      return JSON.stringify(items.map((it, i) => ({ id: i + 1, t: 0, ...(it as object) })));
    },
    ...over,
  };
}

function opts(over: Partial<RunJobOptions>): RunJobOptions {
  return {
    vaultDir: root,
    base: BASE,
    kind: "diarize",
    exec: stubExec(),
    tmpDir: tmpWav,
    promptPath,
    log: () => {},
    ...over,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jobrunner-test-"));
  tmpWav = join(root, "tmpwav");
  mkdirSync(tmpWav);
  promptPath = join(root, "corrections_prompt.md");
  w(promptPath, "<!--\nplaceholder 설명\n-->\n규칙\n\n## 참고\n{{GLOSSARY_HINTS}}\n\n## 전사본\n{{TRANSCRIPT}}\n");
  w(join(root, "_audio", `${BASE}.m4a`), "m4a");
  w(stt("tr.json"), TR_JSON);
  w(stt("done"));
  w(join(root, "_audio/glossary.json"), JSON.stringify({ context_hints: { 인플: "인풋" }, notes: ["지브레인 = gbrain"], aliases: {} }));
  calls = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ── 순수: 청크 ───────────────────────────────────────────────────────────────

const turn = (i: number, len: number) => `[${String(i).padStart(2, "0")}:00] 화자${i % 2}: ${"가".repeat(len)}`;

describe("chunkTranscript", () => {
  it("빈 줄 구분 턴 분리 (CRLF·공백 줄 허용)", () => {
    expect(splitTurns("a: 1\r\n\r\nb: 2\n  \nc: 3\n")).toEqual(["a: 1", "b: 2", "c: 3"]);
  });

  it("턴 경계로 ~12,000자 이하 청크, 턴을 자르지 않음, 순서·내용 보존", () => {
    const turns = Array.from({ length: 30 }, (_, i) => turn(i, 1000));
    const chunks = chunkTranscript(turns.join("\n\n"));
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.turns.join("\n\n").length).toBeLessThanOrEqual(12_000);
    expect(chunks.flatMap((c) => c.turns)).toEqual(turns);
  });

  it("다음 청크 앞에 앞 청크 마지막 2턴 겹침, 첫 청크는 겹침 없음", () => {
    const turns = Array.from({ length: 10 }, (_, i) => turn(i, 50));
    const chunks = chunkTranscript(turns.join("\n\n"), 200);
    expect(chunks[0].overlap).toEqual([]);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].overlap).toEqual(chunks[i - 1].turns.slice(-2));
    }
    const t = chunkToTranscript(chunks[1]);
    expect(t.startsWith(OVERLAP_HEADER)).toBe(true);
    expect(t.indexOf(chunks[1].overlap[0])).toBeLessThan(t.indexOf(chunks[1].turns[0]));
    expect(chunkToTranscript(chunks[0])).toBe(chunks[0].turns.join("\n\n"));
  });

  it("한 턴이 한도보다 길면 그 턴 혼자 한 청크", () => {
    const chunks = chunkTranscript([turn(1, 10), turn(2, 500), turn(3, 10)].join("\n\n"), 100);
    expect(chunks.map((c) => c.turns.length)).toEqual([1, 1, 1]);
    expect(chunks[1].turns[0].length).toBeGreaterThan(100);
  });
});

// ── 순수: 프롬프트·파싱·병합 ─────────────────────────────────────────────────

describe("prompt · parse · merge", () => {
  it("fillPrompt — 선두 주석 제거 + placeholder 치환 ($ 패턴 해석 안 함)", () => {
    const out = fillPrompt("<!-- x -->\nA {{GLOSSARY_HINTS}} B {{TRANSCRIPT}}", "힌트 $&", "본문 $1");
    expect(out).toBe("A 힌트 $& B 본문 $1");
  });

  it("glossaryHints — context_hints(dict/list) + notes", () => {
    expect(glossaryHints({ context_hints: { 인플: "인풋" }, notes: ["n1"] })).toBe("context_hints:\n- 인플: 인풋\n\nnotes:\n- n1");
    expect(glossaryHints({ context_hints: ["h"] })).toBe("context_hints:\n- h");
    expect(glossaryHints({})).toBe("(단어장 없음)");
  });

  it("parseCorrections — 코드펜스·앞뒤 잡문 허용, 배열 아니면 throw", () => {
    expect(parseCorrections('```json\n[{"anchor":"a"}]\n```')).toEqual([{ anchor: "a" }]);
    expect(parseCorrections('결과입니다:\n[{"anchor":"a"}, 3]\n끝')).toEqual([{ anchor: "a" }]);
    expect(parseCorrections("[]")).toEqual([]);
    expect(() => parseCorrections("죄송합니다")).toThrow();
    expect(() => parseCorrections("[{broken")).toThrow();
  });

  it("mergeCorrections — concat, 같은 anchor 는 첫 항목만, anchor 없는 항목은 유지", () => {
    const merged = mergeCorrections([
      [{ anchor: "x", sugg: "1" }, { anchor: "y" }],
      [{ anchor: "x", sugg: "2" }, { orig: "no-anchor" }, { orig: "no-anchor" }, { anchor: "z" }],
    ]);
    expect(merged).toEqual([{ anchor: "x", sugg: "1" }, { anchor: "y" }, { orig: "no-anchor" }, { orig: "no-anchor" }, { anchor: "z" }]);
  });

  it("countAnchorMisses — anchor_offsets.py 와 같은 탐색 (anchor → orig 앞 8자)", () => {
    const items = [
      { anchor: "지부레인 회의" }, // hit
      { anchor: "없는문구입니다", orig: "인플 채널을 정리했다" }, // anchor miss, orig[:8] hit
      { anchor: "없는문구입니다", orig: "전혀 다른 문장" }, // miss
      { orig: "다음은 색인 문제" }, // anchor 없음 → orig[:12] hit
      { anchor: "없음", t: 3 }, // t 지정 — 탐색 안 함
    ];
    expect(countAnchorMisses(TR_JSON, items)).toBe(1);
  });

  it("parseCliArgs — kind 검증, speakers·names", () => {
    expect(parseCliArgs(["/v", BASE, "diarize", "3", "A", "B"])).toEqual({ vaultDir: "/v", base: BASE, kind: "diarize", speakers: 3, names: ["A", "B"] });
    expect(parseCliArgs(["/v", BASE, "corrections-retry"]).kind).toBe("corrections-retry");
    expect(() => parseCliArgs(["/v", BASE, "rm"])).toThrow();
    expect(() => parseCliArgs(["/v", "../x", "diarize"])).toThrow();
  });

  it("waitForClaim — job.json 에 내 pid 가 기록되면 true", async () => {
    const p = stt("job.json");
    setTimeout(() => w(p, JSON.stringify({ state: "running", pid: 4242 })), 30);
    expect(await waitForClaim(p, 4242, 2000, 10)).toBe(true);
    expect(await waitForClaim(p, 1, 50, 10)).toBe(false);
  });
});

// ── 오케스트레이션: diarize ──────────────────────────────────────────────────

describe("runJob diarize (단계 1~3)", () => {
  it("wav → diarize → merge → normalize 순서, 산출물 .stt/<base>/, wav 삭제, done", async () => {
    w(stt("anchored.json"), "[]"); // 낡은 교정 후보
    w(stt("corrections.partial.json"), "{}");
    const r = await runJob(opts({ speakers: 2, names: ["함창수", "정진용"] }));
    expect(r).toEqual({ state: "done" });
    expect(calls).toEqual(["wav:true", "diarize:true:2", "merge:true:true:함창수,정진용", "normalize:true:true"]);
    expect(readFileSync(stt("diar.tsv"), "utf8")).toBe("0.0\t4.0\t0\n5.0\t9.0\t1\n");
    expect(readFileSync(stt("화자분리.txt"), "utf8")).toBe("[00:00] 함창수: 안녕하세요\n\n[00:05] 정진용: 인플 채널\n");
    expect(readFileSync(stt("normalize.log"), "utf8")).toContain("자동정규화");
    expect(existsSync(join(tmpWav, `${BASE}.wav`))).toBe(false);
    expect(existsSync(stt("anchored.json"))).toBe(false);
    expect(existsSync(stt("corrections.partial.json"))).toBe(false);
    const j = job();
    expect(j).toMatchObject({ state: "done", kind: "diarize", step: "done", speakers: 2, names: ["함창수", "정진용"] });
    expect(j.finishedAt).toBeTruthy();
    expect(j.error).toBeUndefined();
  });

  it("기존 job.json(서버 claim)의 pid·startedAt·lstart 는 유지", async () => {
    w(stt("job.json"), JSON.stringify({ state: "running", kind: "diarize", step: "queued", pid: 777, startedAt: "S", lstart: "L", heartbeatAt: "S" }));
    await runJob(opts({ speakers: 1 }));
    expect(job()).toMatchObject({ state: "done", pid: 777, startedAt: "S", lstart: "L" });
  });

  it("diarize 실패 → job error + 메시지, wav 는 지움, 화자분리 미생성", async () => {
    const r = await runJob(
      opts({
        speakers: 2,
        exec: stubExec({
          async diarize() {
            throw new Error("sherpa 실패");
          },
        }),
      }),
    );
    expect(r.state).toBe("error");
    expect(job()).toMatchObject({ state: "error", step: "diarize", error: "sherpa 실패" });
    expect(existsSync(join(tmpWav, `${BASE}.wav`))).toBe(false);
    expect(existsSync(stt("화자분리.txt"))).toBe(false);
  });

  it("화자 수 범위 밖이면 실행 전에 error", async () => {
    const r = await runJob(opts({ speakers: 11 }));
    expect(r.state).toBe("error");
    expect(calls).toEqual([]);
  });

  it("glossary.json 없으면 normalize 건너뜀 + 로그에 기록", async () => {
    rmSync(join(root, "_audio/glossary.json"));
    await runJob(opts({ speakers: 1 }));
    expect(calls.some((c) => c.startsWith("normalize"))).toBe(false);
    expect(readFileSync(stt("normalize.log"), "utf8")).toContain("glossary.json 없음");
    expect(job().state).toBe("done");
  });

  it("heartbeat — 긴 단계 도중 heartbeatAt 이 갱신된다", async () => {
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 10, 2, 0, 0, tick++));
    let during: string[] = [];
    await runJob(
      opts({
        speakers: 1,
        heartbeatMs: 10,
        now,
        exec: stubExec({
          async diarize() {
            const seen = new Set<string>();
            for (let i = 0; i < 10; i++) {
              await new Promise((r) => setTimeout(r, 15));
              seen.add(job().heartbeatAt);
            }
            during = [...seen];
            return "0\t1\t0\n";
          },
        }),
      }),
    );
    expect(during.length).toBeGreaterThan(1);
    expect(job().step).toBe("done");
  });
});

// ── 오케스트레이션: corrections ──────────────────────────────────────────────

function seedDiarized(nTurns: number, len = 60) {
  const turns = Array.from({ length: nTurns }, (_, i) => turn(i, len));
  w(stt("화자분리.txt"), turns.join("\n\n") + "\n");
  return turns;
}

/** 청크 번호를 프롬프트에서 역추적 — 본 구간 첫 턴의 [NN:00]. */
function chunkKey(prompt: string): string {
  const body = prompt.includes("### 본 구간") ? prompt.split("### 본 구간")[1] : prompt.split("## 전사본")[1];
  return /\[(\d\d):00\]/.exec(body)![1];
}

describe("runJob corrections (단계 4~5)", () => {
  it("청크별 claude → corrections.json(중복 anchor 제거) → anchored.json, 프롬프트 구성, anchorMisses", async () => {
    seedDiarized(10); // 각 턴 ~73자, chunkChars 200 → 여러 청크
    const prompts: string[] = [];
    const r = await runJob(
      opts({
        kind: "corrections",
        chunkChars: 200,
        exec: stubExec({
          async claude(prompt) {
            prompts.push(prompt);
            // 모든 청크가 같은 anchor 하나 + 청크 고유 anchor 하나 (고유 anchor 는 tr.json 에 없음 → miss)
            return JSON.stringify([
              { anchor: "지부레인 회의", type: "A", orig: "지부레인", sugg: "지브레인" },
              { anchor: `고유-${chunkKey(prompt)}`, type: "B", orig: "뭉개짐", sugg: "" },
            ]);
          },
        }),
      }),
    );
    expect(r.state).toBe("done");
    expect(prompts.length).toBeGreaterThan(2);
    // 프롬프트: 주석 제거, 단어장 힌트, 둘째 청크부터 겹침 표시
    expect(prompts[0]).not.toContain("<!--");
    expect(prompts[0]).toContain("- 인플: 인풋");
    expect(prompts[0]).toContain("- 지브레인 = gbrain");
    expect(prompts[0]).not.toContain(OVERLAP_HEADER);
    expect(prompts[1]).toContain(OVERLAP_HEADER);

    const corr = JSON.parse(readFileSync(stt("corrections.json"), "utf8")) as Array<{ anchor: string }>;
    expect(corr.filter((c) => c.anchor === "지부레인 회의")).toHaveLength(1);
    expect(corr).toHaveLength(1 + prompts.length);
    expect(corr[0].anchor).toBe("지부레인 회의");
    const anchored = JSON.parse(readFileSync(stt("anchored.json"), "utf8"));
    expect(anchored).toHaveLength(corr.length);
    expect(calls[calls.length - 1]).toBe("anchor");
    const j = job();
    expect(j).toMatchObject({ state: "done", kind: "corrections", chunks: prompts.length, anchorMisses: prompts.length });
    expect(existsSync(stt("corrections.partial.json"))).toBe(false);
  });

  it("JSON 파싱 실패 → 1회 재시도 후 성공", async () => {
    seedDiarized(2);
    let n = 0;
    const r = await runJob(
      opts({
        kind: "corrections",
        exec: stubExec({
          async claude() {
            n++;
            return n === 1 ? "죄송하지만 JSON 이 아닙니다" : '[{"anchor":"다음은 색인"}]';
          },
        }),
      }),
    );
    expect(r.state).toBe("done");
    expect(n).toBe(2);
    expect(job().anchorMisses).toBe(0);
  });

  it("재시도도 실패한 청크 → job error + failedChunks + partial, 그 뒤 실패 청크만 재실행", async () => {
    seedDiarized(10);
    let bad = "02"; // 이 청크(첫 턴 번호)는 항상 실패
    const seen: string[] = [];
    const exec = stubExec({
      async claude(prompt) {
        const k = chunkKey(prompt);
        seen.push(k);
        if (k === bad) throw new Error("timeout");
        return JSON.stringify([{ anchor: `a-${k}` }]);
      },
    });
    // chunkChars 150 → 턴 2개씩 (00·01 / 02·03 / ...) → 5청크, 둘째(02) 실패
    const r = await runJob(opts({ kind: "corrections", chunkChars: 150, exec }));
    expect(r.state).toBe("error");
    expect(seen.filter((k) => k === "02")).toHaveLength(2); // 1회 재시도
    const j = job();
    expect(j.state).toBe("error");
    expect(j.failedChunks).toEqual([2]);
    expect(j.error).toContain("2");
    expect(existsSync(stt("corrections.json"))).toBe(false);
    expect(existsSync(stt("anchored.json"))).toBe(false);
    const partial = JSON.parse(readFileSync(stt("corrections.partial.json"), "utf8"));
    expect(partial.chunkCount).toBe(5);
    expect(Object.keys(partial.results).sort()).toEqual(["1", "3", "4", "5"]);
    expect(partial.failedChunks).toEqual([2]);

    // 실패 청크만 재실행
    bad = "none";
    seen.length = 0;
    const r2 = await runJob(opts({ kind: "corrections-retry", chunkChars: 150, exec }));
    expect(r2.state).toBe("done");
    expect(seen).toEqual(["02"]);
    const corr = JSON.parse(readFileSync(stt("corrections.json"), "utf8")) as Array<{ anchor: string }>;
    expect(corr.map((c) => c.anchor)).toEqual(["a-00", "a-02", "a-04", "a-06", "a-08"]); // 청크 순서
    expect(existsSync(stt("corrections.partial.json"))).toBe(false);
    expect(existsSync(stt("anchored.json"))).toBe(true);
    const j2 = job();
    expect(j2).toMatchObject({ state: "done", kind: "corrections-retry" });
    expect(j2.failedChunks).toBeUndefined();
  });

  it("실패 청크만 재실행 — partial 없음/화자분리 변경이면 error", async () => {
    seedDiarized(4);
    const r = await runJob(opts({ kind: "corrections-retry" }));
    expect(r.state).toBe("error");
    expect(r.error).toContain("partial");

    w(stt("corrections.partial.json"), JSON.stringify({ sourceHash: "other", chunkChars: 12000, chunkCount: 1, results: {}, failedChunks: [1] }));
    const r2 = await runJob(opts({ kind: "corrections-retry" }));
    expect(r2.state).toBe("error");
    expect(r2.error).toContain("바뀌어");
    expect(calls.includes("claude")).toBe(false);
  });

  it("프롬프트 파일 없음 / 화자분리 없음 → error (claude 호출 0)", async () => {
    const r = await runJob(opts({ kind: "corrections" }));
    expect(r.error).toContain("화자분리.txt");
    seedDiarized(2);
    const r2 = await runJob(opts({ kind: "corrections", promptPath: join(root, "nope.md") }));
    expect(r2.error).toContain("프롬프트");
    expect(calls).toEqual([]);
  });
});
