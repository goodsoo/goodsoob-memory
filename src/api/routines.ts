// 매일 반복되는 작업 (출근 / 운동 / 일기) — 마스터 1개당 매일 자동 등장.
//
// vault 모델 (옵시디안 호환):
//   - 1 routine = 1 md 파일 at `routines/{name}.md`
//   - frontmatter: `id` (영구 uuid) + `emoji?` + `time?` (HH:MM) + `started` (ISO) + `ends?` (ISO)
//   - body: 체크 로그 — `- [x] ✅ YYYY-MM-DD` 만. 옵시디안 Tasks plugin 호환.
//
// "자동 등장" = ends 가 없거나 today <= ends 면 사이드바/캘린더 사이드바에 매일 표시.
// 체크 라인은 사용자가 체크할 때만 추가. 태스크 카테고리와 완전 별개 도메인 — 태스크와 섞이지 않음.

import yaml from "js-yaml";
import type { VaultAdapter } from "../lib/vault/adapter";
import { splitFrontmatter } from "../lib/vault/parser";
import { freshStamp, parseStampToMs } from "../lib/vault/scan";

// `_` prefix = 앱 소유 네임스페이스 (메모장 노트 스캔에서 자동 제외).
export const ROUTINES_DIR = "_routines";
// 휴지통은 routines 도메인 안 별도 폴더 — 메모 `.trash/` / 포트폴리오 `_portfolio/.trash`
// 와 격리. 도메인별 분리는 복원 라우팅 단순화 (origin 추적 불필요).
export const ROUTINE_TRASH_DIR = "_routines/.trash";
// stamp prefix: `YYYY-MM-DDTHH-MM-SS-{name}.md` — portfolio trash 패턴과 동일.
const TRASH_STAMP_RE =
  /^_routines\/\.trash\/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-(.+)\.md$/;

export interface RoutineFrontmatter {
  id: string; // uuid (영구 식별자)
  time?: string; // "HH:MM" — 정렬 + 캘린더 사이드바 표시
  started: string; // ISO YYYY-MM-DD. 필수 (생성 default = 오늘).
  ends?: string; // ISO YYYY-MM-DD. 미지정 = 무기한. 종료일 지나면 사이드바 자동 숨김.
}

export interface Routine {
  slug: string; // 파일 basename (확장자 제외) = display name
  name: string;
  frontmatter: RoutineFrontmatter;
  // ISO date → true (체크된 날짜만). 미체크는 Set 에 없음.
  log: Set<string>;
  filePath: string;
  mtime: number;
}

// ─── path / id ─────────────────────────────────────────────────────────────

export function routinePath(name: string): string {
  return `${ROUTINES_DIR}/${name}.md`;
}

function genUid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "rxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const FORBIDDEN_NAME = /[\\/:*?"<>|]/;

export class InvalidRoutineNameError extends Error {
  constructor(name: string) {
    super(`사용할 수 없는 문자가 있어요: ${name}`);
    this.name = "InvalidRoutineNameError";
  }
}

export class RoutineConflictError extends Error {
  constructor(name: string) {
    super(`같은 이름의 루틴이 이미 있어요: ${name}`);
    this.name = "RoutineConflictError";
  }
}

export class RoutineDateRangeError extends Error {
  constructor() {
    super("종료일은 시작일과 같거나 이후여야 합니다.");
    this.name = "RoutineDateRangeError";
  }
}

// ─── parser ────────────────────────────────────────────────────────────────

const DONE_LINE_RE = /^\s*-\s*\[x\]\s*✅?\s*(\d{4}-\d{2}-\d{2})\s*$/i;

export function parseRoutineLog(body: string): Set<string> {
  const out = new Set<string>();
  for (const raw of body.split("\n")) {
    const m = raw.match(DONE_LINE_RE);
    if (m) out.add(m[1]);
  }
  return out;
}

// ─── serialize ─────────────────────────────────────────────────────────────

function fmStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

export function routineToRaw(routine: Routine): string {
  const fm: Record<string, unknown> = { id: routine.frontmatter.id };
  if (routine.frontmatter.time) fm.time = routine.frontmatter.time;
  fm.started = routine.frontmatter.started;
  if (routine.frontmatter.ends) fm.ends = routine.frontmatter.ends;
  const fmRaw = yaml.dump(fm, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    schema: yaml.JSON_SCHEMA,
  });

  // 최신 위 정렬. 매일 라인 1개씩만 누적.
  const dates = [...routine.log].sort().reverse();
  const lines = dates.map((d) => `- [x] ✅ ${d}`);
  return `---\n${fmRaw.trimEnd()}\n---\n\n# ${routine.name}\n\n${lines.join("\n")}\n`;
}

// ─── file → Routine ────────────────────────────────────────────────────────

export function fileToRoutine(
  filePath: string,
  raw: string,
  mtime: number,
): Routine | null {
  const { frontmatter: fm, body } = splitFrontmatter(raw);
  const id = fmStr(fm.id);
  if (!id) return null;
  const started = fmStr(fm.started);
  if (!started) return null; // started 필수
  const base = filePath.split("/").pop() ?? filePath;
  const name = base.replace(/\.md$/, "");
  return {
    slug: name,
    name,
    frontmatter: {
      id,
      time: fmStr(fm.time) || undefined,
      started,
      ends: fmStr(fm.ends) || undefined,
    },
    log: parseRoutineLog(body),
    filePath,
    mtime,
  };
}

// ─── active filter — 시작일~종료일 사이만 ──────────────────────────────────

export function isActiveOn(routine: RoutineFrontmatter, dateIso: string): boolean {
  if (dateIso < routine.started) return false;
  if (routine.ends && dateIso > routine.ends) return false;
  return true;
}

// 종료일이 오늘 이전 — 활성 list 에서 자동 분리되어 "지난 루틴" 영역에 노출.
// started 가 오늘 이후인 (아직 시작 전) 케이스는 active 가 아니지만 archive 도 아님 —
// "예정"은 별도 분기. 현재 UX 는 expired only.
export function isArchivedOn(
  routine: RoutineFrontmatter,
  dateIso: string,
): boolean {
  return !!routine.ends && routine.ends < dateIso;
}

// 시간순 + 이름순 정렬. 시간 없는 routine 은 시간 있는 것 뒤로.
export function sortRoutines(routines: Routine[]): Routine[] {
  return [...routines].sort((a, b) => {
    const ta = a.frontmatter.time ?? "";
    const tb = b.frontmatter.time ?? "";
    if (ta !== tb) {
      if (!ta) return 1;
      if (!tb) return -1;
      return ta.localeCompare(tb);
    }
    return a.name.localeCompare(b.name, "ko");
  });
}

// ─── API ───────────────────────────────────────────────────────────────────

export async function listRoutines(adapter: VaultAdapter): Promise<Routine[]> {
  const files = await adapter.list(ROUTINES_DIR);
  const results: Routine[] = [];
  for (const path of files) {
    if (!path.endsWith(".md")) continue;
    try {
      const raw = await adapter.read(path);
      const meta = await adapter.readMeta(path);
      const r = fileToRoutine(path, raw, meta.mtime);
      if (!r) continue;
      results.push(r);
    } catch {
      // 손상 skip
    }
  }
  return sortRoutines(results);
}

// 그날 활성인 routine 만 — 사이드바/캘린더 사이드바 표시용.
export async function listRoutinesActiveOn(
  adapter: VaultAdapter,
  dateIso: string,
): Promise<Routine[]> {
  const all = await listRoutines(adapter);
  return all.filter((r) => isActiveOn(r.frontmatter, dateIso));
}

export async function readRoutine(
  adapter: VaultAdapter,
  name: string,
): Promise<Routine | null> {
  const path = routinePath(name);
  if (!(await adapter.exists(path))) return null;
  const raw = await adapter.read(path);
  const meta = await adapter.readMeta(path);
  return fileToRoutine(path, raw, meta.mtime);
}

export interface CreateRoutineInput {
  name: string;
  time?: string;
  started: string;
  ends?: string;
}

export async function createRoutine(
  adapter: VaultAdapter,
  input: CreateRoutineInput,
): Promise<Routine> {
  const name = input.name.trim();
  if (!name) throw new InvalidRoutineNameError(name);
  if (FORBIDDEN_NAME.test(name)) throw new InvalidRoutineNameError(name);
  if (!input.started) throw new Error("시작일이 필요해요");
  if (input.ends && input.ends < input.started) throw new RoutineDateRangeError();
  const path = routinePath(name);
  if (await adapter.exists(path)) {
    throw new RoutineConflictError(name);
  }
  await adapter.mkdir(ROUTINES_DIR);
  const routine: Routine = {
    slug: name,
    name,
    frontmatter: {
      id: genUid(),
      time: input.time,
      started: input.started,
      ends: input.ends,
    },
    log: new Set(),
    filePath: path,
    mtime: 0,
  };
  const meta = await adapter.write(path, routineToRaw(routine));
  return { ...routine, mtime: meta.mtime };
}

export interface UpdateRoutineInput {
  time?: string | null;
  started?: string;
  ends?: string | null;
  rename?: string; // 새 name (파일 rename)
}

export async function updateRoutine(
  adapter: VaultAdapter,
  name: string,
  patch: UpdateRoutineInput,
): Promise<Routine> {
  const routine = await readRoutine(adapter, name);
  if (!routine) throw new Error(`routine not found: ${name}`);

  let currentName = name;
  let currentPath = routine.filePath;
  if (patch.rename && patch.rename !== name) {
    const next = patch.rename.trim();
    if (!next) throw new InvalidRoutineNameError(next);
    if (FORBIDDEN_NAME.test(next)) throw new InvalidRoutineNameError(next);
    const newPath = routinePath(next);
    if (await adapter.exists(newPath)) {
      throw new RoutineConflictError(next);
    }
    await adapter.rename(currentPath, newPath);
    currentName = next;
    currentPath = newPath;
  }

  const nextFm: RoutineFrontmatter = {
    id: routine.frontmatter.id,
    time:
      patch.time === null
        ? undefined
        : patch.time !== undefined
          ? patch.time
          : routine.frontmatter.time,
    started: patch.started ?? routine.frontmatter.started,
    ends:
      patch.ends === null
        ? undefined
        : patch.ends !== undefined
          ? patch.ends
          : routine.frontmatter.ends,
  };
  if (nextFm.ends && nextFm.ends < nextFm.started) {
    throw new RoutineDateRangeError();
  }
  const next: Routine = {
    ...routine,
    slug: currentName,
    name: currentName,
    filePath: currentPath,
    frontmatter: nextFm,
  };
  // rename 이 일어났을 수 있으니 expectedMtime 은 안 넘김 (rename 후 새 mtime).
  const meta = await adapter.write(currentPath, routineToRaw(next));
  return { ...next, mtime: meta.mtime };
}

// soft delete — 휴지통(`routines/.trash/`)으로 이동. 메모/포트폴리오와 같은 패턴.
// 본인이 메모를 실수로 삭제했다가 복구한 경험이 있어 루틴도 같은 안전망 필요.
export async function trashRoutine(
  adapter: VaultAdapter,
  name: string,
): Promise<string> {
  const path = routinePath(name);
  if (!(await adapter.exists(path))) {
    throw new Error(`routine not found: ${name}`);
  }
  await adapter.mkdir(ROUTINE_TRASH_DIR);
  const trashPath = `${ROUTINE_TRASH_DIR}/${freshStamp()}-${name}.md`;
  await adapter.rename(path, trashPath);
  return trashPath;
}

// 옛 API 호환 — UI 에서는 trashRoutine 직접 사용. 남겨두면 다음 작업이 모르고
// 사용할 위험이 있어 시그니처만 유지 + 내부적으로 soft delete.
export async function deleteRoutine(
  adapter: VaultAdapter,
  name: string,
): Promise<void> {
  await trashRoutine(adapter, name);
}

export interface TrashedRoutine {
  name: string; // 원본 name (stamp 제거)
  trashPath: string;
  stamp: string;
  deletedAt: number; // stamp → ms
  frontmatter: RoutineFrontmatter;
  log: Set<string>;
  mtime: number;
}

export async function listTrashedRoutines(
  adapter: VaultAdapter,
): Promise<TrashedRoutine[]> {
  const files = await adapter.list(ROUTINE_TRASH_DIR);
  const results: TrashedRoutine[] = [];
  for (const path of files) {
    if (!path.endsWith(".md")) continue;
    const m = path.match(TRASH_STAMP_RE);
    if (!m) continue;
    const [, stamp, name] = m;
    try {
      const raw = await adapter.read(path);
      const meta = await adapter.readMeta(path);
      const r = fileToRoutine(path, raw, meta.mtime);
      if (!r) continue;
      const deletedAt = parseStampToMs(stamp) || meta.mtime;
      results.push({
        name,
        trashPath: path,
        stamp,
        deletedAt,
        frontmatter: r.frontmatter,
        log: r.log,
        mtime: meta.mtime,
      });
    } catch {
      // 손상 skip
    }
  }
  // 최근 삭제 위
  results.sort((a, b) => b.deletedAt - a.deletedAt);
  return results;
}

// 복원 — `routines/.trash/{stamp}-{name}.md` → `routines/{name}.md`.
// 같은 name 이 다시 생성되어 있으면 throw (사용자에게 충돌 안내).
export async function restoreRoutine(
  adapter: VaultAdapter,
  trashPath: string,
): Promise<string> {
  const m = trashPath.match(TRASH_STAMP_RE);
  if (!m) throw new Error(`휴지통 경로 형식이 다릅니다: ${trashPath}`);
  const [, , name] = m;
  const target = routinePath(name);
  if (await adapter.exists(target)) {
    throw new RoutineConflictError(name);
  }
  await adapter.rename(trashPath, target);
  return target;
}

export async function purgeRoutine(
  adapter: VaultAdapter,
  trashPath: string,
): Promise<void> {
  if (await adapter.exists(trashPath)) await adapter.delete(trashPath);
}

export async function emptyRoutineTrash(adapter: VaultAdapter): Promise<void> {
  const files = await adapter.list(ROUTINE_TRASH_DIR);
  for (const p of files) {
    if (!p.endsWith(".md")) continue;
    try {
      await adapter.delete(p);
    } catch {
      // 한 항목 실패해도 진행
    }
  }
}

// 특정 날짜의 체크 토글. 활성 기간 안에서만 의미가 있지만 caller 가 검증.
export async function toggleRoutineDay(
  adapter: VaultAdapter,
  name: string,
  dateIso: string,
  done: boolean,
): Promise<Routine> {
  const routine = await readRoutine(adapter, name);
  if (!routine) throw new Error(`routine not found: ${name}`);
  const nextLog = new Set(routine.log);
  if (done) nextLog.add(dateIso);
  else nextLog.delete(dateIso);
  const next: Routine = { ...routine, log: nextLog };
  const meta = await adapter.write(
    routine.filePath,
    routineToRaw(next),
    routine.mtime,
  );
  return { ...next, mtime: meta.mtime };
}
