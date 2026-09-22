import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Calendar as CalendarIcon,
  CalendarDays,
  CheckSquare,
  FileText,
  Plus,
  BookOpen,
  CornerUpLeft,
} from "lucide-react";
import { Button } from "../components/common/Button";
import { Text } from "../components/common/Text";
import { PageHeaderBar } from "../components/common/PageHeaderBar";
import { SaveIndicator } from "../components/common/SaveIndicator";
import { CheckboxButton } from "../components/tasks/CheckboxButton";
import { LooseDateInput } from "../components/common/LooseDateInput";
import { DayEvents } from "../components/today/DayEvents";
import { JournalEditor } from "../components/calendar/JournalEditor";
import type { SaveStatus } from "../hooks/useDebouncedSave";
import { eventsOnDay, tasksDueOn, notesOnDay } from "../components/today/dayView";
import { compareTaskDate } from "../lib/taskSort";
import { useMeetings } from "../hooks/useMeetings";
import { useTasks, useUpdateTask, useCreateTask } from "../hooks/useTasks";
import { useSchedule } from "../hooks/useSchedule";
import type { Task } from "../api/tasks";
import {
  todayIso,
  formatDateLong,
  formatDisplayDate,
  relativeDateLabel,
  isPast,
} from "../lib/dates";

type Props = {
  // 메인창이 보여줄 날짜 (기본 = 오늘). 사이드바에서 날짜 선택 시 App 이 갱신.
  selectedDay: string;
  // "오늘로" 복귀 — selectedDay 를 오늘로.
  onReturnToday: () => void;
  onOpenMeeting: (uid: string) => void;
  onOpenTask: (id: string) => void;
  // 새 노트 생성 + 자동 선택. App 이 root 폴더에 만들고 메모장 탭으로 이동.
  onCreateNote: () => void;
};

// "이어서 쓸 노트" 표시 개수 (오늘 모드 전용).
const RECENT_NOTES = 5;
// 오늘 모드 할일 노출 개수 — 할일 탭과 같은 순서로 상위 N.
const TODO_LIMIT = 10;

// "오늘" 탭 메인창 — selectedDay 기준 day-view. 제목(헤더)이 곧 그 날짜이고(오늘이면
// "오늘"), 본문은 할일|일정 / 노트|일기 2열. 오늘이면 라이브 대시보드, 다른 날이면
// 그 날에 묶인 것만(그날 일정·그날 마감 할일·그날 노트·그날 일기). 루틴은 #routines 탭 전담.
export function TodayPage({
  selectedDay,
  onReturnToday,
  onOpenMeeting,
  onOpenTask,
  onCreateNote,
}: Props) {
  const today = todayIso();
  const day = selectedDay;
  const isTodayView = day === today;

  const meetingsQ = useMeetings();
  const tasksQ = useTasks();
  const scheduleQ = useSchedule();
  const updateTask = useUpdateTask();
  const createTask = useCreateTask();
  const [quickTask, setQuickTask] = useState("");
  // 일기 저장 상태 — 인라인 에디터가 올려줌. 표시는 일기 섹션 타이틀 옆.
  const [journalStatus, setJournalStatus] = useState<SaveStatus>("idle");
  // 빠른 추가 시 미리 적는 마감일. 오늘 뷰면 비움(날짜 없는 할 일, 클릭 시 오늘로 시드),
  // 다른 날 뷰면 그 날짜로 미리 채움.
  const defaultQuickDate = isTodayView ? "" : day;
  const [quickDate, setQuickDate] = useState(defaultQuickDate);

  // 보고 있는 날짜가 바뀌면 빠른 추가 마감일도 기본값으로 리셋.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuickDate(defaultQuickDate);
  }, [defaultQuickDate]);

  // 그 날 일정 (count 용 — 본문은 DayEvents 가 추가/편집까지 렌더).
  const dayEvents = useMemo(
    () => eventsOnDay(scheduleQ.data ?? [], day),
    [scheduleQ.data, day],
  );

  // 할 일 — 오늘 모드: 오늘 날짜와 무관하게 할일 탭과 같은 순서(compareTaskDate date_asc)
  // 로 미완료(미삭제·미취소·미완료) 전체. 완료는 숨김. 다른 날: 그 날 마감만.
  // 카운트는 이 전체 길이를 쓰고, 리스트는 아래 visibleTasks 로 상위 TODO_LIMIT 개만 노출.
  const tasks = useMemo<Task[]>(() => {
    const all = tasksQ.data ?? [];
    if (!isTodayView) return tasksDueOn(all, day);
    return all
      .filter((t) => !t.deleted && !t.cancelled && !t.done)
      .sort((a, b) => compareTaskDate(a, b, true));
  }, [tasksQ.data, day, isTodayView]);

  // 실제 렌더하는 건 상위 TODO_LIMIT 개까지만 — 카운트(tasks.length)는 전체 남은 개수.
  const visibleTasks = useMemo(
    () => tasks.slice(0, TODO_LIMIT),
    [tasks],
  );

  // 노트 — 오늘 모드: 이어서 쓸 노트(최근 수정 N). 다른 날: 그 날 노트.
  const notes = useMemo(() => {
    const all = meetingsQ.data ?? [];
    if (!isTodayView) return notesOnDay(all, day);
    return [...all].sort((a, b) => b.mtime - a.mtime).slice(0, RECENT_NOTES);
  }, [meetingsQ.data, day, isTodayView]);

  function handleToggleTask(t: Task) {
    updateTask.mutate({ id: t.id, patch: { done: !t.done } });
  }

  function handleQuickAdd() {
    const title = quickTask.trim();
    if (!title) return;
    // 미리 적은 마감일이 있으면 그 날짜로, 비웠으면 날짜 없는 할 일.
    createTask.mutate({ title, due_date: quickDate.trim() || null });
    setQuickTask("");
    setQuickDate(defaultQuickDate);
  }

  return (
    <div className="flex min-h-svh flex-col lg:h-full lg:min-h-0">
      <PageHeaderBar
        center={
          isTodayView ? (
            <Text variant="h4" as="h2">
              오늘
            </Text>
          ) : (
            // 다른 날 보기일 때 — 날짜 타이틀 자체가 '오늘로' 복귀 버튼. 날짜 텍스트
            // 까지 클릭존(되돌리기 아이콘 + 날짜 한 덩어리).
            <Button
              variant="ghost"
              onClick={onReturnToday}
              title="오늘로"
              leftIcon={
                <CornerUpLeft
                  className="h-4 w-4 shrink-0"
                  style={{ color: "var(--sub)" }}
                  aria-hidden
                />
              }
            >
              <Text variant="h4" as="span">
                {formatDateLong(day)}
              </Text>
            </Button>
          )
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-5 py-6">
          {/* 제목(날짜)은 헤더가 표시 — 다른 날이면 헤더의 날짜가 곧 '오늘로' 복귀 버튼. */}
          <div className="space-y-7">
            {/* 할 일 | 일정 */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-7 sm:grid-cols-2">
              <Section
                icon={<CheckSquare className="h-4 w-4" />}
                title={isTodayView ? "할 일" : "마감 할 일"}
                count={tasks.length}
              >
                <div
                  className="mb-2 rounded-md px-2 py-2"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--line)",
                  }}
                >
                  <input
                    value={quickTask}
                    onChange={(e) => setQuickTask(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleQuickAdd();
                      }
                    }}
                    placeholder={isTodayView ? "오늘 할 일 추가" : "이 날 할 일 추가"}
                    className="mb-2 w-full bg-transparent text-sm outline-none"
                    style={{ color: "var(--ink)" }}
                  />
                  <div
                    className="flex items-center gap-x-3 text-xs"
                    style={{ color: "var(--sub)" }}
                  >
                    <span className="inline-flex items-center gap-1">
                      <CalendarIcon className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
                      <LooseDateInput
                        value={quickDate}
                        onCommit={setQuickDate}
                        seedTodayOnFocus
                        compact
                      />
                    </span>
                    <Button
                      className="ml-auto"
                      variant="ghost"
                      size="sm"
                      onClick={handleQuickAdd}
                      title="할 일 추가"
                      style={{ color: "var(--sub)", border: "1px solid var(--line-2)" }}
                      leftIcon={<Plus className="h-3 w-3" />}
                    >
                      추가
                    </Button>
                  </div>
                </div>
                {tasks.length === 0 ? (
                  <EmptyLine>
                    {isTodayView ? "오늘 할 일이 없습니다." : "이 날 마감 할 일이 없습니다."}
                  </EmptyLine>
                ) : (
                  visibleTasks.map((t) => {
                    const overdue =
                      isTodayView && !t.done && t.due_date != null && isPast(t.due_date);
                    return (
                      <Row key={t.id} onClick={() => onOpenTask(t.id)}>
                        <CheckboxButton
                          status={t.done ? "done" : "pending"}
                          onClick={() => handleToggleTask(t)}
                        />
                        <span
                          className={`min-w-0 flex-1 truncate ${t.done ? "line-through" : ""}`}
                          style={{
                            color: t.done ? "var(--faint)" : "var(--ink)",
                          }}
                        >
                          {t.title}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 text-2xs tabular-nums">
                          {t.due_date ? (
                            <span
                              style={{
                                color: overdue
                                  ? "var(--down-ink)"
                                  : "var(--faint)",
                              }}
                            >
                              {formatDisplayDate(t.due_date)}
                            </span>
                          ) : null}
                          {t.due_time ? (
                            <span style={{ color: "var(--faint)" }}>
                              {t.due_time}
                            </span>
                          ) : null}
                        </span>
                      </Row>
                    );
                  })
                )}
              </Section>

              <Section
                icon={<CalendarDays className="h-4 w-4" />}
                title={isTodayView ? "오늘 일정" : "일정"}
                count={dayEvents.length}
              >
                <DayEvents date={day} />
              </Section>
            </div>

            {/* 노트 | 일기 */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-7 sm:grid-cols-2">
              <Section
                icon={<FileText className="h-4 w-4" />}
                title={isTodayView ? "이어서 쓸 노트" : "이 날 노트"}
                action={
                  isTodayView ? (
                    <Button
                      variant="icon"
                      onClick={onCreateNote}
                      title="새 노트"
                      aria-label="새 노트"
                      style={{ color: "var(--sub)" }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  ) : undefined
                }
              >
                {notes.length === 0 ? (
                  <EmptyLine>
                    {isTodayView ? "아직 노트가 없습니다." : "이 날 작성한 노트가 없습니다."}
                  </EmptyLine>
                ) : (
                  notes.map((m) => (
                    <Row key={m.uid} onClick={() => onOpenMeeting(m.uid)}>
                      <FileText
                        className="h-3.5 w-3.5 shrink-0"
                        style={{ color: "var(--accent)" }}
                      />
                      <span
                        className="min-w-0 flex-1 truncate"
                        style={{ color: "var(--ink)" }}
                      >
                        {m.title?.trim() || "(제목 없음)"}
                      </span>
                      {isTodayView ? (
                        <span
                          className="shrink-0 text-2xs"
                          style={{ color: "var(--faint)" }}
                        >
                          {relativeDateLabel(todayIso(new Date(m.mtime)))}
                        </span>
                      ) : null}
                    </Row>
                  ))
                )}
              </Section>

              {/* 일기 — 그 날 일기. 모달 없이 그 자리에서 바로 인라인 편집(자동저장). */}
              <Section
                icon={<BookOpen className="h-4 w-4" />}
                title={isTodayView ? "오늘 일기" : "일기"}
                action={
                  journalStatus !== "idle" ? (
                    <SaveIndicator
                      isPending={
                        journalStatus === "pending" || journalStatus === "saving"
                      }
                      isError={journalStatus === "error"}
                    />
                  ) : undefined
                }
              >
                <JournalEditor
                  key={day}
                  date={day}
                  onStatusChange={setJournalStatus}
                />
              </Section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 대시보드 블록 — 아이콘 + 라벨 + 카운트 헤더, 그 아래 행 리스트. 바깥 간격은
// 부모(space-y / grid gap)가 관리하므로 자체 margin 없음.
function Section({
  icon,
  title,
  count,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div
        className="mb-1.5 flex items-center gap-2"
        style={{ color: "var(--sub)" }}
      >
        <span className="shrink-0" style={{ color: "var(--faint)" }}>
          {icon}
        </span>
        <Text variant="body" weight="semibold" as="h3">
          {title}
        </Text>
        {typeof count === "number" && count > 0 ? (
          <span
            className="text-xs tabular-nums"
            style={{ color: "var(--faint)" }}
          >
            {count}
          </span>
        ) : null}
        {action ? <span className="ml-auto shrink-0">{action}</span> : null}
      </div>
      <div>{children}</div>
    </section>
  );
}

// 클릭 가능한 한 행 — hover 강조.
function Row({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-base transition hover:bg-[var(--surface-2)]"
    >
      {children}
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <Text variant="caption" color="muted" as="div" className="px-2 py-1.5">
      {children}
    </Text>
  );
}
