import { useEffect, useRef, useState } from "react";
import { Calendar as CalendarIcon, Clock, Trash2 } from "lucide-react";
import {
  useRoutine,
  useUpdateRoutine,
  useDeleteRoutine,
  useToggleRoutineDay,
} from "../../hooks/useRoutines";
import type { UpdateRoutineInput } from "../../api/routines";
import { PageHeaderBar } from "../common/PageHeaderBar";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { LooseDateInput } from "../common/LooseDateInput";
import { LooseTimeInput } from "../common/LooseTimeInput";
import { useToast } from "../Toast";
import { formatError } from "../../lib/errors";
import {
  formatDateShort,
  parseIsoDate,
  weekdayShort,
} from "../../lib/dates";
import { RoutineLog } from "./RoutineLog";

type Props = {
  name: string;
  onClose: () => void;
};

type RoutineDraft = {
  name: string;
  time: string;
  started: string;
  ends: string;
};

export function RoutineDetail({ name, onClose }: Props) {
  const routineQ = useRoutine(name);
  const updateMutation = useUpdateRoutine();
  const deleteMutation = useDeleteRoutine();
  const toggleMutation = useToggleRoutineDay();
  const toast = useToast();

  const routine = routineQ.data ?? null;

  // 폼 영역 click-to-edit. 태스크 카드 (TaskRow) 와 동일 패턴 — 폼 클러스터 클릭 시
  // editing 진입, 외부 mousedown/Enter/Escape 로 종료. 종료 시 한 patch 로 diff commit.
  const [editing, setEditing] = useState(false);
  const initialDraft: RoutineDraft = {
    name: routine?.name ?? "",
    time: routine?.frontmatter.time ?? "",
    started: routine?.frontmatter.started ?? "",
    ends: routine?.frontmatter.ends ?? "",
  };
  const [draft, setDraft] = useState<RoutineDraft>(initialDraft);
  const draftRef = useRef<RoutineDraft>(draft);
  const formWrapperRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  function updateDraft(patch: Partial<RoutineDraft>) {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!routine) return;
    // routine 데이터 변경 시 draft 동기 — 다른 곳에서 갱신된 케이스. editing 중엔 사용자 의도 우선.
    if (editing) return;
    const fresh: RoutineDraft = {
      name: routine.name,
      time: routine.frontmatter.time ?? "",
      started: routine.frontmatter.started,
      ends: routine.frontmatter.ends ?? "",
    };
    draftRef.current = fresh;
    setDraft(fresh);
  }, [routine?.name, routine?.frontmatter.id, editing]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!editing || !routine) return;
    // editing 진입 — 최신 routine 값으로 draft 초기화 + 이름 input focus.
    const fresh: RoutineDraft = {
      name: routine.name,
      time: routine.frontmatter.time ?? "",
      started: routine.frontmatter.started,
      ends: routine.frontmatter.ends ?? "",
    };
    draftRef.current = fresh;
    setDraft(fresh);
    requestAnimationFrame(() => {
      const el = nameInputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // 외부 mousedown / Enter = commit, Escape = revert. LooseDate/Time 의 blur→onCommit
  // 가 draftRef 동기 갱신 → microtask 안 commitAndClose 가 최신 ref 사용 (TaskRow 패턴).
  useEffect(() => {
    if (!editing) return;
    function onMouseDown(e: MouseEvent) {
      if (formWrapperRef.current?.contains(e.target as Node)) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        formWrapperRef.current?.contains(active)
      ) {
        active.blur();
      }
      queueMicrotask(() => void commitAndClose());
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cancelEdit();
      if (e.key === "Enter") {
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          formWrapperRef.current?.contains(active)
        ) {
          active.blur();
        }
        queueMicrotask(() => void commitAndClose());
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

  async function commitAndClose() {
    if (!routine) {
      setEditing(false);
      return;
    }
    const d = draftRef.current;
    const trimmedName = d.name.trim();
    // validation — 실패 시 toast + close + revert (editing 유지 X, 사용자가 다시 클릭).
    if (!trimmedName) {
      toast.show("이름은 비울 수 없습니다. 이전 값으로 되돌립니다.");
      setEditing(false);
      return;
    }
    if (!d.started) {
      toast.show("시작일은 비울 수 없습니다. 이전 값으로 되돌립니다.");
      setEditing(false);
      return;
    }
    if (d.ends && d.ends < d.started) {
      toast.show("종료일은 시작일과 같거나 이후여야 합니다. 이전 값으로 되돌립니다.");
      setEditing(false);
      return;
    }
    // diff → 단일 patch
    const patch: UpdateRoutineInput = {};
    if (trimmedName !== routine.name) patch.rename = trimmedName;
    const nextTime = d.time || null;
    if (nextTime !== (routine.frontmatter.time ?? null)) patch.time = nextTime;
    if (d.started !== routine.frontmatter.started) patch.started = d.started;
    const nextEnds = d.ends || null;
    if (nextEnds !== (routine.frontmatter.ends ?? null)) patch.ends = nextEnds;
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    try {
      await updateMutation.mutateAsync({ name: routine.name, patch });
    } catch (err) {
      toast.show(formatError(err));
    } finally {
      setEditing(false);
    }
  }

  function cancelEdit() {
    setEditing(false);
  }

  async function handleDelete() {
    if (!routine) return;
    if (
      !window.confirm(
        `'${routine.name}' 루틴을 휴지통으로 옮길까요? 나중에 복원할 수 있습니다.`,
      )
    )
      return;
    try {
      await deleteMutation.mutateAsync(routine.name);
      onClose();
    } catch (err) {
      toast.show(formatError(err));
    }
  }

  function handleToggleDay(date: string, currentDone: boolean) {
    if (!routine) return;
    toggleMutation.mutate({
      name: routine.name,
      date,
      done: !currentDone,
    });
  }

  if (routineQ.isLoading || !routine) {
    return (
      <>
        <PageHeaderBar
          center={
            <Text variant="h4" as="h2" className="text-center">
              루틴
            </Text>
          }
        />
        <div className="mx-auto w-full max-w-xl px-5 pt-6">
          <div
            className="h-32 animate-pulse rounded-lg"
            style={{ backgroundColor: "var(--surface)" }}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeaderBar
        center={
          <Text variant="h4" as="h2" className="text-center">
            {routine.name}
          </Text>
        }
        right={
          <Button
            variant="icon"
            onClick={() => void handleDelete()}
            title="루틴 삭제"
            style={{ color: "var(--faint)" }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        }
      />

      <div className="mx-auto w-full max-w-xl px-5 pb-16 pt-5">
        {/* 폼 카드 — TaskRow 와 동일 패턴. 읽기 = title + meta chips, 편집 = title input + inline meta. */}
        <div
          ref={formWrapperRef}
          onClick={() => {
            if (!editing) setEditing(true);
          }}
          className={`rounded-lg border transition ${editing ? "" : "cursor-pointer hover:bg-[var(--surface)]"}`}
          style={{
            borderColor: editing
              ? "var(--line)"
              : "var(--line-2)",
            backgroundColor: editing ? "var(--surface)" : undefined,
          }}
          aria-label={editing ? undefined : "루틴 편집"}
          role={editing ? undefined : "button"}
          tabIndex={editing ? undefined : 0}
        >
          {editing ? (
            <div className="px-3 py-2.5">
              {/* 윗줄: 이름 input */}
              <input
                ref={nameInputRef}
                value={draft.name}
                onChange={(e) => updateDraft({ name: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                placeholder="이름"
                maxLength={100}
                className="w-full min-w-0 bg-transparent text-base outline-none"
                style={{ color: "var(--ink)" }}
              />

              {/* 아랫줄: meta cluster (시간 · 시작일 · ~ 종료일) */}
              <div
                className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                onClick={(e) => e.stopPropagation()}
                style={{ color: "var(--sub)" }}
              >
                <span className="inline-flex shrink-0 items-center gap-1">
                  <Clock
                    className="h-3 w-3 shrink-0 opacity-60"
                    aria-hidden
                  />
                  <LooseTimeInput
                    value={draft.time}
                    onCommit={(next) => updateDraft({ time: next })}
                    compact
                  />
                </span>
                <span className="inline-flex shrink-0 items-center gap-1">
                  <CalendarIcon
                    className="h-3 w-3 shrink-0 opacity-60"
                    aria-hidden
                  />
                  <LooseDateInput
                    value={draft.started}
                    onCommit={(next) => updateDraft({ started: next })}
                    compact
                  />
                </span>
                <span className="inline-flex shrink-0 items-center gap-1">
                  <span aria-hidden style={{ opacity: 0.5 }}>
                    ~
                  </span>
                  <LooseDateInput
                    value={draft.ends}
                    onCommit={(next) => updateDraft({ ends: next })}
                    compact
                  />
                </span>
              </div>
            </div>
          ) : (
            <div className="px-3 py-2.5">
              <Text
                variant="h4"
                weight="normal"
                as="div"
                className="min-w-0 break-words"
                style={{ color: "var(--ink)" }}
              >
                {routine.name || (
                  <Text variant="body" color="muted" as="span">
                    (이름 없음)
                  </Text>
                )}
              </Text>
              <RoutineReadMeta
                time={routine.frontmatter.time ?? ""}
                started={routine.frontmatter.started}
                ends={routine.frontmatter.ends ?? ""}
              />
            </div>
          )}
        </div>

        {/* 기록 — 시작일부터 (또는 종료일까지) 전체. GitHub-style 그리드. */}
        <div className="mt-6">
          <RoutineLog routine={routine} onToggleDay={handleToggleDay} />
        </div>
      </div>
    </>
  );
}

// 읽기 메타 row — TaskRow.ReadOnlyMeta 패턴. 시간 · 시작일 (~ 종료일) chip 들.
function RoutineReadMeta({
  time,
  started,
  ends,
}: {
  time: string;
  started: string;
  ends: string;
}) {
  if (!time && !started && !ends) return null;
  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
      style={{ color: "var(--sub)" }}
    >
      {time ? (
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
          {time}
        </span>
      ) : null}
      {started ? (
        <span className="inline-flex items-center gap-1">
          <CalendarIcon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
          {formatDateWithYear(started)}
          {ends ? ` ~ ${formatDateWithYear(ends)}` : " ~ 계속"}
        </span>
      ) : null}
    </div>
  );
}

function formatDateWithYear(iso: string): string {
  if (!iso) return "";
  const sameYear =
    parseIsoDate(iso).getFullYear() === new Date().getFullYear();
  const label = sameYear ? formatDateShort(iso) : iso;
  const wd = weekdayShort(iso);
  return `${label}${wd ? ` (${wd})` : ""}`;
}
