import { useMemo, useState } from "react";
import { Checkbox, NavItem } from "@goodsoob/ds";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { SidePanelSectionHeader } from "../nav/SidePanel";
import { useRecordings } from "../../hooks/useRecordings";
import { groupInbox, nextAfterRemoval, nextStepLabel, shortRecordingBases } from "../../lib/recordings/inbox";
import type { RecordingItem } from "../../lib/recordings/merge";
import type { SelectRecording } from "../../pages/RecordingsPage";
import { formatDuration, recordingWhen } from "./recordingLabels";
import { useRecordingDelete } from "./useRecordingDelete";

const DONE_OPEN_KEY = "goodsoob:recordingsDoneOpen";

function readLS(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLS(key: string, v: string): void {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    // private window 등 — 기억만 못 함
  }
}

type Props = {
  selectedBase: string | null;
  onSelect: SelectRecording;
  onClear: () => void;
};

// 녹음 탭 사이드바 = 인박스. 처리할 것(미정, 날짜 desc) / 끝난 것(연결됨, 기본 접힘).
// 행 = 시각 · 길이 / 전사 첫 문장 / 다음 할 일(회색 작은 글자). 상태는 칩 없이 타이포로만.
// 체크박스로 골라 하단 바에서 한꺼번에 삭제.
export function RecordingsSidePanel({ selectedBase, onSelect, onClear }: Props) {
  const { items, isLoading, isError } = useRecordings();
  const [doneOpen, setDoneOpen] = useState(() => readLS(DONE_OPEN_KEY) === "1");
  const [todoOpen, setTodoOpen] = useState(true);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => (items ? groupInbox(items) : { todo: [], done: [] }), [items]);
  const todoOrder = useMemo(() => groups.todo.map((i) => i.entry.base), [groups]);
  const shortBases = useMemo(() => shortRecordingBases(groups.todo), [groups]);

  // 목록에서 사라진 base 는 선택에서도 뺀다.
  const live = useMemo(() => new Set(items?.map((i) => i.entry.base) ?? []), [items]);
  const selection = useMemo(() => [...checked].filter((b) => live.has(b)), [checked, live]);

  const del = useRecordingDelete((deleted) => {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const b of deleted) next.delete(b);
      return next;
    });
    if (selectedBase && deleted.includes(selectedBase)) {
      const next = nextAfterRemoval(todoOrder, deleted, selectedBase);
      if (next) onSelect(next);
      else onClear();
    }
  });

  function toggle(base: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(base)) next.delete(base);
      else next.add(base);
      return next;
    });
  }

  const selecting = selection.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex shrink-0 items-center justify-between gap-2 px-4"
        style={{ height: "var(--page-header-h)", borderBottom: "1px solid var(--line)" }}
      >
        <h2 className="font-serif text-sm font-medium" style={{ color: "var(--ink)" }}>
          녹음
        </h2>
        {shortBases.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            title="새 녹음 중 30초 미만 녹음을 모두 고릅니다"
            onClick={() => setChecked(new Set(shortBases))}
          >
            30초 미만 선택
          </Button>
        ) : null}
      </div>
      <nav className="flex min-h-0 flex-1 flex-col" aria-label="녹음">
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {isLoading ? null : isError ? (
            <Text variant="caption" color="danger" as="div" className="px-4 py-2">
              녹음 목록을 불러오지 못했습니다. 앱 서버가 켜져 있는지 확인하세요.
            </Text>
          ) : (
            <>
              <SidePanelSectionHeader
                label="새 녹음"
                collapsed={!todoOpen}
                onToggle={() => setTodoOpen((v) => !v)}
                count={groups.todo.length}
              />
              <div className="px-1 pb-2" hidden={!todoOpen}>
                {groups.todo.length === 0 ? (
                  <Text variant="caption" color="muted" as="div" className="px-3 py-1.5">
                    새 녹음이 없습니다
                  </Text>
                ) : (
                  groups.todo.map((it) => (
                    <RecordingRow
                      key={it.entry.base}
                      item={it}
                      active={it.entry.base === selectedBase}
                      checked={checked.has(it.entry.base)}
                      selecting={selecting}
                      onToggle={() => toggle(it.entry.base)}
                      onSelect={() => onSelect(it.entry.base)}
                    />
                  ))
                )}
              </div>
              {groups.done.length > 0 ? (
                <>
                  <SidePanelSectionHeader
                    label="정리 끝"
                    collapsed={!doneOpen}
                    onToggle={() => {
                      const next = !doneOpen;
                      setDoneOpen(next);
                      writeLS(DONE_OPEN_KEY, next ? "1" : "0");
                    }}
                    count={groups.done.length}
                  />
                  {doneOpen ? (
                    <div className="px-1 pb-2">
                      {groups.done.map((it) => (
                        <RecordingRow
                          key={it.entry.base}
                          item={it}
                          active={it.entry.base === selectedBase}
                          checked={checked.has(it.entry.base)}
                          selecting={selecting}
                          onToggle={() => toggle(it.entry.base)}
                          onSelect={() => onSelect(it.entry.base)}
                        />
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>
        {selecting ? (
          <div
            className="flex shrink-0 items-center gap-2 px-3 py-2"
            style={{ borderTop: "1px solid var(--line)" }}
            data-testid="recordings-selection-bar"
          >
            <Text variant="caption" color="secondary" className="min-w-0 flex-1 tabular-nums">
              {selection.length}개 선택
            </Text>
            <Button variant="ghost" size="sm" onClick={() => setChecked(new Set())}>
              선택 해제
            </Button>
            <Button variant="danger" size="sm" disabled={del.isPending} onClick={() => del.request(selection)}>
              {selection.length}개 삭제
            </Button>
          </div>
        ) : null}
      </nav>
      {del.dialog}
    </div>
  );
}

function RecordingRow({
  item,
  active,
  checked,
  selecting,
  onToggle,
  onSelect,
}: {
  item: RecordingItem;
  active: boolean;
  checked: boolean;
  selecting: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const { entry, status } = item;
  const duration = formatDuration(entry.durationSec);
  const muted = status.destination === "trash";
  const step = nextStepLabel(item);
  const attention = status.pipeline === "error" && status.destination === "undecided";
  // 체크박스는 hover·포커스·선택 중일 때만 (터치 기기는 항상) — 행 42개에 상시 박스는 소음.
  const boxVisibility = selecting || checked ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100";
  return (
    <div className="group flex items-start gap-1" data-testid="recording-row" data-base={entry.base}>
      <span className={`shrink-0 pt-2 pl-1 ${boxVisibility}`}>
        <Checkbox checked={checked} onChange={onToggle} aria-label={`${recordingWhen(entry)} 녹음 선택`} />
      </span>
      <NavItem active={active} onClick={onSelect} aria-current={active ? "true" : undefined} className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5" style={{ opacity: muted ? 0.6 : undefined }}>
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate" style={{ color: "var(--ink)" }}>
              {recordingWhen(entry)}
            </span>
            {duration ? (
              <span className="shrink-0 text-2xs tabular-nums whitespace-nowrap" style={{ color: "var(--faint)" }}>
                {duration}
              </span>
            ) : null}
          </span>
          {entry.firstLine ? (
            <span className="block min-w-0 truncate text-xs" style={{ color: "var(--sub)" }}>
              {entry.firstLine}
            </span>
          ) : null}
          <span
            className={`block truncate text-2xs ${attention ? "font-semibold" : ""}`}
            style={{ color: attention ? "var(--ink)" : "var(--faint)" }}
          >
            {step}
            {entry.syncPending ? " · iCloud 받는 중" : ""}
          </span>
        </span>
      </NavItem>
    </div>
  );
}
