import { useEffect, useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import {
  useDeletedMeetings,
  useEmptyTrash,
  useRestoreMeeting,
  usePurgeMeeting,
} from "../../hooks/useMeetings";
import type { Meeting } from "../../api/meetings";
import { formatDisplayDateTime } from "../../lib/dates";
import { formatError } from "../../lib/errors";
import { ConfirmDialog } from "../ConfirmDialog";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { TrashPreview } from "./TrashPreview";

// 휴지통 파일명 stamp prefix (`YYYY-MM-DDTHH-MM-SS-`) 는 디스크 표현이지 표시명이
// 아니다. 표시 직전에 잘라낸다. scanTrash / listDeletedMeetings / restoreFromTrash 는
// 그대로 stamp 사용.
function stripTrashStamp(title: string | null | undefined): string {
  return (title ?? "").replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, "");
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export function TrashModal({ open, onClose }: Props) {
  const { data, isLoading } = useDeletedMeetings();
  const restore = useRestoreMeeting();
  const purge = usePurgeMeeting();
  const empty = useEmptyTrash();
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<Meeting | null>(null);
  const [emptyConfirm, setEmptyConfirm] = useState(false);

  const confirmOpen = purgeTarget !== null || emptyConfirm;

  // 모달 닫힐 때 state 리셋. 의도된 effect → state sync.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setError(null);
      setPurgeTarget(null);
      setEmptyConfirm(false);
    }
  }, [open]);

  // 첫 항목 auto-select + invalid selection fallback
  useEffect(() => {
    if (!open || !data) return;
    if (data.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    const inList = selectedId && data.some((m) => m.id === selectedId);
    if (!inList) setSelectedId(data[0].id);
  }, [open, data, selectedId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleRestore(id: string) {
    setError(null);
    try {
      await restore.mutateAsync(id);
    } catch (e) {
      setError(formatError(e));
    }
  }

  function handlePurge(meeting: Meeting) {
    setError(null);
    setPurgeTarget(meeting);
  }

  async function confirmPurge() {
    if (!purgeTarget) return;
    const id = purgeTarget.id;
    try {
      await purge.mutateAsync(id);
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

  const selected = selectedId
    ? data?.find((m) => m.id === selectedId) ?? null
    : null;
  const selectedBusy = selected
    ? (restore.isPending && restore.variables === selected.id) ||
      (purge.isPending && purge.variables === selected.id)
    : false;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      orientation="horizontal"
      ariaLabel="휴지통"
      dismissOnEscape={!confirmOpen}
      dismissOnBackdrop={!confirmOpen}
    >
        {/* Left list */}
        <aside
          className="flex w-72 shrink-0 flex-col"
          style={{
            background: "var(--bg)",
            borderRight: "1px solid var(--line)",
          }}
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
              <>
                <Text
                  variant="caption"
                  color="muted"
                  as="span"
                  weight="normal"
                  className="ml-auto"
                >
                  {data.length}
                </Text>
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
                    color: "var(--down)",
                    border: "1px solid var(--line)",
                  }}
                >
                  비우기
                </Button>
              </>
            ) : null}
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
              <ul className="p-2">
                {data.map((m) => (
                  <DeletedMeetingItem
                    key={m.id}
                    meeting={m}
                    selected={m.id === selectedId}
                    onSelect={() => setSelectedId(m.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Right preview */}
        <section className="flex min-w-0 flex-1 flex-col">
          <header
            className="flex h-12 shrink-0 items-center justify-between gap-2 px-5"
            style={{ borderBottom: "1px solid var(--line)" }}
          >
            <Text variant="body" weight="semibold" as="h2" truncate>
              {selected
                ? stripTrashStamp(selected.title).trim() || "(제목 없음)"
                : "휴지통"}
            </Text>
            <div className="flex shrink-0 items-center gap-1">
              {selected ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleRestore(selected.id)}
                    disabled={selectedBusy}
                    title="복원"
                    aria-label="복원"
                    leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                  >
                    복원
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handlePurge(selected)}
                    disabled={selectedBusy}
                    title="영구 삭제"
                    aria-label="영구 삭제"
                    leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                    style={{ color: "var(--down)" }}
                  >
                    영구 삭제
                  </Button>
                </>
              ) : null}
              <Button
                variant="icon"
                onClick={onClose}
                aria-label="닫기"
                title="닫기  ESC"
                style={{ color: "var(--faint)" }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden">
            <TrashPreview selectedId={selectedId} />
          </div>
        </section>

      <ConfirmDialog
        open={purgeTarget !== null}
        danger
        title="영구 삭제"
        message={
          purgeTarget
            ? `"${stripTrashStamp(purgeTarget.title).trim() || "(제목 없음)"}" 을(를) 영구 삭제할까요? 되돌릴 수 없어요.`
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

function DeletedMeetingItem({
  meeting,
  selected,
  onSelect,
}: {
  meeting: Meeting;
  selected: boolean;
  onSelect: () => void;
}) {
  const displayTitle = stripTrashStamp(meeting.title).trim() || "(제목 없음)";
  return (
    <li className="list-none">
      <Button
        variant="ghost"
        onClick={onSelect}
        className="w-full flex-col items-start gap-0 px-3 py-2 text-left"
        style={{
          backgroundColor: selected ? "var(--surface-3)" : undefined,
          color: selected ? "var(--ink)" : "var(--sub)",
        }}
      >
        <Text variant="body" weight="medium" as="div" truncate className="w-full">
          {displayTitle}
        </Text>
        <Text
          variant="caption"
          color="muted"
          as="div"
          truncate
          className="mt-0.5 w-full"
        >
          {meeting.deleted_at
            ? `${formatDisplayDateTime(meeting.deleted_at)} 삭제`
            : ""}
        </Text>
      </Button>
    </li>
  );
}
