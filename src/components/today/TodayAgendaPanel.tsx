import { useEffect, useMemo, useState } from "react";
import { CalendarOff, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "../common/Button";
import { EmptyState } from "../common/EmptyState";
import { useSchedule } from "../../hooks/useSchedule";
import type { ScheduleEvent } from "../../api/schedule";
import { todayIso, isToday, formatDisplayDate } from "../../lib/dates";
import { eventDaysInMonth, monthGridCells, upcomingEvents } from "./monthGrid";
import { QuickCapturePanel } from "./QuickCapturePanel";

// "오늘" 탭 사이드바 — 메인 대시보드가 "오늘"을 다 보여주므로, 사이드바는 오늘 화면이
// 못 하는 것만 맡는다: (a) 다른 날짜 이동, (b) 앞으로의 일정 미리보기. 그래서 위는
// 미니 월(月) 그리드(날짜 점프 + 일정 있는 날 점), 아래는 다가오는 일정 아젠다.
// 폐기된 1년 flat 리스트의 "날짜 훑기"를 압축 달력으로 복원한 셈.
//
// 표시 정책 (사용자 결정): 그리드 점 = schedule 일정만(할 일·노트·일기는 각 탭 담당).
// 다일 일정은 걸친 모든 날에 점. 아젠다는 오늘 이후 일정 최대 10개(시작일 기준 한 줄).
const UPCOMING_LIMIT = 10;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

type Props = {
  // 날짜 셀·아젠다 행 클릭 — 메인창을 그 날 day-view 로 전환. App 이 소유.
  onOpenDay: (date: string) => void;
  // 메인창이 현재 보여주는 날짜 — 그리드에서 선택 표시 + 그 달로 따라감.
  selectedDay: string;
};

export function TodayAgendaPanel({ onOpenDay, selectedDay }: Props) {
  const scheduleQ = useSchedule();
  const events = useMemo(() => scheduleQ.data ?? [], [scheduleQ.data]);
  const today = todayIso();

  // 보고 있는 달. [‹]/[›] 로 ∓1(연 경계 자동 ±1), [오늘] 로 이번 달 복귀.
  const [view, setView] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  }));

  // 메인창의 선택 날짜가 바뀌면 그리드도 그 달로 따라가 선택 셀이 보이게.
  // (그리드 자체 ‹/› 브라우징은 selectedDay 를 안 바꾸므로 그대로 유지됨.)
  useEffect(() => {
    setView({
      year: Number(selectedDay.slice(0, 4)),
      month: Number(selectedDay.slice(5, 7)),
    });
  }, [selectedDay]);

  const cells = useMemo(
    () => monthGridCells(view.year, view.month),
    [view],
  );
  const eventDays = useMemo(
    () => eventDaysInMonth(events, view.year, view.month),
    [events, view],
  );
  const upcoming = useMemo(
    () => upcomingEvents(events, today, UPCOMING_LIMIT),
    [events, today],
  );

  const prevMonth = () =>
    setView((v) =>
      v.month === 1 ? { year: v.year - 1, month: 12 } : { ...v, month: v.month - 1 },
    );
  const nextMonth = () =>
    setView((v) =>
      v.month === 12 ? { year: v.year + 1, month: 1 } : { ...v, month: v.month + 1 },
    );
  const goToday = () =>
    setView({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });

  return (
    <div className="flex h-full flex-col">
      {/* 헤더: 보기 월 + [‹][오늘][›] */}
      <div
        className="flex shrink-0 items-center justify-between gap-1 px-4"
        style={{
          height: "var(--page-header-h)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <h2
          className="font-serif text-sm font-medium tabular-nums"
          style={{ color: "var(--ink)" }}
        >
          {view.year}년 {view.month}월
        </h2>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="icon"
            onClick={prevMonth}
            title="이전 달"
            aria-label="이전 달"
            style={{ color: "var(--sub)" }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={goToday}
            title="이번 달로"
            aria-label="이번 달로"
            style={{ color: "var(--sub)" }}
          >
            오늘
          </Button>
          <Button
            variant="icon"
            onClick={nextMonth}
            title="다음 달"
            aria-label="다음 달"
            style={{ color: "var(--sub)" }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 미니 월 그리드 */}
      <div
        className="shrink-0 px-3 pb-3 pt-2"
        style={{ borderBottom: "1px solid var(--line)" }}
      >
        <div className="mb-1 grid grid-cols-7">
          {WEEKDAYS.map((w, i) => (
            <div
              key={w}
              className="text-center text-[11px] font-medium"
              style={{
                color: i === 0 ? "var(--down)" : "var(--faint)",
              }}
            >
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5">
          {cells.map((iso, idx) =>
            iso == null ? (
              <div key={`blank-${idx}`} />
            ) : (
              <button
                key={iso}
                type="button"
                onClick={() => onOpenDay(iso)}
                title={`${formatDisplayDate(iso)} 상세`}
                aria-label={`${formatDisplayDate(iso)} 상세`}
                className="relative mx-auto flex h-7 w-7 flex-col items-center justify-center rounded-md text-[12px] tabular-nums transition hover:bg-[var(--surface-2)]"
                style={
                  isToday(iso)
                    ? {
                        backgroundColor: "var(--down)",
                        color: "var(--text-inverse)",
                      }
                    : iso === selectedDay
                      ? {
                          // 오늘이 아닌 선택일 — 레이아웃 안 밀리게 inset ring 으로 강조.
                          color: "var(--ink)",
                          boxShadow: "inset 0 0 0 1.5px var(--down)",
                        }
                      : { color: "var(--ink)" }
                }
              >
                {Number(iso.slice(8, 10))}
                {eventDays.has(iso) ? (
                  <span
                    className="absolute bottom-0.5 h-1 w-1 rounded-full"
                    style={{
                      backgroundColor: isToday(iso)
                        ? "var(--text-inverse)"
                        : "var(--down)",
                    }}
                    aria-label="일정 있음"
                  />
                ) : null}
              </button>
            ),
          )}
        </div>
      </div>

      {/* 다가오는 일정 아젠다 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <div className="flex items-center justify-between px-1 pb-1">
          <span
            className="text-[12px] font-semibold"
            style={{ color: "var(--sub)" }}
          >
            다가오는 일정
          </span>
          {/* 일정 추가 — 오늘 날짜 상세 모달(AddEventForm 내장)을 연다. 별도 폼 없이
              기존 추가 흐름 재사용. 다른 날짜 추가는 그 날 셀 클릭 → 모달에서. */}
          <Button
            variant="icon"
            onClick={() => onOpenDay(today)}
            title="일정 추가"
            aria-label="일정 추가"
            style={{ color: "var(--sub)" }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {upcoming.length === 0 ? (
          <EmptyState
            icon={
              <CalendarOff
                className="h-8 w-8"
                style={{ color: "var(--faint)" }}
              />
            }
            description="다가오는 일정 없음"
            className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center"
          />
        ) : (
          upcoming.map((e) => (
            <UpcomingRow key={e.id} event={e} onClick={() => onOpenDay(e.start)} />
          ))
        )}
      </div>

      {/* 빠른 캡처 — 아젠다 스크롤 밖, 사이드바 하단에 항상 고정. */}
      <QuickCapturePanel />
    </div>
  );
}

// 다가오는 일정 한 줄: 제목 먼저, 우측에 날짜·시각(시각 없으면 생략). 클릭 = 그 날로.
function UpcomingRow({
  event,
  onClick,
}: {
  event: ScheduleEvent;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition hover:bg-[var(--surface-2)]"
    >
      {/* 내용-날짜-시간 순으로 통일(할일·노트와 동일): 제목 먼저, 날짜·시각은 우측. */}
      <span
        className="min-w-0 flex-1 truncate"
        style={{ color: "var(--ink)" }}
      >
        {event.text}
      </span>
      <span
        className="shrink-0 whitespace-nowrap text-[11px] tabular-nums"
        style={{ color: "var(--faint)" }}
      >
        {formatDisplayDate(event.start)}
        {event.time ? ` ${event.time}` : ""}
      </span>
    </button>
  );
}
