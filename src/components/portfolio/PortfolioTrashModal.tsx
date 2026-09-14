import { useEffect, useState } from "react";
import { GitBranch, RotateCcw, Trash2, X } from "lucide-react";
import {
  useEmptyPortfolioTrash,
  usePurgePortfolioWork,
  useRestorePortfolioWork,
  useTrashedPortfolioWorks,
} from "../../hooks/usePortfolio";
import type { TrashedPortfolioWork } from "../../api/portfolio";
import { useVault } from "../../lib/vault/useVault";
import { vaultAssetSrc } from "../../lib/portfolio/assetUrl";
import {
  categoryColor as lookupCategoryColor,
  categoryLabel as lookupCategoryLabel,
} from "../../lib/portfolio/categoryLookup";
import { formatDisplayDateTime } from "../../lib/dates";
import { formatError } from "../../lib/errors";
import { ConfirmDialog } from "../ConfirmDialog";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { Chip } from "../common/Chip";

// stamp → 표시용 ISO ms (TrashedPortfolioWork.deletedAt 에 이미 ms 변환되어 있음).

type Props = {
  open: boolean;
  onClose: () => void;
};

export function PortfolioTrashModal({ open, onClose }: Props) {
  const { data, isLoading } = useTrashedPortfolioWorks();
  const restore = useRestorePortfolioWork();
  const purge = usePurgePortfolioWork();
  const empty = useEmptyPortfolioTrash();
  const { adapter } = useVault();
  const vaultRoot = adapter.getRoot();

  const [error, setError] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<TrashedPortfolioWork | null>(
    null,
  );
  const [emptyConfirm, setEmptyConfirm] = useState(false);
  const confirmOpen = purgeTarget !== null || emptyConfirm;

  useEffect(() => {
    if (!open) {
      setError(null);
      setPurgeTarget(null);
      setEmptyConfirm(false);
    }
  }, [open]);

  async function handleRestore(trashPath: string) {
    setError(null);
    try {
      await restore.mutateAsync(trashPath);
    } catch (e) {
      setError(formatError(e));
    }
  }

  async function confirmPurge() {
    if (!purgeTarget) return;
    try {
      await purge.mutateAsync(purgeTarget.trashPath);
      setPurgeTarget(null);
    } catch (e) {
      setError(formatError(e));
      setPurgeTarget(null);
    }
  }

  async function confirmEmpty() {
    try {
      await empty.mutateAsync();
      setEmptyConfirm(false);
    } catch (e) {
      setError(formatError(e));
      setEmptyConfirm(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      ariaLabel="휴지통"
      dismissOnEscape={!confirmOpen}
      dismissOnBackdrop={!confirmOpen}
    >
      <aside
          className="flex min-h-0 flex-1 flex-col"
          style={{ background: "var(--bg)" }}
        >
          <div
            className="flex h-12 shrink-0 items-center gap-2 px-4 text-sm font-semibold"
            style={{
              color: "var(--ink)",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <Trash2 className="h-4 w-4" style={{ color: "var(--sub)" }} />
            휴지통
            {data && data.length > 0 ? (
              <Text
                variant="caption"
                color="muted"
                as="span"
                weight="normal"
              >
                {data.length}
              </Text>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              {data && data.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setEmptyConfirm(true);
                  }}
                  disabled={empty.isPending}
                  title="휴지통 비우기"
                  className="font-normal"
                  style={{
                    backgroundColor: "var(--down-soft)",
                    color: "var(--down-ink)",
                    border: "1px solid var(--down)",
                  }}
                >
                  비우기
                </Button>
              ) : null}
              <Button
                variant="icon"
                onClick={onClose}
                title="닫기  ESC"
                aria-label="닫기"
                style={{ color: "var(--faint)" }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {error ? (
            <Text
              variant="caption"
              as="div"
              className="mx-3 mt-2 rounded px-2 py-1"
              style={{
                borderLeft: "2px solid var(--down)",
                backgroundColor: "var(--down-soft)",
                color: "var(--down-ink)",
              }}
            >
              {error}
            </Text>
          ) : null}

          {data && data.length > 0 ? (
            <Text
              variant="caption"
              as="div"
              className="mx-3 mt-2 rounded-md px-2 py-1.5 text-[11px] leading-relaxed"
              style={{
                backgroundColor: "var(--accent-soft)",
                color: "var(--accent-ink)",
                border: "1px solid var(--accent)",
              }}
            >
              여기 있는 카드는 <strong>전체 동기화</strong> 시 같은 PR 로 다시
              생성됩니다. 부활 없이 안 보이게만 두려면 <strong>미사용</strong>
              으로 옮겨주세요. <strong>복원</strong> 누르면 자동으로 미사용
              자리로 돌아갑니다.
            </Text>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="space-y-2 p-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-12 animate-pulse rounded-md"
                    style={{ backgroundColor: "var(--surface)" }}
                  />
                ))}
              </div>
            ) : !data || data.length === 0 ? (
              <Text
                variant="body"
                color="muted"
                as="div"
                className="px-4 py-8 text-center"
              >
                휴지통이 비어 있어요
              </Text>
            ) : (
              <ul className="flex flex-col gap-2 p-3">
                {data.map((t) => (
                  <TrashListItem
                    key={t.trashPath}
                    work={t}
                    vaultRoot={vaultRoot ?? ""}
                    onRestore={() => handleRestore(t.trashPath)}
                    onPurge={() => setPurgeTarget(t)}
                    busy={
                      (restore.isPending && restore.variables === t.trashPath) ||
                      (purge.isPending && purge.variables === t.trashPath)
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>

      <ConfirmDialog
        open={purgeTarget !== null}
        danger
        title="영구 삭제"
        message={
          purgeTarget
            ? `"${purgeTarget.frontmatter.impact_summary || purgeTarget.frontmatter.github_title}" 카드를 영구 삭제할까요? 되돌릴 수 없어요.`
            : ""
        }
        confirmLabel="영구 삭제"
        busy={purge.isPending}
        onConfirm={confirmPurge}
        onCancel={() => setPurgeTarget(null)}
      />
      <ConfirmDialog
        open={emptyConfirm}
        danger
        title="휴지통 비우기"
        message={`휴지통의 ${data?.length ?? 0}개 항목을 모두 영구 삭제할까요? 되돌릴 수 없어요.`}
        confirmLabel="비우기"
        busy={empty.isPending}
        onConfirm={confirmEmpty}
        onCancel={() => setEmptyConfirm(false)}
      />
    </Modal>
  );
}

function TrashListItem({
  work,
  vaultRoot,
  onRestore,
  onPurge,
  busy,
}: {
  work: TrashedPortfolioWork;
  vaultRoot: string;
  onRestore: () => void;
  onPurge: () => void;
  busy: boolean;
}) {
  const fm = work.frontmatter;
  const firstShot = fm.screenshots[0];
  const title = fm.impact_summary || fm.github_title;
  const categoryLabel = lookupCategoryLabel(fm.category);
  const categoryColor = lookupCategoryColor(fm.category);
  return (
    <li
      className="flex items-center gap-3 rounded-md px-3 py-2"
      style={{
        backgroundColor: "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      <div
        className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md"
        style={{
          backgroundColor: "var(--surface-2)",
          border: "1px solid var(--line-2)",
        }}
      >
        {firstShot ? (
          <img
            src={vaultAssetSrc(vaultRoot, firstShot.path)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <GitBranch
            className="h-4 w-4"
            strokeWidth={1.5}
            style={{ color: "var(--faint)" }}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Text
          variant="body"
          weight="semibold"
          as="div"
          truncate
          title={title}
        >
          {title}
        </Text>
        <div className="flex items-center gap-2">
          <Chip size="sm" dot={categoryColor}>
            {categoryLabel}
          </Chip>
          <Text
            variant="caption"
            color="muted"
            as="span"
            className="text-[11px]"
          >
            {work.deletedAt
              ? `${formatDisplayDateTime(new Date(work.deletedAt).toISOString())} 삭제`
              : ""}
          </Text>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          onClick={onRestore}
          disabled={busy}
          leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
          style={{
            backgroundColor: "var(--surface-2)",
            color: "var(--ink)",
          }}
          title="미사용 자리로 복원 (평가 자료에는 포함 안 됨)"
        >
          미사용 복원
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onPurge}
          disabled={busy}
          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          style={{
            backgroundColor: "var(--down-soft)",
            color: "var(--down-ink)",
            border: "1px solid var(--down)",
          }}
          title="영구 삭제"
        >
          삭제
        </Button>
      </div>
    </li>
  );
}

