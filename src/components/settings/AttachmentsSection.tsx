import { useEffect, useState } from "react";
import { ImageOff, Trash2 } from "lucide-react";
import { useVault } from "../../lib/vault/useVault";
import {
  deleteAttachments,
  findOrphanAttachments,
} from "../../lib/attachments";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { Spinner } from "../common/Spinner";
import { useToast } from "../Toast";

interface OrphanRow {
  path: string;
  size: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export function AttachmentsSection() {
  const { adapter } = useVault();
  const toast = useToast();
  const [rows, setRows] = useState<OrphanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const paths = await findOrphanAttachments(adapter, "notes");
      const withSize: OrphanRow[] = [];
      for (const p of paths) {
        try {
          const meta = await adapter.readMeta(p);
          withSize.push({ path: p, size: meta.size });
        } catch {
          withSize.push({ path: p, size: 0 });
        }
      }
      setRows(withSize);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    void refresh();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  async function handleCleanup() {
    setConfirmOpen(false);
    setDeleting(true);
    try {
      const paths = rows.map((r) => r.path);
      const result = await deleteAttachments(adapter, paths);
      if (result.errors.length > 0) {
        toast.show(
          `정리 일부 실패. ${result.deleted.length}개 삭제, ${result.errors.length}개 실패.`,
        );
      }
      await refresh();
    } catch (err) {
      toast.show(
        err instanceof Error
          ? `정리에 실패했습니다. ${err.message}`
          : "정리에 실패했습니다.",
      );
    } finally {
      setDeleting(false);
    }
  }

  const totalSize = rows.reduce((sum, r) => sum + r.size, 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Text variant="body" as="p" style={{ color: "var(--sub)" }}>
          본문에서 지워도 vault 안 이미지 파일은 남습니다. 활성 메모와 휴지통
          어디서도 참조하지 않는 첨부만 정리합니다.
        </Text>
      </div>

      {loading ? (
        <div className="flex items-center gap-2">
          <Spinner size="sm" />
          <Text variant="caption" style={{ color: "var(--faint)" }}>
            첨부를 검사하고 있습니다.
          </Text>
        </div>
      ) : error ? (
        <div
          className="rounded-md p-3"
          style={{
            background: "var(--down-soft)",
            color: "var(--down-ink)",
          }}
        >
          <Text variant="caption">
            검사에 실패했습니다. {error}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            className="mt-2"
          >
            다시 시도
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div
          className="flex items-center gap-2 rounded-md p-3"
          style={{
            background: "var(--surface)",
            color: "var(--sub)",
          }}
        >
          <ImageOff className="h-4 w-4" />
          <Text variant="caption">사용 안 하는 첨부가 없습니다.</Text>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <Text variant="body" weight="semibold">
              {rows.length}개 · {formatBytes(totalSize)}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={deleting}
            >
              <Trash2 className="h-3.5 w-3.5" />
              정리
            </Button>
          </div>
          <ul
            className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md p-2 font-mono"
            style={{
              background: "var(--surface)",
              fontSize: "0.75rem",
              color: "var(--sub)",
            }}
          >
            {rows.map((r) => (
              <li key={r.path} className="flex items-baseline justify-between gap-3">
                <span className="truncate">{r.path}</span>
                <span className="shrink-0 tabular-nums" style={{ color: "var(--faint)" }}>
                  {formatBytes(r.size)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirmOpen ? (
        <div
          className="rounded-md p-3"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
          }}
        >
          <Text variant="caption" as="p" style={{ color: "var(--ink)" }}>
            {rows.length}개 첨부 ({formatBytes(totalSize)}) 를 영구 삭제합니다.
            되돌릴 수 없습니다.
          </Text>
          <div className="mt-2 flex gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => void handleCleanup()}
              disabled={deleting}
            >
              {deleting ? "삭제 중…" : "삭제"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
            >
              취소
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
