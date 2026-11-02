// @vitest-environment node
/**
 * server/recordings.ts — tmp vault 통합 테스트 (녹음 탭 PR1)
 *
 * attachment.test.ts 패턴: os.tmpdir() 밑 임시 vault + VaultCore(git:false).
 * ⚠️ 절대 ~/brain 경로 사용 금지.
 *
 * /api/audio 의 Range→206 은 Bun.serve 동작이라 vitest(node) 안에서는 재현 불가 →
 * bun 서브프로세스로 실제 Bun.serve 를 띄워 확인 (bun·ffmpeg 없으면 skip).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { VaultCore } from "./vaultCore.ts";
import { coreAdapter } from "./coreAdapter.ts";
import { createRecordings, handleRecordingsApi, type Recordings, type RecordingsDeps } from "./recordings.ts";
import { updateMeeting } from "../src/api/meetings.ts";
import { parseVaultFile } from "../src/lib/vault/parser.ts";

let root: string;
let vault: VaultCore;
let rec: Recordings;
let probeCalls: string[];

function w(rel: string, content: string | Buffer = "") {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
}
const r = (rel: string) => readFileSync(join(root, rel), "utf8");
const ex = (rel: string) => existsSync(join(root, rel));
const audioOf = (memo: string) => {
  const a = parseVaultFile(r(memo)).frontmatter.audio;
  return Array.isArray(a) ? a.map(String) : [];
};

function make(extra: Partial<RecordingsDeps> = {}) {
  return createRecordings({
    vault,
    probe: async (abs) => {
      probeCalls.push(abs);
      return { durationSec: 61.5, codec: "aac", creationTime: null };
    },
    isDataless: () => false,
    requestDownload: () => {},
    pidAlive: () => false,
    // ⚠️ job 은 절대 실제로 띄우지 않는다 — 기본 spawn 은 테스트마다 주입.
    procStart: () => null,
    proCheck: () => ({ ok: true }),
    spawnJob: () => {
      throw new Error("spawnJob not stubbed");
    },
    ...extra,
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "recordings-test-"));
  vault = new VaultCore({ root, git: false });
  probeCalls = [];
  rec = make();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const B1 = "20261028-1300";
const B2 = "20261028-0900";
const MEMO = "work/회의.md";

function seedMemo(path = MEMO, fm = "id: 11111111-1111-1111-1111-111111111111\ndate: 2026-10-28\n", body = "본문") {
  w(path, `---\n${fm}---\n\n${body}\n`);
}

describe("link — 이사 ①~④", () => {
  it("섹션 추가 → audio: → moved.json + done → _audio/<base>.txt 삭제", async () => {
    seedMemo();
    w(`work/회의.transcript.md`, "기존 머리말\n");
    w(`_audio/${B1}.m4a`, "x");
    w(`_audio/${B1}.txt`, "교정된 전사본");

    const res = await rec.link(B1, { memo: MEMO });

    const t = r("work/회의.transcript.md");
    expect(t.startsWith("기존 머리말\n")).toBe(true);
    expect(t).toContain(`## 13:00 · ${B1}\n\n교정된 전사본\n`);
    expect(audioOf(MEMO)).toEqual([B1]);
    expect(parseVaultFile(r(MEMO)).body).toBe("본문"); // 본문 보존
    const moved = JSON.parse(r(`_audio/.stt/${B1}/moved.json`));
    expect(moved.raw).toBe(false);
    expect(typeof moved.hash).toBe("string");
    expect(ex(`_audio/.stt/${B1}/done`)).toBe(true);
    expect(ex(`_audio/${B1}.txt`)).toBe(false);
    expect(res.insertedSection).toBe(true);
    expect(res.meeting.id).toBe(MEMO);
    expect(res.meeting.uid).toBe("11111111-1111-1111-1111-111111111111");
    expect(res.meeting.audio).toEqual([B1]);
    expect(res.meeting.transcript).toContain(B1);
  });

  it("멱등 재실행 — 이미 헤딩 있으면 ① skip, 이사 미완료(txt 잔존·moved.json 없음) 복구", async () => {
    seedMemo();
    w(`_audio/${B1}.txt`, "전사본");
    await rec.link(B1, { memo: MEMO });
    // link 도중 중단된 상태 재현: txt 되살아남 + moved.json 없음
    w(`_audio/${B1}.txt`, "전사본");
    rmSync(join(root, `_audio/.stt/${B1}/moved.json`));
    const before = r("work/회의.transcript.md");

    const res = await rec.link(B1, { memo: MEMO });
    expect(res.insertedSection).toBe(false);
    expect(r("work/회의.transcript.md")).toBe(before);
    expect(r("work/회의.transcript.md").split(`· ${B1}`).length).toBe(2); // 헤딩 1개
    expect(audioOf(MEMO)).toEqual([B1]);
    expect(ex(`_audio/.stt/${B1}/moved.json`)).toBe(true);
    expect(ex(`_audio/${B1}.txt`)).toBe(false);
  });

  it("같은 메모에 서로 다른 base 두 개를 동시에 link — 둘 다 남는다 (메모 mutex), 시각순", async () => {
    seedMemo();
    w(`_audio/${B1}.txt`, "오후 회의");
    w(`_audio/${B2}.txt`, "오전 회의");
    await Promise.all([rec.link(B1, { memo: MEMO }), rec.link(B2, { memo: MEMO })]);
    const t = r("work/회의.transcript.md");
    expect(t).toContain(`## 13:00 · ${B1}`);
    expect(t).toContain(`## 09:00 · ${B2}`);
    expect(t.indexOf(B2)).toBeLessThan(t.indexOf(B1));
    expect(audioOf(MEMO).sort()).toEqual([B1, B2].sort());
  });

  it("같은 base 동시 link → 하나는 409 busy", async () => {
    seedMemo();
    seedMemo("work/다른.md", "id: 22222222-2222-2222-2222-222222222222\n");
    w(`_audio/${B1}.txt`, "전사본");
    const results = await Promise.allSettled([
      rec.link(B1, { memo: MEMO }),
      rec.link(B1, { memo: "work/다른.md" }),
    ]);
    const rejected = results.filter((x) => x.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.status).toBe(409);
  });

  it("이미 다른 메모로 이사된 base 를 다른 메모에 link → 409 alreadyMoved", async () => {
    seedMemo();
    seedMemo("work/다른.md", "id: 22222222-2222-2222-2222-222222222222\n");
    w(`_audio/${B1}.txt`, "전사본");
    w(`_audio/.stt/${B1}/done`);
    w(`_audio/.stt/${B1}/tr.txt`, "초벌");
    await rec.link(B1, { memo: MEMO });
    await expect(rec.link(B1, { memo: "work/다른.md" })).rejects.toMatchObject({ status: 409, code: "alreadyMoved" });
  });

  it("초벌 전사에서 바로 연결 — tr.txt 승격 + raw-promoted + moved.raw", async () => {
    seedMemo();
    w(`_audio/${B1}.m4a`, "x");
    w(`_audio/.stt/${B1}/done`);
    w(`_audio/.stt/${B1}/tr.txt`, "whisper 초벌");
    const res = await rec.link(B1, { memo: MEMO });
    expect(res.raw).toBe(true);
    expect(r("work/회의.transcript.md")).toContain("whisper 초벌");
    expect(ex(`_audio/.stt/${B1}/raw-promoted`)).toBe(true);
    expect(JSON.parse(r(`_audio/.stt/${B1}/moved.json`)).raw).toBe(true);
    expect(ex(`_audio/${B1}.txt`)).toBe(false);
  });

  it("전사본 원천 없음(done 없음) → 409, 메모 무변경", async () => {
    seedMemo();
    w(`_audio/${B1}.m4a`, "x");
    w(`_audio/.stt/${B1}/tr.json`, "{}"); // 실패 잔재
    const before = r(MEMO);
    await expect(rec.link(B1, { memo: MEMO })).rejects.toMatchObject({ status: 409, code: "noTranscript" });
    expect(r(MEMO)).toBe(before);
    expect(ex("work/회의.transcript.md")).toBe(false);
  });

  it("id 없는 brain 노트에도 audio: 키만 추가 (id 주입 X)", async () => {
    w("me/노트.md", "그냥 본문\n");
    w(`_audio/${B1}.txt`, "전사본");
    await rec.link(B1, { memo: "me/노트.md" });
    const fm = parseVaultFile(r("me/노트.md")).frontmatter;
    expect(fm).toEqual({ audio: [B1] });
    expect(parseVaultFile(r("me/노트.md")).body).toBe("그냥 본문");
  });

  it("숫자만인 base 도 문자열로 유지 (YAML 숫자 오인 방지)", async () => {
    seedMemo();
    w(`_audio/20261028.txt`, "전사본");
    await rec.link("20261028", { memo: MEMO });
    expect(r(MEMO)).toMatch(/- '20261028'|- "20261028"/);
    expect(audioOf(MEMO)).toEqual(["20261028"]);
  });

  it("newMemo — 메모 생성 + 이사를 한 요청에서, date/time = 녹음 시각", async () => {
    w(`_audio/${B1}.txt`, "새 메모용 전사본");
    const res = await rec.link(B1, { newMemo: { title: "새 회의", folder: "work" } });
    expect(res.created).toBe(true);
    expect(res.meeting.id).toBe("work/새 회의.md");
    expect(res.meeting.uid).toMatch(/^[0-9a-f-]{36}$/);
    const fm = parseVaultFile(r("work/새 회의.md")).frontmatter;
    expect(fm.id).toBe(res.meeting.uid);
    expect(fm.date).toBe("2026-10-28");
    expect(fm.time).toBe("13:00");
    expect(fm.audio).toEqual([B1]);
    expect(parseVaultFile(r("work/새 회의.md")).body).toBe("");
    expect(r("work/새 회의.transcript.md")).toContain("새 메모용 전사본");
    expect(ex(`_audio/${B1}.txt`)).toBe(false);
  });

  it("newMemo — 폴더 미지정 = inbox, 제목 충돌 = 409 titleConflict (HTTP)", async () => {
    w(`_audio/${B1}.txt`, "전사본");
    seedMemo("inbox/겹침.md");
    const req = new Request(`http://x/api/recordings/${encodeURIComponent(B1)}/link`, {
      method: "POST",
      body: JSON.stringify({ newMemo: { title: "겹침" } }),
    });
    const res = await handleRecordingsApi(req, new URL(req.url), rec);
    expect(res!.status).toBe(409);
    expect(((await res!.json()) as { code: string }).code).toBe("titleConflict");
    expect(ex(`_audio/${B1}.txt`)).toBe(true); // 아무것도 안 옮김

    const ok = await rec.link(B1, { newMemo: { title: "새것" } });
    expect(ok.meeting.id).toBe("inbox/새것.md");
  });

  it("newMemo — `_` 폴더 거부 400", async () => {
    w(`_audio/${B1}.txt`, "전사본");
    await expect(rec.link(B1, { newMemo: { title: "a", folder: "_tasks" } })).rejects.toMatchObject({ status: 400 });
  });

  it("연결 후 메모 rename(기존 updateMeeting 경로) — 사이드카가 따라가고 섹션 유지", async () => {
    seedMemo();
    w(`_audio/${B1}.txt`, "전사본");
    await rec.link(B1, { memo: MEMO });
    const renamed = await updateMeeting(coreAdapter(vault), MEMO, { title: "바뀐 제목" });
    expect(renamed.id).toBe("work/바뀐 제목.md");
    expect(ex("work/회의.transcript.md")).toBe(false);
    expect(r("work/바뀐 제목.transcript.md")).toContain(`· ${B1}`);
    expect(renamed.audio).toEqual([B1]);
    expect(renamed.transcript).toContain("전사본");
  });
});

describe("unlink — 되돌리기", () => {
  it("왕복: link → unlink 하면 _audio/<base>.txt 복원 + audio: 제거 + moved.json 삭제 + 머리말 보존", async () => {
    seedMemo();
    w("work/회의.transcript.md", "머리말\n");
    w(`_audio/${B1}.txt`, "전사본 원문\n둘째 줄");
    await rec.link(B1, { memo: MEMO });
    const res = await rec.unlink(B1, { memo: MEMO });
    expect(res.textKept).toBe(false);
    expect(r(`_audio/${B1}.txt`)).toBe("전사본 원문\n둘째 줄\n");
    expect(r("work/회의.transcript.md")).toBe("머리말\n");
    expect(parseVaultFile(r(MEMO)).frontmatter.audio).toBeUndefined();
    expect(ex(`_audio/.stt/${B1}/moved.json`)).toBe(false);
    expect(ex(`_audio/.stt/${B1}/done`)).toBe(true); // done 유지 (auto_stt 재전사 방지)
    expect(res.meeting.audio).toEqual([]);
  });

  it("섹션만 있던 사이드카는 unlink 후 파일 삭제", async () => {
    seedMemo();
    w(`_audio/${B1}.txt`, "전사본");
    await rec.link(B1, { memo: MEMO });
    await rec.unlink(B1, { memo: MEMO });
    expect(ex("work/회의.transcript.md")).toBe(false);
  });

  it("두 녹음 중 하나만 해제 — 나머지 섹션 유지", async () => {
    seedMemo();
    w(`_audio/${B1}.txt`, "오후");
    w(`_audio/${B2}.txt`, "오전");
    await rec.link(B1, { memo: MEMO });
    await rec.link(B2, { memo: MEMO });
    await rec.unlink(B2, { memo: MEMO });
    const t = r("work/회의.transcript.md");
    expect(t).toContain(`· ${B1}\n\n오후`);
    expect(t).not.toContain(B2);
    expect(audioOf(MEMO)).toEqual([B1]);
  });

  it("헤딩을 사용자가 고침 → 텍스트 무변경, audio: 만 제거, textKept=true", async () => {
    seedMemo();
    w(`_audio/${B1}.txt`, "전사본");
    await rec.link(B1, { memo: MEMO });
    const edited = r("work/회의.transcript.md").replace(`## 13:00 · ${B1}`, "## 오후 회의 녹음");
    w("work/회의.transcript.md", edited);
    const res = await rec.unlink(B1, { memo: MEMO });
    expect(res.textKept).toBe(true);
    expect(r("work/회의.transcript.md")).toBe(edited);
    expect(ex(`_audio/${B1}.txt`)).toBe(false);
    expect(parseVaultFile(r(MEMO)).frontmatter.audio).toBeUndefined();
  });

  it("사이드카 자체가 없음 → textKept=true, audio: 만 제거", async () => {
    seedMemo(MEMO, `id: 11111111-1111-1111-1111-111111111111\naudio:\n  - '${B1}'\n`);
    const res = await rec.unlink(B1, { memo: MEMO });
    expect(res.textKept).toBe(true);
    expect(audioOf(MEMO)).toEqual([]);
  });
});

describe("archive / unarchive", () => {
  it("보관 = archived 마커, 초벌만 있으면 tr.txt → _audio/<base>.txt + raw-promoted", async () => {
    w(`_audio/${B1}.m4a`, "x");
    w(`_audio/.stt/${B1}/done`);
    w(`_audio/.stt/${B1}/tr.txt`, "초벌");
    const res = await rec.archive(B1);
    expect(res.raw).toBe(true);
    expect(ex(`_audio/.stt/${B1}/archived`)).toBe(true);
    expect(r(`_audio/${B1}.txt`)).toBe("초벌");
    expect(ex(`_audio/.stt/${B1}/raw-promoted`)).toBe(true);
    await rec.unarchive(B1);
    expect(ex(`_audio/.stt/${B1}/archived`)).toBe(false);
    expect(ex(`_audio/${B1}.txt`)).toBe(true);
  });

  it("교정본(txt) 있으면 txt 무변경", async () => {
    w(`_audio/${B1}.txt`, "교정본");
    w(`_audio/.stt/${B1}/tr.txt`, "초벌");
    w(`_audio/.stt/${B1}/done`);
    const res = await rec.archive(B1);
    expect(res.raw).toBe(false);
    expect(r(`_audio/${B1}.txt`)).toBe("교정본");
  });
});

describe("GET /api/recordings — 목록", () => {
  it("m4a·txt base 합집합, .stt 파일·dot·기타 확장자 제외, 마커·job·길이 캐시, 날짜 desc", async () => {
    w(`_audio/${B1}.m4a`, "audio");
    w(`_audio/${B2}.m4a`, "audio");
    w(`_audio/20260821_미팅_정진용.txt`, "옛 전사본");
    w(`_audio/glossary.json`, "{}");
    w(`_audio/.DS_Store`, "");
    w(`_audio/.stt/imported-voicememos.txt`, "x"); // 파일 — 무시
    w(`_audio/.stt/${B1}/done`);
    w(`_audio/.stt/${B1}/archived`);
    w(`_audio/.stt/${B1}/화자분리.txt`, "x");
    w(`_audio/.stt/${B1}/job.json`, JSON.stringify({ state: "running", pid: 999999, step: "diarize" }));
    w(`_audio/.stt/orphan-dir-only/done`); // .stt 디렉터리만 있는 잔재 — 목록 대상 아님

    const { recordings } = await rec.list();
    expect(recordings.map((e) => e.base)).toEqual([B1, B2, "20260821_미팅_정진용"]);
    const e1 = recordings[0];
    expect(e1.hasM4a).toBe(true);
    expect(e1.hasTxt).toBe(false);
    expect(e1.stt).toEqual({ done: true, archived: true, moved: false, rawPromoted: false, anchored: false, diarized: true });
    // running 인데 pid 사망 → 목록 조회가 interrupted 로 갱신 (PR2)
    expect(e1.job).toEqual({ state: "error", pidAlive: false, step: "diarize", error: "interrupted" });
    expect(e1.durationSec).toBe(61.5);
    expect(e1.parsed).toMatchObject({ date: "2026-10-28", time: "13:00" });
    const old = recordings[2];
    expect(old).toMatchObject({ hasM4a: false, hasTxt: true, durationSec: null, job: null });
    expect(old.parsed.label).toBe("미팅_정진용");
    expect(probeCalls).toHaveLength(2);

    // meta.json 캐시 — 두 번째 호출엔 ffprobe 안 부름
    expect(JSON.parse(r(`_audio/.stt/${B2}/meta.json`)).durationSec).toBe(61.5);
    await rec.list();
    expect(probeCalls).toHaveLength(2);
  });

  it("iCloud dataless m4a — ffprobe 생략, syncPending", async () => {
    rec = make({ isDataless: () => true });
    w(`_audio/${B1}.m4a`, "audio");
    const { recordings } = await rec.list();
    expect(recordings[0].syncPending).toBe(true);
    expect(recordings[0].durationSec).toBeNull();
    expect(probeCalls).toHaveLength(0);
  });

  it("orphan 검사 — moved.json 인데 known 에 없는 base 만, `_` 폴더 사이드카까지 찾음", async () => {
    // B1: 메모가 `_` 폴더로 옮겨짐 (audio: 는 남아 있어도 클라 스캔에선 안 보임)
    seedMemo();
    w(`_audio/${B1}.m4a`, "a");
    w(`_audio/${B1}.txt`, "전사본1");
    await rec.link(B1, { memo: MEMO });
    mkdirSync(join(root, "_archive"), { recursive: true });
    await vault.rename(MEMO, "_archive/회의.md");
    await vault.rename("work/회의.transcript.md", "_archive/회의.transcript.md");
    // B2: moved.json 은 있는데 어디에도 섹션이 없음 = 전사본 없음
    w(`_audio/${B2}.m4a`, "a");
    w(`_audio/.stt/${B2}/moved.json`, JSON.stringify({ hash: "x", raw: false }));
    // B3: 연결됨 — 클라가 known 으로 넘김 → 검사 안 함
    const B3 = "20261027-1004";
    w(`_audio/${B3}.m4a`, "a");
    w(`_audio/.stt/${B3}/moved.json`, "{}");

    const { recordings } = await rec.list(new Set([B3]));
    const by = Object.fromEntries(recordings.map((e) => [e.base, e]));
    expect(by[B1].orphan).toBe("_archive/회의.md");
    expect(by[B2].orphan).toBe(false);
    expect("orphan" in by[B3]).toBe(false);

    // 찾은 메모로 link 재실행 = audio: 복구 (섹션 이미 있으니 ① skip)
    const res = await rec.link(B1, { memo: "_archive/회의.md" });
    expect(res.insertedSection).toBe(false);
  });

  it("HTTP: known 쿼리 파싱 + JSON 응답", async () => {
    w(`_audio/${B1}.m4a`, "a");
    const req = new Request(`http://x/api/recordings?known=${encodeURIComponent(B1)}`);
    const res = await handleRecordingsApi(req, new URL(req.url), rec);
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { recordings: Array<{ base: string }> };
    expect(body.recordings[0].base).toBe(B1);
  });
});

describe("GET /api/audio — 검증·코덱·dataless", () => {
  const call = async (q: string, rr: Recordings = rec) => {
    const req = new Request(`http://x/api/audio?${q}`);
    return (await handleRecordingsApi(req, new URL(req.url), rr))!;
  };

  it.each([
    ["base=..", 400],
    ["base=" + encodeURIComponent("../../etc/passwd"), 400],
    ["base=" + encodeURIComponent("a/b"), 400],
    ["base=" + encodeURIComponent("a\\b"), 400],
    ["base=.hidden", 400],
    ["", 400],
    ["base=nope", 404],
  ])("%s → %d", async (q, status) => {
    expect((await call(q)).status).toBe(status);
  });

  it("aac → 원본 m4a 서빙 (audio/mp4)", async () => {
    const served: string[] = [];
    const rr = make({
      fileResponse: (abs, headers) => {
        served.push(abs);
        return new Response("ok", { headers });
      },
    });
    w(`_audio/${B1}.m4a`, "a");
    const res = await call(`base=${B1}`, rr);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mp4");
    expect(served[0]).toBe(join(root, `_audio/${B1}.m4a`));
  });

  it("비 aac(alac) → play.m4a 를 1회 만들어 서빙", async () => {
    const served: string[] = [];
    let transcodes = 0;
    const rr = make({
      probe: async () => ({ durationSec: 1, codec: "alac", creationTime: null }),
      transcode: async (_src, dst) => {
        transcodes++;
        writeFileSync(dst, "aac");
      },
      fileResponse: (abs, headers) => {
        served.push(abs);
        return new Response("ok", { headers });
      },
    });
    w(`_audio/${B1}.m4a`, "a");
    await Promise.all([call(`base=${B1}`, rr), call(`base=${B1}`, rr)]);
    await call(`base=${B1}`, rr);
    expect(transcodes).toBe(1);
    expect(served.every((p) => p === join(root, `_audio/.stt/${B1}/play.m4a`))).toBe(true);
    expect(r(`_audio/.stt/${B1}/play.m4a`)).toBe("aac");
  });

  it("dataless → brctl download 요청 + 503 syncPending", async () => {
    const downloads: string[] = [];
    const rr = make({ isDataless: () => true, requestDownload: (a) => downloads.push(a) });
    w(`_audio/${B1}.m4a`, "a");
    const res = await call(`base=${B1}`, rr);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("syncPending");
    expect(downloads).toEqual([join(root, `_audio/${B1}.m4a`)]);
  });
});

// ── PR2: diarize / corrections job API ──────────────────────────────────────

describe("POST diarize / corrections — job 시작·전제조건", () => {
  const S = (f: string) => `_audio/.stt/${B1}/${f}`;
  let spawned: Array<Record<string, unknown>>;
  let alive: Set<number>;
  let lstarts: Map<number, string>;
  const jobJson = () => JSON.parse(r(S("job.json")));

  function makeJob(extra: Partial<RecordingsDeps> = {}) {
    return make({
      pidAlive: (pid) => alive.has(pid),
      procStart: (pid) => lstarts.get(pid) ?? null,
      spawnJob: (a) => {
        spawned.push({ ...a });
        alive.add(4321);
        lstarts.set(4321, "Mon Nov  2 13:00:00 2026");
        return { pid: 4321 };
      },
      ...extra,
    });
  }
  const post = async (rr: Recordings, action: string, body?: unknown, base = B1) => {
    const req = new Request(`http://x/api/recordings/${encodeURIComponent(base)}/${action}`, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = (await handleRecordingsApi(req, new URL(req.url), rr))!;
    return { status: res.status, body: (await res.json()) as Record<string, unknown> & { code?: string } };
  };
  function seedTranscribed() {
    w(`_audio/${B1}.m4a`, "a");
    w(S("tr.json"), "{}");
    w(S("done"));
  }

  beforeEach(() => {
    spawned = [];
    alive = new Set();
    lstarts = new Map();
    rec = makeJob();
  });

  it("diarize 성공 — spawn 인자, job.json running(pid·startedAt·lstart·speakers·names), 202", async () => {
    seedTranscribed();
    const res = await post(rec, "diarize", { speakers: 2, names: [" 함창수 ", "정진용"] });
    expect(res.status).toBe(202);
    expect(res.body.job).toMatchObject({ state: "running", pidAlive: true, kind: "diarize", step: "queued" });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ vaultDir: root, base: B1, kind: "diarize", speakers: 2, names: ["함창수", "정진용"] });
    expect(String(spawned[0].logPath)).toBe(join(root, S("job.log")));
    const j = jobJson();
    expect(j).toMatchObject({ state: "running", kind: "diarize", pid: 4321, lstart: "Mon Nov  2 13:00:00 2026", speakers: 2, names: ["함창수", "정진용"] });
    expect(Number.isNaN(Date.parse(j.startedAt))).toBe(false);

    // 목록: 살아 있는 job → processing 재료
    const { recordings } = await rec.list();
    expect(recordings[0].job).toMatchObject({ state: "running", pidAlive: true, kind: "diarize" });
  });

  it("diarize 400 — 화자 수 0·11·소수·문자열·누락, 이름 초과·빈 이름", async () => {
    seedTranscribed();
    for (const speakers of [0, 11, 2.5, "3", undefined]) {
      const res = await post(rec, "diarize", { speakers });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("badSpeakers");
    }
    for (const names of [["a", "b", "c"], ["a", ""], "a", [1]]) {
      const res = await post(rec, "diarize", { speakers: 2, names });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("badNames");
    }
    expect(spawned).toHaveLength(0);
  });

  it("diarize 409 — 초벌 전사 done 없음 / tr.json 단독(실패 잔재) / m4a 없음", async () => {
    w(`_audio/${B1}.m4a`, "a");
    w(S("tr.json"), "{}");
    let res = await post(rec, "diarize", { speakers: 2 });
    expect([res.status, res.body.code]).toEqual([409, "notTranscribed"]);
    rmSync(join(root, `_audio/${B1}.m4a`));
    w(S("done"));
    res = await post(rec, "diarize", { speakers: 2 });
    expect([res.status, res.body.code]).toEqual([409, "noAudio"]);
    expect(spawned).toHaveLength(0);
  });

  it("Pro 가드 — 마커 없으면 409 notPro + 이유 (diarize·corrections 둘 다)", async () => {
    seedTranscribed();
    w(S("화자분리.txt"), "x");
    rec = makeJob({ proCheck: () => ({ ok: false, reason: "이 맥은 전사 작업용 맥이 아닙니다" }) });
    for (const [action, body] of [["diarize", { speakers: 2 }], ["corrections", {}]] as const) {
      const res = await post(rec, action, body);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("notPro");
      expect(res.body.error).toContain("전사 작업용 맥");
    }
    expect(spawned).toHaveLength(0);
  });

  it("처리 중(pid 생존 + lstart 일치) → 두 API 모두 409 jobRunning", async () => {
    seedTranscribed();
    w(S("화자분리.txt"), "x");
    alive.add(55);
    lstarts.set(55, "L55");
    w(S("job.json"), JSON.stringify({ state: "running", kind: "diarize", step: "diarize", pid: 55, lstart: "L55", startedAt: "s", heartbeatAt: "s" }));
    expect((await post(rec, "diarize", { speakers: 2 })).body.code).toBe("jobRunning");
    expect((await post(rec, "corrections", {})).body.code).toBe("jobRunning");
    expect(spawned).toHaveLength(0);
  });

  it("동시 요청 두 개 → 하나만 spawn, 다른 하나는 409", async () => {
    seedTranscribed();
    const results = await Promise.all([post(rec, "diarize", { speakers: 2 }), post(rec, "diarize", { speakers: 3 })]);
    expect(results.map((x) => x.status).sort()).toEqual([202, 409]);
    expect(spawned).toHaveLength(1);
  });

  it("pid 재사용(살아 있지만 lstart 다름) = 실행 중 아님 → 새 job 허용", async () => {
    seedTranscribed();
    alive.add(55);
    lstarts.set(55, "다른 프로세스");
    w(S("job.json"), JSON.stringify({ state: "running", kind: "diarize", step: "diarize", pid: 55, lstart: "L55", startedAt: "s", heartbeatAt: "s" }));
    const res = await post(rec, "diarize", { speakers: 2 });
    expect(res.status).toBe(202);
  });

  it("corrections 409 — 화자분리.txt 없음", async () => {
    seedTranscribed();
    const res = await post(rec, "corrections"); // 빈 본문 허용
    expect([res.status, res.body.code]).toEqual([409, "notDiarized"]);
  });

  it("corrections 성공 / retryFailed 는 실패 청크 + partial 이 있어야 (없으면 409 noPartial)", async () => {
    seedTranscribed();
    w(S("화자분리.txt"), "x");
    let res = await post(rec, "corrections", { retryFailed: true });
    expect([res.status, res.body.code]).toEqual([409, "noPartial"]);

    res = await post(rec, "corrections");
    expect(res.status).toBe(202);
    expect(spawned[0]).toMatchObject({ kind: "corrections", base: B1 });

    // runner 가 실패 청크를 남기고 끝난 상태
    alive.clear();
    w(S("job.json"), JSON.stringify({ state: "error", kind: "corrections", step: "corrections 2/3", pid: 4321, startedAt: "s", heartbeatAt: "s", error: "청크 실패", failedChunks: [2] }));
    w(S("corrections.partial.json"), "{}");
    const { recordings } = await rec.list();
    expect(recordings[0].job).toEqual({ state: "error", pidAlive: false, step: "corrections 2/3", error: "청크 실패", kind: "corrections", failedChunks: [2] });
    res = await post(rec, "corrections", { retryFailed: true });
    expect(res.status).toBe(202);
    expect(spawned[1]).toMatchObject({ kind: "corrections-retry" });
  });

  it("spawn 실패 → 500 spawnFailed, job.json 안 남김", async () => {
    seedTranscribed();
    rec = makeJob({
      spawnJob: () => {
        throw new Error("bun 없음");
      },
    });
    const res = await post(rec, "diarize", { speakers: 2 });
    expect([res.status, res.body.code]).toEqual([500, "spawnFailed"]);
    expect(ex(S("job.json"))).toBe(false);
  });
});

describe("job 생존 판정 (목록 조회 시)", () => {
  const S = (f: string) => `_audio/.stt/${B1}/${f}`;
  const running = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ state: "running", kind: "diarize", step: "diarize", pid: 77, lstart: "L77", startedAt: "s", heartbeatAt: "s", ...extra });

  it("pid 사망 → job.json 을 error:interrupted 로 다시 씀 (pipeline 오류 재료)", async () => {
    w(`_audio/${B1}.m4a`, "a");
    w(S("job.json"), running());
    rec = make({ pidAlive: () => false });
    const { recordings } = await rec.list();
    expect(recordings[0].job).toMatchObject({ state: "error", error: "interrupted", pidAlive: false, kind: "diarize" });
    const j = JSON.parse(r(S("job.json")));
    expect(j).toMatchObject({ state: "error", error: "interrupted", pid: 77, startedAt: "s" });
    expect(j.finishedAt).toBeTruthy();
  });

  it("pid 는 살아 있지만 lstart 불일치(재사용) → interrupted", async () => {
    w(`_audio/${B1}.m4a`, "a");
    w(S("job.json"), running());
    rec = make({ pidAlive: () => true, procStart: () => "다른 시작 시각" });
    const { recordings } = await rec.list();
    expect(recordings[0].job).toMatchObject({ state: "error", error: "interrupted" });
  });

  it("pid 생존 + lstart 일치 → running 유지, 파일 무변경", async () => {
    w(`_audio/${B1}.m4a`, "a");
    w(S("job.json"), running());
    rec = make({ pidAlive: () => true, procStart: () => "L77" });
    const before = r(S("job.json"));
    const { recordings } = await rec.list();
    expect(recordings[0].job).toMatchObject({ state: "running", pidAlive: true });
    expect(r(S("job.json"))).toBe(before);
  });

  it("done/error job 은 pid 확인 없이 그대로 (anchorMisses 노출)", async () => {
    w(`_audio/${B1}.m4a`, "a");
    w(S("job.json"), running({ state: "done", step: "done", kind: "corrections", anchorMisses: 3 }));
    let checked = 0;
    rec = make({
      pidAlive: () => {
        checked++;
        return false;
      },
    });
    const { recordings } = await rec.list();
    expect(recordings[0].job).toEqual({ state: "done", pidAlive: false, step: "done", error: undefined, kind: "corrections", anchorMisses: 3 });
    expect(checked).toBe(0);
  });
});

// ── 실제 Bun.serve 로 Range → 206 확인 ──────────────────────────────────────
function hasBin(cmd: string): boolean {
  try {
    execFileSync("/bin/sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const canBun = hasBin("bun") && (existsSync("/opt/homebrew/bin/ffmpeg") || existsSync("/usr/local/bin/ffmpeg"));

describe.skipIf(!canBun)("GET /api/audio — Bun.serve Range (bun 서브프로세스)", () => {
  it("Range 요청 → 206 + content-range, traversal 400", () => {
    const ffmpeg = existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/local/bin/ffmpeg";
    mkdirSync(join(root, "_audio"), { recursive: true });
    execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac", join(root, `_audio/${B1}.m4a`)]);

    const script = join(root, "range-check.ts");
    const here = fileURLToPath(new URL(".", import.meta.url));
    const mod = join(here, "recordings.ts");
    const vc = join(here, "vaultCore.ts");
    writeFileSync(
      script,
      `import { createRecordings, handleRecordingsApi } from ${JSON.stringify(mod)};
import { VaultCore } from ${JSON.stringify(vc)};
const rec = createRecordings({ vault: new VaultCore({ root: ${JSON.stringify(root)}, git: false }) });
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => (await handleRecordingsApi(req, new URL(req.url), rec)) ?? new Response("nf", { status: 404 }) });
const u = "http://127.0.0.1:" + server.port;
const a = await fetch(u + "/api/audio?base=${B1}", { headers: { Range: "bytes=100-199" } });
const body = await a.arrayBuffer();
const t = await fetch(u + "/api/audio?base=" + encodeURIComponent("../x"));
console.log(JSON.stringify({ status: a.status, range: a.headers.get("content-range"), type: a.headers.get("content-type"), len: body.byteLength, trav: t.status }));
server.stop(true);
`,
    );
    const out = execFileSync("bun", ["run", script], { encoding: "utf8", timeout: 30_000 });
    const res = JSON.parse(out.trim().split("\n").pop()!);
    expect(res.status).toBe(206);
    expect(res.range).toMatch(/^bytes 100-199\/\d+$/);
    expect(res.type).toBe("audio/mp4");
    expect(res.len).toBe(100);
    expect(res.trav).toBe(400);
  }, 40_000);
});
