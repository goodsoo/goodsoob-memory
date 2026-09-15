import { useEffect, useRef, useState } from "react";
import {
  Calendar as CalendarIcon,
  CircleDashed,
  Check,
  Clock,
  FileText,
  Folder,
} from "lucide-react";
import type { Task, TaskPriority } from "../../api/tasks";
import { projectLabel } from "../../api/taskProjects";
import { useMeetings } from "../../hooks/useMeetings";
import { useUpdateTask } from "../../hooks/useTasks";
import { useGcalSync } from "../../hooks/useGcalSync";
import { useTaskFlash } from "../../hooks/useTaskHistory";
import {
  daysFromToday,
  formatDateShortWithDay,
  formatDisplayDate,
} from "../../lib/dates";
import { LooseDateInput } from "../common/LooseDateInput";
import { LooseTimeInput } from "../common/LooseTimeInput";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { Popover } from "../common/Popover";
import { MeetingPicker } from "../common/MeetingPicker";
import { CheckboxButton } from "./CheckboxButton";

type Props = {
  task: Task;
  onToggle: (task: Task) => void;
  onUpdate: (
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
  ) => void;
  onDelete: (task: Task) => void;
  // 전체(모든 프로젝트) 뷰에서만 true — 어느 프로젝트 task 인지 칩으로 구분.
  showProjectChip?: boolean;
};

type Draft = {
  title: string;
  due_date: string;
  due_time: string;
  source_meeting_uid: string | null;
  cancelled: boolean;
  done: boolean;
};

function draftFromTask(task: Task): Draft {
  return {
    title: task.title,
    due_date: task.due_date ?? "",
    due_time: task.due_time ?? "",
    source_meeting_uid: task.source_meeting_uid,
    cancelled: task.cancelled,
    done: task.done,
  };
}

export function TaskRow({
  task,
  onToggle,
  onUpdate,
  onDelete,
  showProjectChip = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  const flashing = useTaskFlash(task.id);
  // edit 모드 진입 시 task 의 모든 편집 가능한 값을 draft 로 복사. 사용자가
  // 모든 input 다듬는 동안 mutation 호출 X → 리스트 정렬 안 흔들림.
  // 확인 / 외부 클릭 / Enter (title) 시점에 diff 만 단일 patch 로 commit.
  const [draft, setDraft] = useState<Draft>(() => draftFromTask(task));
  // draftRef = 최신 draft. setDraft 는 React state 라 비동기 — 외부 클릭 시
  // microtask 안에서 commit 시 closure stale 위험. ref 로 동기 동기화.
  const draftRef = useRef(draft);
  const cardRef = useRef<HTMLLIElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  function updateDraft(patch: Partial<Draft>) {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
  }

  useEffect(() => {
    if (editing) {
      const fresh = draftFromTask(task);
      draftRef.current = fresh;
      setDraft(fresh);
      requestAnimationFrame(() => {
        const el = titleRef.current;
        if (!el) return;
        el.focus();
        // 커서를 텍스트 끝에 — 전체 선택 X (사용자가 끝에 이어쓰기 자연).
        const len = el.value.length;
        el.setSelectionRange(len, len);
      });
    }
    // editing false 일 때 draft 는 stale 이지만 다음 entering 시 reset 됨.
  }, [editing, task]);

  // 외부 클릭 시 commit + close. LooseDate/Time 처럼 blur 시 onCommit 하는 input
  // 의 경우 — mousedown 시점엔 아직 focus 라 onCommit 미발생. blur() 강제 호출
  // → 자식 onCommit → updateDraft → draftRef.current 동기 갱신. microtask 에서
  // commitAndClose 실행 시 최신 ref 사용.
  useEffect(() => {
    if (!editing) return;
    function onMouseDown(e: MouseEvent) {
      if (cardRef.current?.contains(e.target as Node)) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        cardRef.current?.contains(active)
      ) {
        active.blur();
      }
      queueMicrotask(commitAndClose);
    }
    function onKey(e: KeyboardEvent) {
      // ESC = 모든 변경 폐기. 자식 input (LooseDate/Time, MeetingPicker 등) 의
      // 자체 ESC handler 가 먼저 자기 input revert 후 bubble → 여기서 cancelEdit.
      if (e.key === "Escape") cancelEdit();
      // Enter = commit (어떤 input focus 든). LooseDate/Time 의 Enter handler 는
      // 자체 blur → onCommit → updateDraft 동기 갱신 → 우리 listener 가 catch.
      if (e.key === "Enter") {
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          cardRef.current?.contains(active)
        ) {
          active.blur();
        }
        queueMicrotask(commitAndClose);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // 카드 unmount 직전 짧은 fade-out 으로 "사라짐" cue. 그 후 실제 mutation.
  // delete + cancel 신규 시 (view 에서 사라지는 경우) 만 적용.
  function fadeOutThen(fn: () => void) {
    if (cardRef.current) {
      cardRef.current.style.animation = "taskCardExit 180ms ease forwards";
      setTimeout(fn, 180);
    } else {
      fn();
    }
  }

  function commitAndClose() {
    const d = draftRef.current;
    const patch: Parameters<typeof onUpdate>[1] = {};
    const titleTrimmed = d.title.trim();
    if (titleTrimmed && titleTrimmed !== task.title) {
      patch.title = titleTrimmed;
    }
    const nextDate = d.due_date || null;
    if (nextDate !== task.due_date) patch.due_date = nextDate;
    const nextTime = d.due_time || null;
    if (nextTime !== task.due_time) patch.due_time = nextTime;
    if (d.source_meeting_uid !== task.source_meeting_uid)
      patch.source_meeting_uid = d.source_meeting_uid;
    if (d.cancelled !== task.cancelled) patch.cancelled = d.cancelled;
    if (d.done !== task.done) patch.done = d.done;
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    // cancelled / deleted 신규 true = view 에서 사라짐. fadeOut.
    const willDisappear =
      (patch.cancelled === true && !task.cancelled) ||
      (patch.deleted === true && !task.deleted);
    if (willDisappear) {
      fadeOutThen(() => {
        onUpdate(task, patch);
        setEditing(false);
      });
    } else {
      onUpdate(task, patch);
      setEditing(false);
    }
  }

  function cancelEdit() {
    setEditing(false);
  }

  function handleDeleteWithFade() {
    fadeOutThen(() => onDelete(task));
  }


  return (
    <li
      ref={cardRef}
      data-todoid={task.id}
      onClick={() => {
        if (!editing) setEditing(true);
      }}
      className={`rounded-lg border transition ${editing ? "" : "cursor-pointer hover:bg-[var(--surface)]"} ${flashing ? "task-card-flash" : "task-card-enter"}`}
      style={{
        borderColor: editing ? "var(--line)" : "var(--line-2)",
        backgroundColor: editing ? "var(--surface)" : undefined,
      }}
    >
      {editing ? (
        <div className="px-3 py-2.5">
          {/* 윗줄: 체크박스 + 제목 input (전체 너비) */}
          <div className="flex items-center gap-3">
            <CheckboxButton
              status={
                draft.cancelled ? "cancelled" : draft.done ? "done" : "pending"
              }
              onClick={() => {
                if (draft.cancelled) {
                  updateDraft({ cancelled: false });
                } else {
                  updateDraft({ done: !draft.done });
                }
              }}
            />
            <input
              ref={titleRef}
              value={draft.title}
              onChange={(e) => updateDraft({ title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  commitAndClose();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  cancelEdit();
                }
              }}
              onClick={(e) => e.stopPropagation()}
              placeholder="제목"
              maxLength={200}
              className="min-w-0 flex-1 bg-transparent text-base outline-none"
              style={{ color: "var(--ink)" }}
            />
          </div>

          {/* 아랫줄: 좌측 메타 cluster + 우측 액션 cluster. 체크박스 (h-5 + gap-3) 만큼 들여쓰기. */}
          <div
            className="mt-2 flex items-center justify-between gap-2 pl-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs"
              style={{ color: "var(--sub)" }}
            >
              <span className="inline-flex shrink-0 items-center gap-1">
                <CalendarIcon className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
                <LooseDateInput
                  value={draft.due_date}
                  onCommit={(next) => updateDraft({ due_date: next })}
                  compact
                />
              </span>
              <span className="inline-flex shrink-0 items-center gap-1">
                <Clock className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
                <LooseTimeInput
                  value={draft.due_time}
                  onCommit={(next) => updateDraft({ due_time: next })}
                  compact
                />
              </span>
              <MeetingPicker
                value={draft.source_meeting_uid}
                onChange={(uid) => updateDraft({ source_meeting_uid: uid })}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  updateDraft({
                    cancelled: !draft.cancelled,
                    // cancelled 면서 done 일 수 없음 — 둘 다 final state.
                    ...(!draft.cancelled && draft.done ? { done: false } : {}),
                  })
                }
                title={draft.cancelled ? "취소 해제" : "할 일 취소"}
                style={{
                  color: draft.cancelled
                    ? "var(--ink)"
                    : "var(--sub)",
                  border: `1px solid ${draft.cancelled ? "var(--faint)" : "var(--line-2)"}`,
                }}
              >
                {draft.cancelled ? "✗ 취소됨" : "취소"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteWithFade}
                title="할 일 삭제"
                style={{
                  color: "var(--sub)",
                  border: "1px solid var(--line-2)",
                }}
              >
                삭제
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={commitAndClose}
                title="완료 (변경 저장)"
                leftIcon={<Check className="h-3 w-3" />}
              >
                완료
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-3 py-2.5">
          <CheckboxButton
            status={
              task.cancelled ? "cancelled" : task.done ? "done" : "pending"
            }
            onClick={() => onToggle(task)}
          />
          <div className="min-w-0 flex-1">
            <Text
              variant="h4"
              weight="normal"
              as="div"
              className={`min-w-0 break-words ${task.done || task.cancelled ? "line-through" : ""}`}
              style={{
                color:
                  task.done || task.cancelled
                    ? "var(--faint)"
                    : "var(--ink)",
              }}
            >
              {task.title || (
                <Text variant="body" color="muted" as="span">
                  (제목 없음)
                </Text>
              )}
            </Text>
            <ReadOnlyMeta task={task} showProjectChip={showProjectChip} />
          </div>
          {/* 일정 → Google 캘린더 push / 동기화 상태. DueChip 앞. */}
          <GcalAction task={task} />
          {/* DueChip — 카드 우측 끝. items-center 라 vertical 가운데 align. */}
          <DueChip task={task} />
        </div>
      )}
    </li>
  );
}

// Google 캘린더 동기화 상태 표시 — 예외만. 자동 동기화라 "동기화됨"은 모든 dated
// task 의 기본값이라 표시하면 노이즈만 됨 → 무표시. 대신 예외인 "대기"(날짜 있는데
// 아직 캘린더에 안 올라간 활성 task)만 신호한다. 연동 안 됐으면 아무것도 안 띄움
// (동기화가 안 도니 "대기"가 무의미). 전체 동기화 상태는 헤더의 SyncStatusChip 담당.
function GcalAction({ task }: { task: Task }) {
  const { connected } = useGcalSync();
  if (!connected) return null;
  if (task.gcal_event_id) return null; // 이미 동기화됨 = 기본값 → 무표시
  if (task.done || task.cancelled || task.deleted) return null;
  if (!task.due_date) return null; // 날짜 없으면 캘린더 대상 아님 → 무표시
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center"
      title="다음 동기화 때 캘린더에 올라갑니다"
      aria-label="동기화 대기"
    >
      <CircleDashed className="h-3.5 w-3.5" style={{ color: "var(--faint)" }} />
    </span>
  );
}

// 제목 앞 chip — 오늘 / 임박 (내일~3일) / 기한 지남 (D+N). 4일 이상 미래는
// chip 없음 (메타 row 의 날짜로 충분). done / cancelled 도 X.
// 체크박스 가 카테고리 색 tint 를 들고 있어 chip 까지 bg 색이면 layer 충돌
// → bg 제거, outline + text 색만. 시그널 (오늘/지남) 은 색 그대로 유지.
function DueChip({ task }: { task: Task }) {
  if (task.done || task.cancelled || !task.due_date) return null;
  const diff = daysFromToday(task.due_date);
  const base = "shrink-0 rounded px-1.5 py-0.5 text-3xs font-medium";
  if (diff === 0) {
    // "오늘 = 마감 D-day" → 지남과 같은 빨강 시그널. 색 가짓수 줄임.
    // 위계: 오늘 = filled bold (액션 강조), 지남 = outline (정보).
    return (
      <span
        className="shrink-0 rounded px-1.5 py-0.5 text-3xs font-bold"
        style={{
          backgroundColor: "var(--down)",
          color: "var(--text-inverse)",
        }}
      >
        오늘
      </span>
    );
  }
  if (diff < 0) {
    return (
      <span
        className={base}
        style={{
          color: "var(--down-ink)",
          border: "1px solid var(--down)",
        }}
      >
        D+{-diff}
      </span>
    );
  }
  if (diff >= 1 && diff <= 3) {
    return (
      <span
        className={base}
        style={{
          color: "var(--sub)",
          border: "1px solid var(--line)",
        }}
      >
        {diff === 1 ? "내일" : `D-${diff}`}
      </span>
    );
  }
  return null;
}

// read-only: 값이 있는 메타만 chip 으로 표시. 모두 비어있으면 아무것도 렌더 X.
function ReadOnlyMeta({
  task,
  showProjectChip,
}: {
  task: Task;
  showProjectChip: boolean;
}) {
  const hasDate = !!task.due_date;
  const hasTime = !!task.due_time;
  const hasSource = !!task.source_meeting_uid;
  if (!hasDate && !hasTime && !showProjectChip && !hasSource) return null;
  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
      style={{ color: "var(--sub)" }}
    >
      {hasDate ? <span>{formatDisplayDate(task.due_date)}</span> : null}
      {hasTime ? <span>{task.due_time}</span> : null}
      {showProjectChip ? (
        <span className="inline-flex items-center gap-0.5">
          <Folder className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
          {projectLabel(task._source.file)}
        </span>
      ) : null}
      {hasSource ? (
        <SourceMeetingLink uid={task.source_meeting_uid!} todoId={task.id} />
      ) : null}
    </div>
  );
}

// 메모 chip 을 클릭하면 confirm popover. "이동" 누르면 navigate, 외부 클릭/ESC 닫음.
// 실수로 카드 클릭 → 다른 화면 이동하는 거 차단.
// vault 에서 메모 사라진 경우 — "연결 끊김" 표시 + 이동 button 비활성. md 의
// #from-<uid> tag 는 그대로 두고 (자동 정리 X) 사용자가 직접 편집.
function SourceMeetingLink({ uid, todoId }: { uid: string; todoId: string }) {
  const [open, setOpen] = useState(false);
  const meetingsQ = useMeetings();
  const updateMutation = useUpdateTask();
  const meeting = meetingsQ.data?.find((m) => m.uid === uid) ?? null;
  // list 가 fetched (isSuccess) 인데도 없으면 진짜 사라진 메모.
  const disconnected = meetingsQ.isSuccess && !meeting;

  function disconnect() {
    updateMutation.mutate({
      id: todoId,
      patch: { source_meeting_uid: null },
    });
    setOpen(false);
  }

  const chipLabel = disconnected
    ? "(연결 끊김)"
    : meeting?.title?.trim() || "원본 메모";

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      className="relative inline-flex"
      panelClassName="absolute left-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-md shadow-md"
      panelStyle={{
        backgroundColor: "var(--bg)",
        border: "1px solid var(--line)",
      }}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className={`max-w-[12rem] truncate underline-offset-2 px-0 py-0 ${disconnected ? "" : "hover:underline"}`}
          style={{ color: "var(--sub)" }}
          aria-haspopup="menu"
          aria-expanded={open}
          leftIcon={<FileText className="h-3 w-3 shrink-0 opacity-70" aria-hidden />}
        >
          <span className="truncate">{chipLabel}</span>
        </Button>
      }
    >
      <div onClick={(e) => e.stopPropagation()}>
          <Text
            variant="caption"
            color="secondary"
            as="div"
            className="px-3 py-2"
            style={{ borderBottom: "1px solid var(--line-2)" }}
          >
            <Text variant="caption" color="muted" as="div">
              연결된 메모
            </Text>
            {disconnected ? (
              <Text
                variant="caption"
                color="muted"
                as="div"
                className="mt-0.5 text-2xs"
              >
                메모를 찾을 수 없어요. (md 안 연결 id 는 그대로 보존)
              </Text>
            ) : (
              <>
                <Text
                  variant="body"
                  weight="medium"
                  as="div"
                  truncate
                  className="mt-0.5"
                >
                  {meeting?.title?.trim() || "(제목 없음)"}
                </Text>
                {meeting?.date || meeting?.time || meeting?.attendees?.length ? (
                  <Text
                    variant="caption"
                    color="muted"
                    as="div"
                    truncate
                    className="mt-1 text-2xs"
                  >
                    {meeting.date ? formatDateShortWithDay(meeting.date) : null}
                    {meeting.time ? ` · ${meeting.time}` : null}
                    {meeting.attendees && meeting.attendees.length > 0
                      ? ` · ${meeting.attendees.join(", ")}`
                      : null}
                  </Text>
                ) : null}
              </>
            )}
          </Text>
          <div className="flex justify-end gap-2 px-3 py-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOpen(false)}
              className="px-3 py-1.5"
            >
              취소
            </Button>
            <Button
              variant={disconnected ? "secondary" : "info"}
              size="sm"
              onClick={() => {
                if (disconnected) {
                  disconnect();
                  return;
                }
                setOpen(false);
                window.location.hash = `#meeting-${uid}`;
              }}
              className="px-3 py-1.5"
              style={
                disconnected
                  ? {
                      backgroundColor: "transparent",
                      color: "var(--down)",
                      border: "1px solid var(--down)",
                    }
                  : undefined
              }
            >
              {disconnected ? "연결 해제" : "메모로 이동"}
            </Button>
          </div>
      </div>
    </Popover>
  );
}
