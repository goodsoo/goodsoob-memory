import { useEffect, useRef, useState } from "react";
import { Archive, FolderOpen, Trash2 } from "lucide-react";
import { useVault } from "../../lib/vault/useVault";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { Modal } from "../common/Modal";
import { Spinner } from "../common/Spinner";
import { useToast } from "../Toast";
import {
  runBackup,
  listBackups,
  deleteBackup,
  readAutoBackupConfig,
  writeAutoBackupConfig,
  deletionsRequiredForNewBackup,
  openInFinder,
  KEEP_COUNT_OPTIONS,
  BACKUP_DIR,
  type BackupEntry,
  type AutoBackupConfig,
} from "../../lib/backup";

export function BackupSection() {
  const { adapter } = useVault();
  const toast = useToast();
  const [entries, setEntries] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cfg, setCfg] = useState<AutoBackupConfig>(() => readAutoBackupConfig());
  const [confirmCandidates, setConfirmCandidates] = useState<BackupEntry[] | null>(null);

  const vaultRoot = adapter.getRoot();
  const backupAbsPath = vaultRoot ? `${vaultRoot}/${BACKUP_DIR}` : null;

  async function refresh() {
    try {
      const list = await listBackups(adapter);
      setEntries(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // 첫 mount 시 1회 비동기 fetch — refresh 가 내부에서 set* 호출.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    void refresh();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  async function handleManualBackup() {
    setError(null);
    const toDelete = deletionsRequiredForNewBackup(entries, cfg.keepCount);
    if (toDelete.length > 0) {
      setConfirmCandidates(toDelete);
      return;
    }
    await actuallyBackup();
  }

  // 1초 이상 걸리면 화면 어디 있어도 진행 보이게 progress toast.
  // running=true 1초 후 toast 띄움, running=false 면 즉시 dismiss.
  const progressIdRef = useRef<number | null>(null);
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!running) {
      if (progressIdRef.current !== null) {
        toast.dismiss(progressIdRef.current);
        progressIdRef.current = null;
      }
      return;
    }
    const timer = setTimeout(() => {
      progressIdRef.current = toast.show("vault 백업 중… (크기에 따라 1-10초)", {
        kind: "progress",
      });
    }, 1000);
    return () => {
      clearTimeout(timer);
      if (progressIdRef.current !== null) {
        toast.dismiss(progressIdRef.current);
        progressIdRef.current = null;
      }
    };
  }, [running]);
  /* eslint-enable react-hooks/exhaustive-deps */

  async function actuallyBackup() {
    setRunning(true);
    try {
      await runBackup(adapter);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function confirmBackup() {
    if (!confirmCandidates) return;
    setError(null);
    setRunning(true);
    try {
      for (const c of confirmCandidates) {
        await deleteBackup(adapter, c.path);
      }
      await runBackup(adapter);
      setConfirmCandidates(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function handleOpenFolder() {
    if (!backupAbsPath) return;
    try {
      await openInFinder(backupAbsPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function cancelConfirm() {
    if (running) return;
    setConfirmCandidates(null);
  }

  async function handleDelete(path: string) {
    setError(null);
    try {
      await deleteBackup(adapter, path);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function updateConfig(patch: Partial<AutoBackupConfig>) {
    const next = { ...cfg, ...patch };
    setCfg(next);
    writeAutoBackupConfig(next);
  }

  const lastEntry = entries[0];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            onClick={handleManualBackup}
            disabled={running}
            leftIcon={
              running ? (
                <Spinner size="md" />
              ) : (
                <Archive className="h-4 w-4" />
              )
            }
            className="rounded-lg px-3 py-2 active:opacity-80 disabled:opacity-50"
          >
            {running ? "백업 중…" : "지금 백업"}
          </Button>
          {backupAbsPath ? (
            <Button
              variant="ghost"
              onClick={handleOpenFolder}
              leftIcon={<FolderOpen className="h-4 w-4" />}
              className="rounded-lg px-3 py-2"
              style={{ color: "var(--sub)" }}
            >
              백업 폴더 열기
            </Button>
          ) : null}
        </div>
        <div
          className="space-y-1 rounded-lg px-3 py-2"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--line-2)",
          }}
        >
          <Text variant="caption" color="muted" as="div">
            마지막 백업
          </Text>
          <Text variant="body" as="div">
            {lastEntry ? formatBackupDate(lastEntry.mtime) : "없음"}
          </Text>
          {backupAbsPath ? (
            <Text
              variant="caption"
              color="muted"
              as="div"
              className="break-all"
              style={{ fontFamily: "var(--font-mono, monospace)" }}
            >
              {formatHomeRelative(backupAbsPath)}
            </Text>
          ) : null}
        </div>
      </section>

      <section className="space-y-2">
        <Text
          variant="caption"
          color="muted"
          as="h3"
          weight="semibold"
          className="uppercase tracking-wide"
        >
          자동 백업
        </Text>
        <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => updateConfig({ enabled: e.target.checked })}
          />
          앱 실행 시 자동 백업
        </label>
        {cfg.enabled && (
          <div className="flex items-end gap-4 pl-6 pt-1">
            <Text
              variant="caption"
              color="secondary"
              as="label"
            >
              <span className="mb-1 block">주기</span>
              <select
                value={cfg.intervalDays}
                onChange={(e) => updateConfig({ intervalDays: Number(e.target.value) })}
                className="cursor-pointer rounded px-2 py-1 text-sm"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--line)",
                  color: "var(--ink)",
                }}
              >
                <option value={0.5}>12시간</option>
                <option value={1}>1일</option>
                <option value={3}>3일</option>
                <option value={7}>7일</option>
              </select>
            </Text>
            <Text
              variant="caption"
              color="secondary"
              as="label"
            >
              <span className="mb-1 block">보관</span>
              <select
                value={cfg.keepCount}
                onChange={(e) => updateConfig({ keepCount: Number(e.target.value) })}
                className="cursor-pointer rounded px-2 py-1 text-sm"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--line)",
                  color: "var(--ink)",
                }}
              >
                {KEEP_COUNT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}개
                  </option>
                ))}
              </select>
            </Text>
          </div>
        )}
      </section>

      {confirmCandidates && (
        <BackupConfirmModal
          candidates={confirmCandidates}
          keepCount={cfg.keepCount}
          running={running}
          onConfirm={confirmBackup}
          onCancel={cancelConfirm}
        />
      )}

      <section>
        <Text
          variant="caption"
          color="muted"
          as="h3"
          weight="semibold"
          className="mb-2 uppercase tracking-wide"
        >
          최근 백업{entries.length > 0 ? ` (${entries.length})` : ""}
        </Text>
        {loading ? (
          <Text variant="body" color="muted" as="p">
            불러오는 중…
          </Text>
        ) : entries.length === 0 ? (
          <Text variant="body" color="muted" as="p">
            백업 없음. 위 버튼으로 시작하세요.
          </Text>
        ) : (
          <ul className="space-y-0.5">
            {entries.map((e) => (
              <li
                key={e.path}
                className="flex items-center justify-between gap-3 rounded px-2 py-1.5"
              >
                <div className="min-w-0">
                  <Text variant="body" as="div">
                    {formatBackupDate(e.mtime)}
                  </Text>
                  <Text variant="caption" color="muted" as="div">
                    {formatSize(e.size)}
                  </Text>
                </div>
                <Button
                  variant="icon"
                  onClick={() => handleDelete(e.path)}
                  aria-label="삭제"
                  title="삭제"
                  className="shrink-0"
                  style={{ color: "var(--faint)" }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <Text
          variant="body"
          as="div"
          className="rounded px-3 py-2"
          style={{
            color: "var(--down)",
            background: "var(--bg)",
            border: "1px solid var(--down)",
          }}
        >
          {error}
        </Text>
      )}
    </div>
  );
}

function formatBackupDate(mtime: number): string {
  const d = new Date(mtime);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 사용자 home 으로 시작하는 path 면 `~` 로 축약. 더 길어도 표시 가능.
function formatHomeRelative(absPath: string): string {
  // Tauri 환경에서 vault root 가 절대경로. home prefix 추출은 OS dependent 라
  // 가장 흔한 `/Users/<name>/` 만 처리. 그 외는 그대로 노출.
  const m = absPath.match(/^(\/Users\/[^/]+)\//);
  if (m) return "~" + absPath.slice(m[1].length);
  return absPath;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type BackupConfirmModalProps = {
  candidates: BackupEntry[];
  keepCount: number;
  running: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

function BackupConfirmModal({
  candidates,
  keepCount,
  running,
  onConfirm,
  onCancel,
}: BackupConfirmModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !running) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, running]);

  const title = `보관 한도 가득 (${keepCount}개)`;
  const desc = `새 백업을 만들려면 오래된 ${candidates.length}개 삭제 필요:`;
  const confirmLabel = "삭제 후 백업";

  return (
    <Modal
      open
      onClose={() => !running && onCancel()}
      size="md"
      ariaLabel={title}
      dismissOnEscape={!running}
      dismissOnBackdrop={!running}
    >
      <div className="p-5">
        <Text variant="body" weight="semibold" as="h3" className="mb-2">
          {title}
        </Text>
        <Text variant="body" color="secondary" as="p" className="mb-3">
          {desc}
        </Text>
        <Text
          variant="caption"
          color="muted"
          as="ul"
          className="mb-4 max-h-40 space-y-0.5 overflow-y-auto rounded px-3 py-2"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--line-2)",
          }}
        >
          {candidates.map((c) => (
            <li key={c.path}>{c.filename}</li>
          ))}
        </Text>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={running}
            className="px-3 py-1.5"
            style={{ color: "var(--sub)" }}
          >
            취소
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={running}
            leftIcon={
              running ? <Spinner size="sm" /> : null
            }
            className="px-3 py-1.5"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
