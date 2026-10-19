import { runShellCommand } from "./runtime";
import type { VaultAdapter } from "./vault/adapter";

export const BACKUP_DIR = ".backups";

export interface BackupEntry {
  filename: string;
  path: string; // vault-relative (".backups/...zip")
  mtime: number;
  size: number;
}

// 보관 개수 default. 사용자가 설정 모달에서 조정 가능.
// 백업 1개가 vault 전체 zip(수백MB~GB)이라 개수 × 크기 = 디스크·iCloud 용량 —
// 작게 둔다(default 10 × ~1GB = 10GB 가 iCloud 를 먹던 사고 이후 하향).
export const DEFAULT_KEEP_COUNT = 3;
export const KEEP_COUNT_OPTIONS = [3, 5, 10, 20] as const;

export interface AutoBackupConfig {
  enabled: boolean;
  intervalDays: number;
  keepCount: number;
}

const AUTO_BACKUP_KEY = "autoBackupConfig";
const DEFAULT_CONFIG: AutoBackupConfig = {
  enabled: true,
  intervalDays: 1,
  keepCount: DEFAULT_KEEP_COUNT,
};

export function readAutoBackupConfig(): AutoBackupConfig {
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    const keepCount = Number(parsed.keepCount);
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_CONFIG.enabled,
      intervalDays: Number(parsed.intervalDays) || DEFAULT_CONFIG.intervalDays,
      keepCount: Number.isFinite(keepCount) && keepCount > 0 ? keepCount : DEFAULT_KEEP_COUNT,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function writeAutoBackupConfig(cfg: AutoBackupConfig): void {
  localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify(cfg));
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

function backupFilename(now = new Date()): string {
  const y = now.getFullYear();
  return `goodsoob-vault-${y}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// vault root 에서 자기 자신 (.backups) 제외하고 zip. tmp 로 쓴 후 rename.
export async function runBackup(adapter: VaultAdapter): Promise<BackupEntry> {
  const root = adapter.getRoot();
  if (!root) throw new Error("vault root not set");
  await adapter.mkdir(BACKUP_DIR);

  const filename = backupFilename();
  const relFinal = `${BACKUP_DIR}/${filename}`;
  const relTmp = `${BACKUP_DIR}/${filename}.tmp`;
  const absTmp = `${root}/${relTmp}`;

  const cmd = [
    `cd ${shellQuote(root)}`,
    // .git 제외 — git 히스토리는 그 자체가 백업이라 zip 에 또 넣으면 중복(백업
    // 크기 ~절반 절감). 복구는 md 파일 내용 기준이고 히스토리는 .git 이 보관.
    `zip -rq ${shellQuote(absTmp)} . -x ${shellQuote(`${BACKUP_DIR}/*`)} -x ${shellQuote(BACKUP_DIR)} -x '.git/*' -x '.git' -x '.DS_Store' -x '**/.DS_Store'`,
  ].join(" && ");

  const result = await runShellCommand("sh", ["-lc", cmd]);
  if (result.code !== 0) {
    try {
      await adapter.delete(relTmp);
    } catch {
      // cleanup best-effort
    }
    throw new Error(`zip 실패 (exit ${result.code}): ${result.stderr || result.stdout}`);
  }

  await adapter.rename(relTmp, relFinal);
  const meta = await adapter.readMeta(relFinal);
  return { filename, path: relFinal, mtime: meta.mtime, size: meta.size };
}

export async function listBackups(adapter: VaultAdapter): Promise<BackupEntry[]> {
  // adapter.list 가 dot-prefix 파일은 필터하지만 폴더 안 내용은 그대로 반환.
  let files: string[];
  try {
    files = await adapter.list(BACKUP_DIR);
  } catch {
    return [];
  }
  const entries: BackupEntry[] = [];
  for (const path of files) {
    if (!path.endsWith(".zip")) continue;
    try {
      const meta = await adapter.readMeta(path);
      entries.push({
        filename: path.slice(BACKUP_DIR.length + 1),
        path,
        mtime: meta.mtime,
        size: meta.size,
      });
    } catch {
      // 깨진 entry 는 skip
    }
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  return entries;
}

export async function deleteBackup(adapter: VaultAdapter, path: string): Promise<void> {
  await adapter.delete(path);
}

// 실패한 백업의 고아 .tmp 정리. listBackups 는 .zip 만 세므로 retention 이 .tmp 를
// 못 건드려, zip 중 프로세스가 죽으면 ~1GB .tmp 가 영원히 남던 잔재를 청소한다.
export async function cleanupOrphanedTmp(adapter: VaultAdapter): Promise<number> {
  let files: string[];
  try {
    files = await adapter.list(BACKUP_DIR);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const path of files) {
    if (!path.endsWith(".tmp")) continue;
    try {
      await adapter.delete(path);
      removed++;
    } catch {
      // best-effort
    }
  }
  return removed;
}

// 새 백업 1개 만들기 위해 삭제해야 할 오래된 entries.
// entries.length + 1 > keepCount 일 때 (length + 1 - keepCount) 개 반환.
export function deletionsRequiredForNewBackup(
  entries: BackupEntry[],
  keepCount: number,
): BackupEntry[] {
  const surplus = entries.length + 1 - keepCount;
  if (surplus <= 0) return [];
  return entries.slice(-surplus); // 최신순 정렬 — 끝쪽이 오래된 것
}

export type AutoBackupResult =
  | { kind: "skipped"; reason: "disabled" | "not-due" }
  | { kind: "created"; entry: BackupEntry };

// 자동 백업 트리거 — vault ready 후 1회 호출.
// - disabled / 아직 주기 안 됨 → skipped
// - 보관 한도 초과 예정이면 옛 백업 자동 정리 후 새 백업 (사용자가 자동 백업 켠 시점에 동의).
export async function maybeAutoBackup(
  adapter: VaultAdapter,
): Promise<AutoBackupResult> {
  const cfg = readAutoBackupConfig();
  if (!cfg.enabled) return { kind: "skipped", reason: "disabled" };
  await cleanupOrphanedTmp(adapter);
  const entries = await listBackups(adapter);
  const intervalMs = cfg.intervalDays * 24 * 60 * 60 * 1000;
  if (entries.length > 0 && Date.now() - entries[0].mtime < intervalMs) {
    return { kind: "skipped", reason: "not-due" };
  }
  const toDelete = deletionsRequiredForNewBackup(entries, cfg.keepCount);
  for (const c of toDelete) {
    await deleteBackup(adapter, c.path);
  }
  const entry = await runBackup(adapter);
  return { kind: "created", entry };
}

// macOS Finder 로 path 열기 — 서버가 `open` 실행.
export async function openInFinder(absPath: string): Promise<void> {
  await runShellCommand("sh", ["-lc", `open ${shellQuote(absPath)}`]);
}
