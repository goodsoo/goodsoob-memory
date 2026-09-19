import { useEffect, useMemo } from "react";
import { Undo2, Redo2, AlertCircle } from "lucide-react";
import {
  useDeleteTask,
  useTasks,
  useUpdateTask,
} from "../hooks/useTasks";
import {
  recordTaskUpdate,
  useTaskUndo,
  useTaskUndoShortcut,
} from "../hooks/useTaskHistory";
import {
  type Task,
  type TaskPriority,
} from "../api/tasks";
import { compareTaskDate } from "../lib/taskSort";
import { TaskRow } from "../components/tasks/TaskRow";
import { PageHeaderBar } from "../components/common/PageHeaderBar";
import { Button } from "../components/common/Button";
import { Text } from "../components/common/Text";
import { EmptyState } from "../components/common/EmptyState";
import type { TaskStatusFilter } from "../components/nav/SidePanel";
import { type TaskSortKey } from "../hooks/useTaskSort";
import { TaskSortMenu } from "../components/tasks/TaskSortMenu";

type Props = {
  statusFilter?: TaskStatusFilter;
  // 선택된 프로젝트 파일(`tasks/{이름}.md`). null = 전체(모든 프로젝트 가로질러).
  projectFilter?: string | null;
  sortKey?: TaskSortKey;
  onSortKeyChange?: (next: TaskSortKey) => void;
  // 캘린더 사이드바 task 클릭으로 진입 시 해당 row 로 scroll. 한 번 처리 후 clear.
  scrollToTaskId?: string | null;
  onScrollHandled?: () => void;
};

export function TasksPage({
  statusFilter = "all",
  projectFilter = null,
  sortKey = "date_asc",
  onSortKeyChange,
  scrollToTaskId = null,
  onScrollHandled,
}: Props) {
  const { data, isLoading, error, refetch } = useTasks();
  const updateMutation = useUpdateTask();
  const deleteMutation = useDeleteTask();

  const { canUndo, canRedo, undo, redo } = useTaskUndo();

  useTaskUndoShortcut({ active: true });

  // 두 필터 AND + sortKey 적용한 단일 list. done task 도 inline (체크 + line-through).
  const tasks = useMemo(() => {
    const all = data ?? [];
    // deleted 는 항상 list 에서 제외 (휴지통 modal 에서만 보임). cancelled 는
    // 별도 view — cancelled view 에선 카테고리 필터 무시.
    let filtered = all.filter((t) => !t.deleted);
    // 프로젝트 필터 — 선택된 프로젝트 파일이면 그 파일 task 만. null = 전체.
    if (projectFilter) {
      filtered = filtered.filter((t) => t._source.file === projectFilter);
    }
    if (statusFilter === "cancelled") {
      filtered = filtered.filter((t) => t.cancelled);
    } else {
      filtered = filtered.filter((t) => !t.cancelled);
      if (statusFilter === "pending")
        filtered = filtered.filter((t) => !t.done);
      else if (statusFilter === "done")
        filtered = filtered.filter((t) => t.done);
    }
    const copy = filtered.slice();
    // 정렬은 compareTaskDate (due_date+due_time, null first, 라인 tie-break) 공유 —
    // "오늘" 탭 할일 블록과 동일 순서. (taskSort.ts)
    if (sortKey === "name") {
      copy.sort((a, b) => a.title.localeCompare(b.title, "ko"));
    } else if (sortKey === "date_asc") {
      copy.sort((a, b) => compareTaskDate(a, b, true));
    } else if (sortKey === "date_asc_undone") {
      // 미완료 먼저 → 그 안에서 오래된순. 끝낸 일은 아래로 내려보냄.
      copy.sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return compareTaskDate(a, b, true);
      });
    } else {
      copy.sort((a, b) => compareTaskDate(a, b, false));
    }
    return copy;
  }, [data, statusFilter, projectFilter, sortKey]);

  // 캘린더 사이드바에서 태스크 클릭 → 할 일 탭 진입 시 해당 row 로 부드럽게 scroll 후
  // 편집모드 자동 진입 (el.click() 이 TaskRow li 의 onClick → setEditing(true) 트리거).
  // list 렌더 완료 후 (tasks / scrollToTaskId 모두 valid) 한 번만 실행 → onScrollHandled
  // 로 부모 state 정리. tasks.length 의존: filter reset 후 list 가 도착해야 element 가 mount 됨.
  useEffect(() => {
    if (!scrollToTaskId || tasks.length === 0) return;
    const el = document.querySelector<HTMLElement>(
      `[data-todoid="${CSS.escape(scrollToTaskId)}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.click();
    }
    onScrollHandled?.();
  }, [scrollToTaskId, tasks, onScrollHandled]);

  function handleToggle(task: Task) {
    // cancelled task 의 체크박스 클릭 = 취소 해제 (pending 복원).
    if (task.cancelled) {
      recordTaskUpdate(task, { cancelled: false });
      updateMutation.mutate({ id: task.id, patch: { cancelled: false } });
      return;
    }
    const nextDone = !task.done;
    recordTaskUpdate(task, { done: nextDone });
    updateMutation.mutate({
      id: task.id,
      patch: {
        done: nextDone,
        done_at: nextDone ? new Date().toISOString() : null,
      },
    });
  }

  function handleUpdate(
    task: Task,
    patch: {
      title?: string;
      priority?: TaskPriority;
      due_date?: string | null;
      due_time?: string | null;
      source_meeting_uid?: string | null;
      done?: boolean;
      cancelled?: boolean;
      deleted?: boolean;
    },
  ) {
    recordTaskUpdate(task, patch);
    updateMutation.mutate({ id: task.id, patch });
  }

  function handleDelete(task: Task) {
    // soft-delete: vault 라인은 `- [D]` 로 변경 (영구 삭제 X). 휴지통 view 에서
    // 복원 / 영구 삭제 가능. 이미 삭제됨 이면 영구 삭제 (vault 라인 제거).
    if (task.deleted) {
      deleteMutation.mutate(task.id);
      return;
    }
    recordTaskUpdate(task, { deleted: true });
    updateMutation.mutate({ id: task.id, patch: { deleted: true } });
  }

  return (
    <div className="flex h-[calc(100svh-var(--app-header-h)-72px)] flex-col lg:h-full lg:min-h-0">
      <div className="shrink-0">
      <PageHeaderBar
        sticky={false}
        left={
          <div
            className="inline-flex overflow-hidden rounded-md"
            style={{ border: "1px solid var(--line-2)" }}
          >
            <Button
              variant="ghost"
              onClick={undo}
              disabled={!canUndo}
              title="실행 취소 (⌘Z)"
              className="rounded-none px-1.5 py-1 disabled:opacity-20"
              style={{ color: "var(--sub)" }}
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              onClick={redo}
              disabled={!canRedo}
              title="다시 실행 (⌘⇧Z)"
              className="rounded-none px-1.5 py-1 disabled:opacity-20"
              style={{
                color: "var(--sub)",
                borderLeft: "1px solid var(--line-2)",
              }}
            >
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
        center={
          <Text variant="h4" as="h2" className="text-center">
            할 일
          </Text>
        }
      />
      {onSortKeyChange ? (
        <TasksToolbar sortKey={sortKey} onSortKeyChange={onSortKeyChange} />
      ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-5 pb-16 pt-5 lg:max-w-4xl">
      {error ? (
        <EmptyState
          icon={
            <AlertCircle
              className="h-12 w-12"
              style={{ color: "var(--down)" }}
              strokeWidth={1.25}
            />
          }
          title="목록을 불러오지 못했습니다"
          description={
            <>
              <Text variant="body" color="secondary" as="p">
                잠시 후 다시 시도하세요.
              </Text>
              <Text variant="caption" color="muted" as="p" className="mt-1 font-mono">
                {(error as Error).message}
              </Text>
            </>
          }
          action={
            <Button variant="primary" onClick={() => void refetch()}>
              다시 시도
            </Button>
          }
        />
      ) : isLoading ? (
        <SkeletonList />
      ) : tasks.length === 0 ? (
        <TasksEmptyState />
      ) : (
        <ul
          key={`${statusFilter}-${projectFilter ?? "all"}-${sortKey}`}
          className="mt-2 space-y-2"
        >
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              onToggle={handleToggle}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              // 전체 뷰에서만 프로젝트(파일) 칩 — 특정 프로젝트 선택 시엔 자명해 생략.
              showProjectChip={projectFilter === null}
            />
          ))}
        </ul>
      )}
      </div>
      </div>
    </div>
  );
}

// 페이지 헤더 아래 sub-header — 정렬 메뉴만. (카테고리 축은 모델 분리로 폐기,
// 프로젝트 선택은 사이드바가 담당.)
function TasksToolbar({
  sortKey,
  onSortKeyChange,
}: {
  sortKey: TaskSortKey;
  onSortKeyChange: (next: TaskSortKey) => void;
}) {
  return (
    <div
      className="shrink-0 px-6 py-2 backdrop-blur"
      style={{
        borderBottom: "1px solid var(--line-2)",
        backgroundColor: "var(--bg-overlay)",
      }}
    >
      <div className="flex flex-wrap items-center gap-1">
        <div className="ml-auto">
          <TaskSortMenu value={sortKey} onChange={onSortKeyChange} />
        </div>
      </div>
    </div>
  );
}

function SkeletonList() {
  return (
    <ul className="mt-4 space-y-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="h-12 animate-pulse rounded-lg"
          style={{ backgroundColor: "var(--surface)" }}
        />
      ))}
    </ul>
  );
}

function TasksEmptyState() {
  return (
    <EmptyState
      title="할 일이 비어있어요"
      description="오늘 가장 먼저 끝낼 한 가지를 적어보세요."
    />
  );
}
