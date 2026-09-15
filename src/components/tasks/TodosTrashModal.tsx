import { useEffect, useMemo, useState } from "react";
import { CheckSquare, Repeat, RotateCcw, Trash2, X } from "lucide-react";
import {
  useDeleteTask,
  useTasks,
  useUpdateTask,
} from "../../hooks/useTasks";
import {
  useEmptyRoutineTrash,
  usePurgeRoutine,
  useRestoreRoutine,
  useTrashedRoutines,
} from "../../hooks/useRoutines";
import { formatDisplayDate } from "../../lib/dates";
import type { Task } from "../../api/tasks";
import type { TrashedRoutine } from "../../api/routines";
import { formatError } from "../../lib/errors";
import { ConfirmDialog } from "../ConfirmDialog";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { Chip } from "../common/Chip";

type Props = {
  open: boolean;
  onClose: () => void;
};

// 할 일 탭 휴지통 — 태스크 + 루틴 한 리스트, chip (태스크 / 루틴) 으로 구분. 데이터
// 모델은 다르지만 (태스크 = `deleted` flag in inbox.md, 루틴 = `routines/.trash/` 폴더)
// 사용자 시점에선 휴지통 액션은 "되돌리기 / 삭제" 둘 뿐이라 섹션 분리 불필요.
// 탭별 1 trash 원칙 유지. Modal size lg = 포트폴리오와 통일.
type Entry =
  | { kind: "task"; key: string; task: Task }
  | { kind: "routine"; key: string; routine: TrashedRoutine };

export function TodosTrashModal({ open, onClose }: Props) {
  const { data: todoData } = useTasks();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const deletedTasks = useMemo(
    () => (todoData ?? []).filter((t) => t.deleted),
    [todoData],
  );

  const { data: trashedRoutines } = useTrashedRoutines();
  const restoreRoutine = useRestoreRoutine();
  const purgeRoutineMutation = usePurgeRoutine();
  const emptyRoutineTrash = useEmptyRoutineTrash();

  // 루틴은 deletedAt 으로 정렬되어 있고, task 는 timestamp 없음 — 단순 concat
  // (task 먼저, 루틴은 시간 desc). 사용자가 액션 외 정렬에 큰 의존 없다고 명시.
  const entries = useMemo<Entry[]>(
    () => [
      ...deletedTasks.map<Entry>((t) => ({
        kind: "task",
        key: `task:${t.id}`,
        task: t,
      })),
      ...(trashedRoutines ?? []).map<Entry>((r) => ({
        kind: "routine",
        key: `routine:${r.trashPath}`,
        routine: r,
      })),
    ],
    [deletedTasks, trashedRoutines],
  );

  const [purgeTaskTarget, setPurgeTaskTarget] = useState<Task | null>(null);
  const [purgeRoutineTarget, setPurgeRoutineTarget] =
    useState<TrashedRoutine | null>(null);
  const [emptyAllConfirm, setEmptyAllConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmOpen =
    purgeTaskTarget !== null ||
    purgeRoutineTarget !== null ||
    emptyAllConfirm;

  useEffect(() => {
    if (!open) {
      setPurgeTaskTarget(null);
      setPurgeRoutineTarget(null);
      setEmptyAllConfirm(false);
      setError(null);
    }
  }, [open]);

  function handlePurgeTask() {
    if (!purgeTaskTarget) return;
    deleteTask.mutate(purgeTaskTarget.id);
    setPurgeTaskTarget(null);
  }

  async function handleRestoreRoutine(trashPath: string) {
    setError(null);
    try {
      await restoreRoutine.mutateAsync(trashPath);
    } catch (e) {
      setError(formatError(e));
    }
  }

  async function handlePurgeRoutine() {
    if (!purgeRoutineTarget) return;
    try {
      await purgeRoutineMutation.mutateAsync(purgeRoutineTarget.trashPath);
      setPurgeRoutineTarget(null);
    } catch (e) {
      setError(formatError(e));
      setPurgeRoutineTarget(null);
    }
  }

  async function handleEmptyAll() {
    // 두 도메인 동시 비우기. 한쪽 실패해도 다른쪽 진행.
    for (const t of deletedTasks) deleteTask.mutate(t.id);
    try {
      await emptyRoutineTrash.mutateAsync();
    } catch (e) {
      setError(formatError(e));
    }
    setEmptyAllConfirm(false);
  }

  const totalCount = entries.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      ariaLabelledBy="trash-title"
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
          <h2 id="trash-title">휴지통</h2>
          {totalCount > 0 ? (
            <Text variant="caption" color="muted" as="span" weight="normal">
              {totalCount}
            </Text>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            {totalCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setError(null);
                  setEmptyAllConfirm(true);
                }}
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

        <div className="min-h-0 flex-1 overflow-y-auto">
          {totalCount === 0 ? (
            <Text
              variant="body"
              color="muted"
              as="div"
              className="px-4 py-12 text-center"
            >
              휴지통이 비어 있어요
            </Text>
          ) : (
            <ul className="flex flex-col gap-1.5 p-3">
              {entries.map((entry) =>
                entry.kind === "task" ? (
                  <TaskRow
                    key={entry.key}
                    task={entry.task}
                    onRestore={() =>
                      updateTask.mutate({
                        id: entry.task.id,
                        patch: { deleted: false },
                      })
                    }
                    onPurge={() => setPurgeTaskTarget(entry.task)}
                  />
                ) : (
                  <RoutineRow
                    key={entry.key}
                    trashed={entry.routine}
                    onRestore={() => handleRestoreRoutine(entry.routine.trashPath)}
                    onPurge={() => setPurgeRoutineTarget(entry.routine)}
                    busy={
                      (restoreRoutine.isPending &&
                        restoreRoutine.variables === entry.routine.trashPath) ||
                      (purgeRoutineMutation.isPending &&
                        purgeRoutineMutation.variables ===
                          entry.routine.trashPath)
                    }
                  />
                ),
              )}
            </ul>
          )}
        </div>
      </aside>

      <ConfirmDialog
        open={purgeTaskTarget !== null}
        title="영구 삭제"
        message={
          purgeTaskTarget
            ? `"${purgeTaskTarget.title.trim() || "(제목 없음)"}" 을(를) 영구 삭제할까요? 되돌릴 수 없어요.`
            : ""
        }
        confirmLabel="영구 삭제"
        danger
        onConfirm={handlePurgeTask}
        onCancel={() => setPurgeTaskTarget(null)}
      />
      <ConfirmDialog
        open={purgeRoutineTarget !== null}
        title="영구 삭제"
        message={
          purgeRoutineTarget
            ? `"${purgeRoutineTarget.name}" 루틴을 영구 삭제할까요? 체크 이력도 함께 사라집니다.`
            : ""
        }
        confirmLabel="영구 삭제"
        busy={purgeRoutineMutation.isPending}
        danger
        onConfirm={handlePurgeRoutine}
        onCancel={() => setPurgeRoutineTarget(null)}
      />
      <ConfirmDialog
        open={emptyAllConfirm}
        title="휴지통 비우기"
        message={`${totalCount}개 항목을 모두 영구 삭제할까요? 되돌릴 수 없어요.`}
        confirmLabel="비우기"
        busy={emptyRoutineTrash.isPending}
        danger
        onConfirm={handleEmptyAll}
        onCancel={() => setEmptyAllConfirm(false)}
      />
    </Modal>
  );
}

function TaskRow({
  task,
  onRestore,
  onPurge,
}: {
  task: Task;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <li
      className="flex items-center gap-3 rounded-md px-3 py-2"
      style={{
        backgroundColor: "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      <TypeIcon kind="task" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <Chip size="sm">할 일</Chip>
          <Text
            variant="body"
            as="span"
            truncate
            className="min-w-0 flex-1"
            title={task.title}
          >
            {task.title || (
              <Text variant="body" color="muted" as="span">
                (제목 없음)
              </Text>
            )}
          </Text>
        </div>
        <TaskMeta task={task} />
      </div>
      <RowActions onRestore={onRestore} onPurge={onPurge} />
    </li>
  );
}

function RoutineRow({
  trashed,
  onRestore,
  onPurge,
  busy,
}: {
  trashed: TrashedRoutine;
  onRestore: () => void;
  onPurge: () => void;
  busy: boolean;
}) {
  const { name, frontmatter, log } = trashed;
  const time = frontmatter.time;
  const started = frontmatter.started;
  const ends = frontmatter.ends;
  return (
    <li
      className="flex items-center gap-3 rounded-md px-3 py-2"
      style={{
        backgroundColor: "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      <TypeIcon kind="routine" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <Chip size="sm">루틴</Chip>
          <Text
            variant="body"
            as="span"
            truncate
            className="min-w-0 flex-1"
            title={name}
          >
            {name}
          </Text>
        </div>
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs"
          style={{ color: "var(--faint)" }}
        >
          {time ? <span>{time}</span> : null}
          <span>
            {started}
            {ends ? ` ~ ${ends}` : " ~ 계속"}
          </span>
          <span>체크 {log.size}회</span>
        </div>
      </div>
      <RowActions onRestore={onRestore} onPurge={onPurge} disabled={busy} />
    </li>
  );
}

function TypeIcon({ kind }: { kind: "task" | "routine" }) {
  const Icon = kind === "task" ? CheckSquare : Repeat;
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
      style={{
        backgroundColor: "var(--surface-2)",
        border: "1px solid var(--line-2)",
      }}
    >
      <Icon
        className="h-4 w-4"
        strokeWidth={1.5}
        style={{ color: "var(--faint)" }}
      />
    </div>
  );
}

function RowActions({
  onRestore,
  onPurge,
  disabled,
}: {
  onRestore: () => void;
  onPurge: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant="icon"
        onClick={onRestore}
        disabled={disabled}
        title="복원"
        aria-label="복원"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="icon"
        onClick={onPurge}
        disabled={disabled}
        title="영구 삭제"
        aria-label="영구 삭제"
        style={{ color: "var(--down)" }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function TaskMeta({
  task,
}: {
  task: { due_date: string | null; due_time: string | null };
}) {
  const hasDate = !!task.due_date;
  const hasTime = !!task.due_time;
  if (!hasDate && !hasTime) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs"
      style={{ color: "var(--faint)" }}
    >
      {hasDate ? <span>{formatDisplayDate(task.due_date)}</span> : null}
      {hasTime ? <span>{task.due_time}</span> : null}
    </div>
  );
}
