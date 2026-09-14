import { useMemo } from "react";
import { formatDateLong, todayIso } from "../../lib/dates";
import type { Routine } from "../../api/routines";
import { Text } from "../common/Text";

type Props = {
  routine: Routine;
  onToggleDay: (date: string, done: boolean) => void;
};

type CellKind = "done" | "miss" | "today-pending" | "future" | "out-of-window";

interface MonthGroup {
  year: number;
  month: number; // 1-12
  // 6 rows × 7 cols 캘린더 그리드. null = 그 월에 속하지 않는 placeholder (시각 비움).
  rows: Array<Array<{ date: string; kind: CellKind } | null>>;
}

const CELL = 13;
const CELL_GAP = 3;
const ROW_GAP = 3;
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

// 월별 그룹 + 한 월 안에서 캘린더 레이아웃 (요일 가로 7컬럼). GitHub 박스 시각 유지 —
// done 채움 / miss 옅음 / future outline. 월들은 가로로 wrap (max-w-xl 컨테이너에서
// 화면 폭에 따라 자동 줄바꿈).
export function RoutineLog({ routine, onToggleDay }: Props) {
  const today = todayIso();

  const groups = useMemo<MonthGroup[]>(() => {
    const { started, ends } = routine.frontmatter;
    const endAnchor = ends && ends < today ? ends : today;
    const [sy, sm] = started.split("-").map(Number);
    const [ey, em] = endAnchor.split("-").map(Number);

    const out: MonthGroup[] = [];
    let y = sy;
    let m = sm;
    while (y < ey || (y === ey && m <= em)) {
      out.push(buildMonth(y, m));
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    // 역순 — 최신 월이 좌측/위. 본인 매일 사용 시 "오늘/이번 달" 이 시야 우선이라
    // 옛 월은 자연스럽게 아래로 wrap.
    return out.reverse();

    function buildMonth(year: number, month: number): MonthGroup {
      const first = new Date(year, month - 1, 1);
      const dow = first.getDay(); // 0 = 일요일
      const lastDay = new Date(year, month, 0).getDate();
      const rows: MonthGroup["rows"] = [[]];
      for (let i = 0; i < dow; i++) rows[0].push(null); // leading placeholder
      let r = 0;
      for (let d = 1; d <= lastDay; d++) {
        if (rows[r].length === 7) {
          rows.push([]);
          r++;
        }
        const date = `${year}-${pad(month)}-${pad(d)}`;
        rows[r].push({ date, kind: classify(date) });
      }
      while (rows[r].length < 7) rows[r].push(null); // trailing placeholder
      return { year, month, rows };
    }

    function classify(d: string): CellKind {
      if (d < started) return "out-of-window";
      if (ends && d > ends) return "out-of-window";
      if (routine.log.has(d)) return "done";
      if (d === today) return "today-pending";
      if (d > today) return "future";
      return "miss";
    }
  }, [routine.log, routine.frontmatter, today]);

  // 연도 라벨 — 역순 (최신이 먼저) 기준. 같은 해가 이어지는 동안엔 "5월" 만,
  // 다른 해로 넘어가는 경계에서 연도 표기. 첫 entry (=최신 월) 는 항상 연도 표기.
  const labels = useMemo(() => {
    const out: string[] = [];
    let prevYear: number | null = null;
    for (const g of groups) {
      const showYear = prevYear === null || prevYear !== g.year;
      out.push(showYear ? `${g.year}년 ${g.month}월` : `${g.month}월`);
      prevYear = g.year;
    }
    return out;
  }, [groups]);

  return (
    <div>
      <Text
        variant="caption"
        color="secondary"
        as="div"
        weight="medium"
        className="mb-3"
      >
        기록
      </Text>
      <div className="flex flex-wrap gap-x-6 gap-y-4">
        {groups.map((g, i) => (
          <MonthBlock
            key={`${g.year}-${g.month}`}
            label={labels[i]}
            group={g}
            onToggleDay={onToggleDay}
          />
        ))}
      </div>
    </div>
  );
}

function MonthBlock({
  label,
  group,
  onToggleDay,
}: {
  label: string;
  group: MonthGroup;
  onToggleDay: (date: string, done: boolean) => void;
}) {
  return (
    <div className="flex flex-col">
      <Text
        variant="caption"
        color="secondary"
        as="span"
        weight="medium"
        className="mb-1.5"
      >
        {label}
      </Text>
      <div
        className="mb-1 grid"
        style={{
          gridTemplateColumns: `repeat(7, ${CELL}px)`,
          columnGap: CELL_GAP,
        }}
        aria-hidden
      >
        {WEEKDAY_LABELS.map((w, i) => (
          <span
            key={i}
            className="text-center text-[10px] leading-none"
            style={{ color: "var(--faint)", width: CELL }}
          >
            {w}
          </span>
        ))}
      </div>
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(7, ${CELL}px)`,
          columnGap: CELL_GAP,
          rowGap: ROW_GAP,
        }}
      >
        {group.rows.flat().map((cell, idx) => {
          if (!cell) {
            return (
              <span
                key={`null-${idx}`}
                aria-hidden
                style={{ width: CELL, height: CELL }}
              />
            );
          }
          const interactive =
            cell.kind !== "out-of-window" && cell.kind !== "future";
          return (
            <button
              key={cell.date}
              type="button"
              onClick={() =>
                interactive && onToggleDay(cell.date, cell.kind === "done")
              }
              disabled={!interactive}
              title={`${formatDateLong(cell.date)} — ${labelFor(cell.kind)}`}
              aria-label={`${cell.date} ${labelFor(cell.kind)}`}
              className="rounded-[3px] disabled:cursor-not-allowed"
              style={{
                width: CELL,
                height: CELL,
                ...cellStyle(cell.kind),
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function labelFor(k: CellKind): string {
  switch (k) {
    case "done":
      return "완료";
    case "miss":
      return "미체크";
    case "today-pending":
      return "오늘 (미체크)";
    case "future":
      return "예정";
    case "out-of-window":
      return "기간 외";
  }
}

function cellStyle(k: CellKind): React.CSSProperties {
  switch (k) {
    case "done":
      return { backgroundColor: "var(--btn-primary)" };
    case "miss":
      return { backgroundColor: "var(--surface-3)" };
    case "today-pending":
      return {
        backgroundColor: "var(--surface-3)",
        boxShadow: "inset 0 0 0 1.5px var(--btn-primary)",
      };
    case "future":
      return {
        backgroundColor: "transparent",
        boxShadow: "inset 0 0 0 1px var(--line)",
      };
    case "out-of-window":
      return {
        backgroundColor: "transparent",
        boxShadow: "inset 0 0 0 1px var(--line-2)",
      };
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
