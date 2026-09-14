import { useEffect, useMemo, useState } from "react";
import { Trash2, Plus, Check, Calendar, Clock } from "lucide-react";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { LooseDateInput } from "../common/LooseDateInput";
import { LooseTimeInput } from "../common/LooseTimeInput";
import {
  useSchedule,
  useCreateEvent,
  useUpdateEvent,
  useDeleteEvent,
} from "../../hooks/useSchedule";
import type { ScheduleEvent } from "../../api/schedule";
import { eventsOnDay } from "./dayView";

// 그 날(date) 일정 섹션 — 보기·추가·편집·삭제. 폐기된 DayDetailModal 에서 추출해
// "오늘" 탭 메인창 day-view 의 일정 블록에서 재사용(오늘·다른 날 동일 경로).
export function DayEvents({ date }: { date: string }) {
  const scheduleQ = useSchedule();
  const events = useMemo<ScheduleEvent[]>(
    () => eventsOnDay(scheduleQ.data ?? [], date),
    [scheduleQ.data, date],
  );

  return (
    <div>
      <AddEventForm date={date} />
      {events.length === 0 ? (
        <Text variant="caption" color="muted" as="div" className="px-2 py-1.5">
          이 날 일정이 없습니다.
        </Text>
      ) : (
        <div className="space-y-1">
          {events.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

// 일정 한 줄 — 보기/편집 토글. 편집 시 텍스트·종료일·시각 인라인 수정 + 삭제.
function EventRow({ event }: { event: ScheduleEvent }) {
  const [editing, setEditing] = useState(false);
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();
  const [text, setText] = useState(event.text);
  const [end, setEnd] = useState(event.end ?? "");
  const [time, setTime] = useState(event.time ?? "");

  function save() {
    const patch = {
      text: text.trim(),
      end: end && end > event.start ? end : null,
      time: time || null,
    };
    updateEvent.mutate({ id: event.id, patch });
    setEditing(false);
  }

  if (!editing) {
    const range = event.end && event.end > event.start ? ` ~ ${event.end.slice(5)}` : "";
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[14px] transition hover:bg-[var(--surface-2)]"
      >
        {/* 내용-날짜-시간 순으로 통일(할일·노트와 동일): 제목 먼저, 시각·범위는 우측. */}
        <span className="min-w-0 flex-1 truncate" style={{ color: "var(--ink)" }}>
          {event.text}
        </span>
        <span
          className="flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums"
          style={{ color: "var(--faint)" }}
        >
          {range ? <span>{range.trim()}</span> : null}
          {event.time ? <span>{event.time}</span> : null}
        </span>
      </div>
    );
  }

  return (
    <div
      className="rounded-md px-2 py-2"
      style={{ backgroundColor: "var(--surface)", border: "1px solid var(--line)" }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="일정 내용"
        className="mb-2 w-full bg-transparent text-sm outline-none"
        style={{ color: "var(--ink)" }}
      />
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
        style={{ color: "var(--sub)" }}
      >
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="opacity-60">~</span>
          <LooseDateInput value={end} onCommit={setEnd} compact />
        </span>
        <LooseTimeInput value={time} onCommit={setTime} compact />
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => deleteEvent.mutate(event.id)}
            title="일정 삭제"
            style={{ color: "var(--sub)", border: "1px solid var(--line-2)" }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={save}
            leftIcon={<Check className="h-3 w-3" />}
          >
            완료
          </Button>
        </div>
      </div>
    </div>
  );
}

// 일정 추가 폼 — 시작일(기본 = 보고 있는 날) + 텍스트 + (선택) 시각.
function AddEventForm({ date }: { date: string }) {
  const createEvent = useCreateEvent();
  const [text, setText] = useState("");
  const [start, setStart] = useState(date);
  const [time, setTime] = useState("");

  // 보고 있는 날짜가 바뀌면 시작일도 그 날짜로 리셋(기본값 = 그 날).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStart(date);
  }, [date]);

  function add() {
    const t = text.trim();
    if (!t) return;
    createEvent.mutate({ text: t, start: start || date, end: null, time: time || null });
    setText("");
    setStart(date);
    setTime("");
  }

  return (
    <div
      className="mb-2 rounded-md px-2 py-2"
      style={{
        backgroundColor: "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder="일정 추가"
        className="mb-2 w-full bg-transparent text-sm outline-none"
        style={{ color: "var(--ink)" }}
      />
      <div
        className="flex items-center gap-x-3 text-xs"
        style={{ color: "var(--sub)" }}
      >
        <span className="inline-flex items-center gap-1">
          <Calendar className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
          <LooseDateInput value={start} onCommit={setStart} compact />
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
          <LooseTimeInput value={time} onCommit={setTime} compact />
        </span>
        <Button
          className="ml-auto"
          variant="ghost"
          size="sm"
          onClick={add}
          title="일정 추가"
          style={{ color: "var(--sub)", border: "1px solid var(--line-2)" }}
          leftIcon={<Plus className="h-3 w-3" />}
        >
          추가
        </Button>
      </div>
    </div>
  );
}
